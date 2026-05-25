from __future__ import annotations
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


def verify_beliefs(beliefs: list[ExtractedBelief]) -> list[tuple[ExtractedBelief, float]]:
    verified: list[tuple[ExtractedBelief, float]] = []
    for belief in beliefs:
        if not belief.evidence_spans:
            continue
        if belief.claim_commitment < COMMITMENT_FLOOR:
            continue

        evidence = " ".join(belief.evidence_spans)
        score = _nli_score(evidence, belief.belief_text)

        threshold = DOMAIN_THRESHOLDS.get(belief.self_domain, 0.65)
        if score < threshold:
            continue

        verified.append((belief, score))
    return verified
