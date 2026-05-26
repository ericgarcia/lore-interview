from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import Any

from sentence_transformers import SentenceTransformer

from app.db import vectors as vec_store
from app.db.schema import get_connection

_encoder: SentenceTransformer | None = None

_TEMPORAL_PATTERNS = [
    r"I used to\b",
    r"I no longer\b",
    r"I don't anymore\b",
    r"not like I used to\b",
    r"I've changed my mind\b",
    r"I used to think\b",
    r"I no longer believe\b",
    r"I've stopped\b",
    r"used to feel\b",
    r"not anymore\b",
    r"I've realized\b",
    r"I was wrong\b",
    r"I previously\b",
    r"I once thought\b",
    r"I've come to\b",
]
_TEMPORAL_RE = re.compile("|".join(_TEMPORAL_PATTERNS), re.IGNORECASE)


@dataclass
class BeliefInput:
    belief_text: str
    subject_tag: str
    self_domain: str
    polarity: str
    claim_commitment: float
    crystallization: float


@dataclass
class MatchResult:
    canonical_id: str | None
    relation_to_prior: str | None
    match_confidence: float | None
    relation_confidence: float | None
    relation_classifier_flags: dict[str, Any] = field(default_factory=dict)

    @property
    def is_expansion(self) -> bool:
        return self.canonical_id is None


def _get_encoder() -> SentenceTransformer:
    global _encoder
    if _encoder is None:
        _encoder = SentenceTransformer("all-MiniLM-L6-v2")
    return _encoder


def encode(text: str) -> list[float]:
    return _get_encoder().encode(text).tolist()


