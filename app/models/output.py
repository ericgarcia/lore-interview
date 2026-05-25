from __future__ import annotations
from typing import Literal
from pydantic import BaseModel

SelfDomain = Literal["identity", "capability", "value", "relational", "aspirational"]


class SourceEvidence(BaseModel):
    ref_conversation_id: int | None = None
    turn_index: int | None = None
    transaction_datetime_utc: str | None = None
    post_id: int | None = None
    comment_id: int | None = None


class DataQuality(BaseModel):
    turn_count: int
    viable: bool
    confidence_adjustment: float
    viable_threshold: int = 8


class BeliefObject(BaseModel):
    belief_id: str
    belief_text: str
    belief_type: Literal["explicit", "implicit"]
    self_domain: SelfDomain
    polarity: Literal["positive", "negative", "neutral"]
    temporal_scope: str | None = None
    confidence: float
    session_weight: float
    source_evidence: list[SourceEvidence]
    claim_commitment: float
    crystallization: float
    affective_charge: str | None = None
    belief_state: Literal["crystallized", "transitioning"]
    delta: Literal["new", "reinforced", "contradicted", "unchanged"]
    nli_confidence: float
    evidence_span: str
    depth_markers: list[str]


class DomainSummary(BaseModel):
    domain: SelfDomain
    belief_count: int
    avg_commitment: float
    avg_crystallization: float


class Signal(BaseModel):
    richness_score: float
    belief_count: int
    high_confidence_count: int
    dominant_self_domain: SelfDomain | None
    beliefs_by_domain: dict[str, int]
    domain_summaries: list[DomainSummary]


class EvaluationResponse(BaseModel):
    schema_version: str = "1.0"
    source_type: Literal["conversation", "discussion"]
    ref_conversation_id: int | None = None
    post_id: int | None = None
    ref_user_id: int
    processing_mode: str = "sync"
    extraction_method: str = "baml+nli"
    data_quality: DataQuality
    signal: Signal
    beliefs: list[BeliefObject]
