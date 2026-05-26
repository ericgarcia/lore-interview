from __future__ import annotations
import hashlib
import math
from app.models.input import ConversationInput, DiscussionInput
from app.models.output import (
    BeliefObject, DataQuality, DomainSummary, EvaluationResponse, Signal, SourceEvidence,
)
from baml_client.types import ExtractedBelief
from app.pipeline.preprocess import TurnPair

VIABLE_THRESHOLD = 8
SELF_DOMAINS = ("identity", "capability", "value", "relational", "aspirational")


def _belief_id(ref_user_id: int, belief_text: str, domain: str) -> str:
    key = f"{ref_user_id}:{belief_text}:{domain}"
    return "b_" + hashlib.sha256(key.encode()).hexdigest()[:8]


def _str(val) -> str:
    return str(val).split(".")[-1].lower()


def _deduplicate(
    verified: list[tuple[ExtractedBelief, float]],
    ref_user_id: int,
) -> list[tuple[ExtractedBelief, float, str]]:
    best_score: dict[str, float] = {}
    best_belief: dict[str, ExtractedBelief] = {}
    all_indices: dict[str, set[int]] = {}

    for belief, score in verified:
        domain = _str(belief.self_domain)
        bid = _belief_id(ref_user_id, belief.belief_text, domain)
        all_indices.setdefault(bid, set()).update(belief.source_turn_indices)
        if bid not in best_score or score > best_score[bid]:
            best_score[bid] = score
            best_belief[bid] = belief

    result: list[tuple[ExtractedBelief, float, str]] = []
    for bid, belief in best_belief.items():
        result.append((belief, best_score[bid], bid))
    return result


def _source_evidence(belief: ExtractedBelief, turn_map: dict[int, TurnPair]) -> list[SourceEvidence]:
    return [
        SourceEvidence(
            ref_conversation_id=t.ref_conversation_id,
            turn_index=idx,
            transaction_datetime_utc=t.transaction_datetime_utc,
            post_id=t.post_id,
            comment_id=t.comment_id,
        )
        for idx in belief.source_turn_indices
        if (t := turn_map.get(idx)) is not None
    ]


def build_response(
    verified: list[tuple[ExtractedBelief, float]],
    request: ConversationInput | DiscussionInput,
    turns: list[TurnPair],
) -> EvaluationResponse:
    turn_count = len(turns)
    viable = turn_count >= VIABLE_THRESHOLD
    confidence_adjustment = min(1.0, turn_count / VIABLE_THRESHOLD)
    session_number = getattr(request, "session_number", 1)
    session_weight = round(math.log(session_number + 1), 4)
    prior_ids = set(request.prior_belief_ids)
    turn_map = {t.turn_index: t for t in turns}

    beliefs: list[BeliefObject] = []
    for raw, nli_score, bid in _deduplicate(verified, request.ref_user_id):
        beliefs.append(BeliefObject(
            belief_id=bid,
            belief_text=raw.belief_text,
            belief_type=raw.belief_type,
            subject_tag=raw.subject_tag or "",
            self_domain=_str(raw.self_domain),
            polarity=_str(raw.polarity),
            temporal_scope=raw.temporal_scope,
            confidence=round(nli_score * confidence_adjustment, 4),
            session_weight=session_weight,
            source_evidence=_source_evidence(raw, turn_map),
            claim_commitment=raw.claim_commitment,
            crystallization=raw.crystallization,
            affective_charge=_str(raw.affective_charge) if raw.affective_charge else None,
            belief_state="crystallized" if raw.crystallization >= 0.6 else "transitioning",
            delta="reinforced" if bid in prior_ids else "new",
            nli_confidence=round(nli_score, 4),
            evidence_span=raw.evidence_spans[0] if raw.evidence_spans else raw.belief_text,
            depth_markers=raw.depth_markers,
        ))

    domain_counts: dict[str, int] = {d: 0 for d in SELF_DOMAINS}
    domain_commitment: dict[str, list[float]] = {d: [] for d in SELF_DOMAINS}
    domain_crystallization: dict[str, list[float]] = {d: [] for d in SELF_DOMAINS}
    for b in beliefs:
        domain_counts[b.self_domain] += 1
        domain_commitment[b.self_domain].append(b.claim_commitment)
        domain_crystallization[b.self_domain].append(b.crystallization)

    dominant = max(domain_counts, key=domain_counts.get) if any(domain_counts.values()) else None
    if dominant and domain_counts[dominant] == 0:
        dominant = None

    domain_summaries = [
        DomainSummary(
            domain=d,
            belief_count=domain_counts[d],
            avg_commitment=round(sum(domain_commitment[d]) / len(domain_commitment[d]), 4) if domain_commitment[d] else 0.0,
            avg_crystallization=round(sum(domain_crystallization[d]) / len(domain_crystallization[d]), 4) if domain_crystallization[d] else 0.0,
        )
        for d in SELF_DOMAINS
        if domain_counts[d] > 0
    ]

    richness = round(len(beliefs) / max(turn_count, 1), 4)

    return EvaluationResponse(
        source_type=request.source_type,
        ref_conversation_id=getattr(request, "ref_conversation_id", None),
        post_id=getattr(request, "post_id", None),
        ref_user_id=request.ref_user_id,
        data_quality=DataQuality(
            turn_count=turn_count,
            viable=viable,
            confidence_adjustment=round(confidence_adjustment, 4),
        ),
        signal=Signal(
            richness_score=richness,
            belief_count=len(beliefs),
            high_confidence_count=sum(1 for b in beliefs if b.confidence >= 0.7),
            dominant_self_domain=dominant,
            beliefs_by_domain=domain_counts,
            domain_summaries=domain_summaries,
        ),
        beliefs=beliefs,
    )
