from __future__ import annotations
import json
import statistics
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.db.schema import get_connection


@dataclass
class MetricsContext:
    evaluation_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    source_type: str = ""
    ref_user_id: int = 0
    evaluated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    preprocess_ms: int | None = None
    extract_ms: int | None = None
    verify_ms: int | None = None
    aggregate_ms: int | None = None
    persist_ms: int | None = None
    total_latency_ms: int | None = None

    llm_tokens_in: int = 0
    llm_tokens_out: int = 0
    llm_call_count: int = 0
    llm_retry_count: int = 0

    turn_count: int = 0
    chunk_count: int = 0
    viable: bool = False
    beliefs_extracted: int = 0
    beliefs_verified: int = 0
    beliefs_deduplicated: int = 0
    beliefs_final: int = 0

    nli_confidence_values: list[float] = field(default_factory=list)
    claim_commitment_values: list[float] = field(default_factory=list)
    crystallization_values: list[float] = field(default_factory=list)
    beliefs_by_domain: dict[str, int] = field(default_factory=dict)
    beliefs_by_polarity: dict[str, int] = field(default_factory=dict)
    beliefs_by_affective_charge: dict[str, int] = field(default_factory=dict)
    beliefs_by_delta: dict[str, int] = field(default_factory=dict)
    beliefs_by_state: dict[str, int] = field(default_factory=dict)
    explicit_belief_count: int = 0
    implicit_belief_count: int = 0


def _pct(values: list[float], p: int) -> float | None:
    if not values:
        return None
    s = sorted(values)
    idx = min(int(len(s) * p / 100), len(s) - 1)
    return round(s[idx], 4)


def _avg(values: list[float]) -> float | None:
    return round(statistics.mean(values), 4) if values else None


def write_metrics(ctx: MetricsContext) -> None:
    nli_rejection_rate = (
        round(1.0 - ctx.beliefs_verified / ctx.beliefs_extracted, 4)
        if ctx.beliefs_extracted > 0 else None
    )
    richness_score = (
        round(ctx.beliefs_final / ctx.turn_count, 4)
        if ctx.turn_count > 0 else None
    )

    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """INSERT OR REPLACE INTO evaluation_metrics (
                    id, source_type, ref_user_id, evaluated_at,
                    total_latency_ms, preprocess_ms, extract_ms, verify_ms, aggregate_ms, persist_ms,
                    llm_tokens_in, llm_tokens_out, llm_call_count, llm_retry_count,
                    turn_count, chunk_count, viable,
                    beliefs_extracted, beliefs_verified, beliefs_deduplicated, beliefs_final,
                    nli_rejection_rate, richness_score,
                    nli_confidence_stats, commitment_stats, crystallization_stats,
                    beliefs_by_domain, beliefs_by_polarity, beliefs_by_affective_charge,
                    beliefs_by_delta, beliefs_by_state,
                    explicit_belief_count, implicit_belief_count
                ) VALUES (
                    ?,?,?,?,  ?,?,?,?,?,?,  ?,?,?,?,  ?,?,?,  ?,?,?,?,  ?,?,
                    ?,?,?,  ?,?,?,  ?,?,  ?,?
                )""",
                (
                    ctx.evaluation_id, ctx.source_type, ctx.ref_user_id, ctx.evaluated_at,
                    ctx.total_latency_ms, ctx.preprocess_ms, ctx.extract_ms,
                    ctx.verify_ms, ctx.aggregate_ms, ctx.persist_ms,
                    ctx.llm_tokens_in, ctx.llm_tokens_out, ctx.llm_call_count, ctx.llm_retry_count,
                    ctx.turn_count, ctx.chunk_count, int(ctx.viable),
                    ctx.beliefs_extracted, ctx.beliefs_verified, ctx.beliefs_deduplicated, ctx.beliefs_final,
                    nli_rejection_rate, richness_score,
                    json.dumps({"avg": _avg(ctx.nli_confidence_values), "p50": _pct(ctx.nli_confidence_values, 50), "p90": _pct(ctx.nli_confidence_values, 90)}),
                    json.dumps({"avg": _avg(ctx.claim_commitment_values), "p50": _pct(ctx.claim_commitment_values, 50), "p90": _pct(ctx.claim_commitment_values, 90)}),
                    json.dumps({"avg": _avg(ctx.crystallization_values), "p50": _pct(ctx.crystallization_values, 50), "p90": _pct(ctx.crystallization_values, 90)}),
                    json.dumps(ctx.beliefs_by_domain),
                    json.dumps(ctx.beliefs_by_polarity),
                    json.dumps(ctx.beliefs_by_affective_charge),
                    json.dumps(ctx.beliefs_by_delta),
                    json.dumps(ctx.beliefs_by_state),
                    ctx.explicit_belief_count,
                    ctx.implicit_belief_count,
                ),
            )
    finally:
        conn.close()
