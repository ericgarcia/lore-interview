from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from sentence_transformers import CrossEncoder
from baml_client.types import ExtractedBelief, SelfDomain

NLI_ENTAILMENT_IDX = 1

DOMAIN_THRESHOLDS: dict[SelfDomain, float] = {
    SelfDomain.IDENTITY: 0.80,
    SelfDomain.VALUE: 0.80,
    SelfDomain.CAPABILITY: 0.65,
    SelfDomain.RELATIONAL: 0.65,
    SelfDomain.ASPIRATIONAL: 0.65,
}

COMMITMENT_FLOOR = 0.3

_nli: CrossEncoder | None = None


def _get_nli() -> CrossEncoder:
    global _nli
    if _nli is None:
        _nli = CrossEncoder("cross-encoder/nli-deberta-v3-small", max_length=512)
    return _nli


def _softmax(scores: np.ndarray) -> np.ndarray:
    e = np.exp(scores - scores.max())
    return e / e.sum()


def _nli_score(evidence: str, belief: str) -> float:
    raw = _get_nli().predict([[evidence, belief]])[0]
    return float(_softmax(raw)[NLI_ENTAILMENT_IDX])


@dataclass
class RejectedBelief:
    belief: ExtractedBelief
    reason: str  # 'no_evidence' | 'low_commitment' | 'nli_threshold'
    nli_score: float | None = None
    nli_threshold: float | None = None
    nli_premise: str | None = None  # actual text the NLI scored against


def verify_beliefs(
    beliefs: list[ExtractedBelief],
    turn_text_map: dict[int, str] | None = None,
) -> tuple[list[tuple[ExtractedBelief, float]], list[RejectedBelief]]:
    verified: list[tuple[ExtractedBelief, float]] = []
    rejected: list[RejectedBelief] = []

    for belief in beliefs:
        if not belief.evidence_spans:
            rejected.append(RejectedBelief(belief, "no_evidence"))
            continue
        if belief.claim_commitment < COMMITMENT_FLOOR:
            rejected.append(RejectedBelief(belief, "low_commitment"))
            continue

        # Use the full user message(s) as the NLI premise so coreference and
        # context that the LLM had during extraction is available to the verifier.
        # Falls back to evidence_spans if turn text isn't available.
        if turn_text_map and belief.source_turn_indices:
            full_turns = [turn_text_map[i] for i in belief.source_turn_indices if i in turn_text_map]
            evidence = " ".join(full_turns) if full_turns else " ".join(belief.evidence_spans)
        else:
            evidence = " ".join(belief.evidence_spans)

        score = _nli_score(evidence, belief.belief_text)
        threshold = DOMAIN_THRESHOLDS.get(belief.self_domain, 0.65)

        if score < threshold:
            rejected.append(RejectedBelief(belief, "nli_threshold", nli_score=round(score, 4), nli_threshold=threshold, nli_premise=evidence))
            continue

        verified.append((belief, score))

    return verified, rejected