def _subject_similarity(tag_a: str, tag_b: str) -> float:
    if not tag_a or not tag_b:
        return 0.5  # neutral if either tag is missing
    import numpy as np
    a = _get_encoder().encode(tag_a)
    b = _get_encoder().encode(tag_b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def _classify_relation(
    belief: BeliefInput,
    prior_commitment: float,
    prior_crystallization: float,
    prior_polarity: str,
    cosine_sim: float,
    metadata_delta_penalty: float,
) -> tuple[str, float, dict[str, Any]]:
    commitment_delta = belief.claim_commitment - prior_commitment
    crystal_delta = belief.crystallization - prior_crystallization
    polarity_flip = belief.polarity != prior_polarity

    flags: dict[str, Any] = {
        "cosine_similarity": cosine_sim,
        "metadata_delta_penalty": metadata_delta_penalty,
        "commitment_delta": round(commitment_delta, 4),
        "crystal_delta": round(crystal_delta, 4),
        "candidate_types": [],
    }

    if commitment_delta <= -0.3 and crystal_delta < 0:
        # Distance from nearest threshold boundary → higher = more confident
        dist = min(abs(commitment_delta + 0.3), abs(crystal_delta))
        confidence = min(1.0, 0.80 + dist * 2.0)
        flags["candidate_types"] = ["CONTRACTION"]
        return "CONTRACTION", round(confidence, 4), flags

    if commitment_delta >= 0.3 and crystal_delta > 0:
        dist = min(abs(commitment_delta - 0.3), abs(crystal_delta))
        confidence = min(1.0, 0.80 + dist * 2.0)
        flags["candidate_types"] = ["REVISION"]
        return "REVISION", round(confidence, 4), flags

    if polarity_flip:
        has_temporal = bool(_TEMPORAL_RE.search(belief.belief_text))
        flags["candidate_types"] = ["CONTRACTION", "REVISION"]
        flags["temporal_negation_match"] = has_temporal
        if has_temporal:
            return "CONTRACTION", 0.65, flags
        return "CONTRACTION_OR_REVISION", 0.50, flags

    # No polarity flip — small delta means elaboration; large/mixed delta is still ambiguous
    if abs(commitment_delta) < 0.2 and abs(crystal_delta) < 0.2:
        flags["candidate_types"] = ["ELABORATION"]
        return "ELABORATION", 0.65, flags

    flags["candidate_types"] = ["CONTRACTION_OR_REVISION"]
    return "CONTRACTION_OR_REVISION", 0.50, flags


def run_matching_pipeline(
    belief: BeliefInput,
    user_id: str,
    embedding: list[float] | None = None,
    exclude_canonical_ids: list[str] | None = None,
) -> MatchResult:
    if embedding is None:
        embedding = encode(belief.belief_text)

    # Stage 1: vector search (user-scoped, domain filter removed — applied as penalty in Stage 3)
    candidates = vec_store.query(
        embedding, user_id, belief.self_domain,
        n_results=10,
        exclude_ids=exclude_canonical_ids,
    )
    if not candidates:
        return MatchResult(canonical_id=None, relation_to_prior=None, match_confidence=None, relation_confidence=None)

    # Stage 2: loose cosine floor to bound the candidate set — subject_sim handles topic filtering
    valid: list[tuple[dict[str, Any], float, float]] = []  # (candidate, belief_cosine, subject_sim)
    for c in candidates:
        belief_cosine = 1.0 - c["distance"]
        if belief_cosine < 0.15:
            continue
        candidate_tag = c["metadata"].get("subject_tag", "")
        subj_sim = _subject_similarity(belief.subject_tag, candidate_tag)
        valid.append((c, belief_cosine, subj_sim))
    if not valid:
        return MatchResult(canonical_id=None, relation_to_prior=None, match_confidence=None, relation_confidence=None)

    # Stage 3: composite = 0.45 * belief_cosine + 0.40 * subject_sim + 0.15 * (1 - metadata_penalty)
    # subject_sim is weighted heavily so topic drift penalizes rather than gates the match
    best_candidate: dict[str, Any] | None = None
    best_composite = -1.0
    best_cosine = 0.0
    best_penalty = 0.0
    best_subject_sim = 0.0

    for c, belief_cosine, subj_sim in valid:
        meta = c["metadata"]
        commit_delta = belief.claim_commitment - float(meta.get("claim_commitment", 0.5))
        crystal_delta = belief.crystallization - float(meta.get("crystallization", 0.5))
        metadata_delta_penalty = abs(commit_delta) * 0.5 + abs(crystal_delta) * 0.5
        composite = 0.45 * belief_cosine + 0.40 * subj_sim + 0.15 * (1.0 - metadata_delta_penalty)
        if composite > best_composite:
            best_composite = composite
            best_candidate = c
            best_cosine = belief_cosine
            best_penalty = metadata_delta_penalty
            best_subject_sim = subj_sim

    if best_composite < 0.50 or best_candidate is None:
        return MatchResult(canonical_id=None, relation_to_prior=None, match_confidence=None, relation_confidence=None)

    matched_id = best_candidate["canonical_id"]

    # Stage 4: relation classifier — look up matched prior from current_beliefs
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT claim_commitment, crystallization, polarity FROM current_beliefs WHERE canonical_id = ?",
            (matched_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        # ChromaDB has a vector but current_beliefs is missing (data integrity issue) — treat as new
        return MatchResult(canonical_id=None, relation_to_prior=None, match_confidence=None, relation_confidence=None)

    relation, rel_confidence, flags = _classify_relation(
        belief,
        float(row["claim_commitment"]),
        float(row["crystallization"]),
        row["polarity"],
        best_cosine,
        best_penalty,
    )
    flags["domain_match"] = best_candidate.get("domain_match", False)
    flags["subject_similarity"] = round(best_subject_sim, 4)
    flags["subject_tag_query"] = belief.subject_tag
    flags["subject_tag_match"] = best_candidate["metadata"].get("subject_tag", "")

    return MatchResult(
        canonical_id=matched_id,
        relation_to_prior=relation,
        match_confidence=round(best_composite, 4),
        relation_confidence=rel_confidence,
        relation_classifier_flags=flags,
    )
