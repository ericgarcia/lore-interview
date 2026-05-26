from __future__ import annotations
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Literal
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from app.models.input import EvaluationInput, ConversationInput, DiscussionInput
from app.models.output import EvaluationResponse
from app.models.batch import BatchItem, BatchRun, _runs
from app.pipeline.preprocess import build_turn_pairs, chunk_turns
from app.pipeline.extract import extract_beliefs
from app.pipeline.verify import verify_beliefs
from app.pipeline.aggregate import build_response, VIABLE_THRESHOLD
from app.pipeline.persist import persist_beliefs
from app.pipeline.context import MetricsContext, write_metrics
from app.pipeline.verify import RejectedBelief
from app.db.schema import init_db, get_connection

logger = logging.getLogger(__name__)

app = FastAPI(title="Lore Conversational Evaluation API", version="1.0")

_sem: asyncio.Semaphore | None = None


@app.on_event("startup")
async def _startup() -> None:
    global _sem
    _sem = asyncio.Semaphore(int(os.environ.get("BATCH_CONCURRENCY", "3")))


def _source_id(body: ConversationInput | DiscussionInput) -> str:
    if body.source_type == "conversation":
        return f"conv-{body.ref_conversation_id}-{body.ref_user_id}"
    return f"disc-{body.post_id}-{body.ref_user_id}"


def _ms(t0_ns: int) -> int:
    return int((time.monotonic_ns() - t0_ns) / 1_000_000)


def _persist_rejected(source_id: str, evaluation_id: str, rejected: list[RejectedBelief]) -> None:
    import uuid as _uuid
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM rejected_beliefs WHERE source_id = ?", (source_id,))
            for r in rejected:
                conn.execute(
                    """INSERT INTO rejected_beliefs (
                        id, source_id, evaluation_id, rejection_reason,
                        belief_text, belief_type, subject_tag, self_domain, polarity,
                        claim_commitment, crystallization, affective_charge,
                        evidence_spans, depth_markers, nli_premise, nli_score, nli_threshold, recorded_at
                    ) VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?,?,?)""",
                    (
                        str(_uuid.uuid4()), source_id, evaluation_id, r.reason,
                        r.belief.belief_text, r.belief.belief_type,
                        r.belief.subject_tag or "",
                        str(r.belief.self_domain).split(".")[-1].lower(),
                        str(r.belief.polarity).split(".")[-1].lower(),
                        r.belief.claim_commitment, r.belief.crystallization,
                        str(r.belief.affective_charge).split(".")[-1].lower() if r.belief.affective_charge else None,
                        json.dumps(r.belief.evidence_spans),
                        json.dumps(r.belief.depth_markers),
                        r.nli_premise, r.nli_score, r.nli_threshold, now,
                    ),
                )
    finally:
        conn.close()


async def _run_pipeline(body: ConversationInput | DiscussionInput) -> dict:
    """Run the full evaluation pipeline and return the cached full response dict."""
    total_t0 = time.monotonic_ns()
    ctx = MetricsContext(source_type=body.source_type, ref_user_id=body.ref_user_id)

    t0 = time.monotonic_ns()
    turns = build_turn_pairs(body)
    if not turns:
        raise ValueError("No extractable user turns found.")
    chunks = chunk_turns(turns)
    ctx.preprocess_ms = _ms(t0)
    ctx.turn_count = len(turns)
    ctx.chunk_count = len(chunks)
    ctx.viable = len(turns) >= VIABLE_THRESHOLD

    t0 = time.monotonic_ns()
    raw = await extract_beliefs(chunks, body.source_type, ctx)
    ctx.extract_ms = _ms(t0)
    ctx.beliefs_extracted = len(raw)

    turn_text_map = {t.turn_index: t.user_response for t in turns}

    t0 = time.monotonic_ns()
    verified, rejected = await verify_beliefs(raw, turn_text_map)
    ctx.verify_ms = _ms(t0)
    ctx.beliefs_verified = len(verified)

    t0 = time.monotonic_ns()
    response = build_response(verified, body, turns, ctx)
    ctx.aggregate_ms = _ms(t0)
    ctx.beliefs_final = len(response.beliefs)

    full_data = response.model_dump()

    sid = _source_id(body)

    try:
        init_db()
        _conn = get_connection()
        _conn.execute(
            "INSERT OR REPLACE INTO evaluation_cache (source_id, response_json, cached_at) VALUES (?, ?, ?)",
            (sid, json.dumps(full_data), datetime.now(timezone.utc).isoformat()),
        )
        _conn.commit()
        _conn.close()
    except Exception:
        logger.exception("Failed to cache evaluation for %s", sid)

    ctx.total_latency_ms = _ms(total_t0)
    try:
        init_db()
        write_metrics(ctx)
    except Exception:
        logger.exception("Failed to write metrics for %s", sid)

    try:
        _persist_rejected(sid, ctx.evaluation_id, rejected)
    except Exception:
        logger.exception("Failed to persist rejected beliefs for %s", sid)

    t0 = time.monotonic_ns()
    try:
        session_ts = turns[0].transaction_datetime_utc if turns else None
        persist_beliefs(response.beliefs, str(body.ref_user_id), session_ts)
    except Exception:
        logger.exception("Failed to persist beliefs for user %s", body.ref_user_id)
    ctx.persist_ms = _ms(t0)

    return full_data


@app.post("/conversations/evaluate")
async def evaluate(
    body: EvaluationInput,
    view: Literal["full", "storybot", "recommendation"] = "full",
) -> JSONResponse:
    try:
        full_data = await _run_pipeline(body)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return JSONResponse(content=full_data)


# ---------------------------------------------------------------------------
# Batch evaluation
# ---------------------------------------------------------------------------

class BatchRequest(BaseModel):
    sources: list[EvaluationInput]


async def _run_batch_item(
    body: ConversationInput | DiscussionInput,
    item: BatchItem,
    queue: asyncio.Queue,
) -> None:
    assert _sem is not None
    async with _sem:
        item.status = "running"
        item.started_at = time.monotonic()
        await queue.put({"source_id": item.source_id, "status": "running"})
        try:
            await _run_pipeline(body)
            item.status = "done"
            item.completed_at = time.monotonic()
            await queue.put({"source_id": item.source_id, "status": "done"})
        except Exception as e:
            item.status = "error"
            item.error = str(e)
            item.completed_at = time.monotonic()
            await queue.put({"source_id": item.source_id, "status": "error", "error": str(e)})


@app.post("/batch/evaluate", status_code=202)
async def batch_evaluate(req: BatchRequest) -> JSONResponse:
    run = BatchRun()
    _runs[run.batch_id] = run

    tasks = []
    for body in req.sources:
        sid = _source_id(body)
        item = BatchItem(source_id=sid)
        run.items.append(item)
        tasks.append(asyncio.create_task(_run_batch_item(body, item, run.queue)))

    async def _finish_sentinel() -> None:
        await asyncio.gather(*tasks, return_exceptions=True)
        succeeded = sum(1 for i in run.items if i.status == "done")
        failed = sum(1 for i in run.items if i.status == "error")
        await run.queue.put({"done": True, "succeeded": succeeded, "failed": failed})

    asyncio.create_task(_finish_sentinel())

    return JSONResponse(
        content={"batch_id": run.batch_id, "count": len(run.items)},
        status_code=202,
    )


@app.get("/batch/{batch_id}/progress")
async def batch_progress(batch_id: str) -> StreamingResponse:
    run = _runs.get(batch_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Batch run not found")

    async def _stream():
        while True:
            event = await run.queue.get()
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("done"):
                break

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/batch/{batch_id}/status")
async def batch_status(batch_id: str) -> JSONResponse:
    run = _runs.get(batch_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Batch run not found")

    counts: dict[str, int] = {"pending": 0, "running": 0, "done": 0, "error": 0}
    for item in run.items:
        counts[item.status] += 1

    return JSONResponse(content={
        "batch_id": run.batch_id,
        "items": [
            {
                "source_id": i.source_id,
                "status": i.status,
                "started_at": i.started_at,
                "completed_at": i.completed_at,
                "error": i.error,
            }
            for i in run.items
        ],
        "total": len(run.items),
        **counts,
    })


# ---------------------------------------------------------------------------
# Existing read endpoints (unchanged)
# ---------------------------------------------------------------------------

@app.get("/evaluations/{source_id}")
def get_cached_evaluation(
    source_id: str,
    view: Literal["full", "storybot", "recommendation"] = "full",
) -> JSONResponse:
    try:
        init_db()
    except Exception:
        logger.exception("Failed to initialize DB")

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT response_json FROM evaluation_cache WHERE source_id = ?",
            (source_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="No cached evaluation found")

    return JSONResponse(content=json.loads(row["response_json"]))


@app.get("/evaluations/{source_id}/rejected")
def get_rejected_beliefs(source_id: str) -> JSONResponse:
    try:
        init_db()
    except Exception:
        logger.exception("Failed to initialize DB")

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM rejected_beliefs WHERE source_id = ? ORDER BY rowid",
            (source_id,),
        ).fetchall()
    finally:
        conn.close()

    results = []
    for r in rows:
        results.append({
            "id": r["id"],
            "rejection_reason": r["rejection_reason"],
            "belief_text": r["belief_text"],
            "belief_type": r["belief_type"],
            "subject_tag": r["subject_tag"],
            "self_domain": r["self_domain"],
            "polarity": r["polarity"],
            "claim_commitment": r["claim_commitment"],
            "crystallization": r["crystallization"],
            "affective_charge": r["affective_charge"],
            "evidence_spans": json.loads(r["evidence_spans"]),
            "depth_markers": json.loads(r["depth_markers"]),
            "nli_premise": r["nli_premise"],
            "nli_score": r["nli_score"],
            "nli_threshold": r["nli_threshold"],
        })

    return JSONResponse(content={"source_id": source_id, "rejected": results})


@app.get("/users/{user_id}/beliefs")
def get_user_beliefs(user_id: str) -> JSONResponse:
    try:
        init_db()
    except Exception:
        logger.exception("Failed to initialize DB")

    conn = get_connection()
    try:
        identities = conn.execute(
            "SELECT id, created_at FROM belief_identities WHERE user_id = ? ORDER BY created_at",
            (user_id,),
        ).fetchall()

        lineages = []
        for identity in identities:
            canonical_id = identity["id"]

            current_row = conn.execute(
                "SELECT * FROM current_beliefs WHERE canonical_id = ?",
                (canonical_id,),
            ).fetchone()

            event_rows = conn.execute(
                "SELECT * FROM belief_events WHERE canonical_id = ? ORDER BY valid_from, recorded_at",
                (canonical_id,),
            ).fetchall()

            if not event_rows:
                continue

            lineages.append({
                "canonical_id": canonical_id,
                "current": dict(current_row) if current_row else None,
                "events": [dict(e) for e in event_rows],
            })
    finally:
        conn.close()

    return JSONResponse(content={"user_id": user_id, "lineages": lineages})


@app.get("/users/{user_id}/beliefs/categories")
def get_user_belief_categories(user_id: str) -> JSONResponse:
    try:
        init_db()
    except Exception:
        logger.exception("Failed to initialize DB")

    conn = get_connection()
    try:
        cat_rows = conn.execute(
            "SELECT id, label FROM belief_categories WHERE user_id = ? ORDER BY label",
            (user_id,),
        ).fetchall()

        result = []
        for cat in cat_rows:
            cat_id = cat["id"]

            adj_rows = conn.execute(
                """
                SELECT bc.id, bc.label, ca.similarity
                FROM category_adjacencies ca
                JOIN belief_categories bc ON (
                    CASE WHEN ca.category_id_a = ? THEN ca.category_id_b
                         ELSE ca.category_id_a END = bc.id
                )
                WHERE ca.category_id_a = ? OR ca.category_id_b = ?
                ORDER BY ca.similarity DESC
                """,
                (cat_id, cat_id, cat_id),
            ).fetchall()

            belief_rows = conn.execute(
                """
                SELECT cb.canonical_id, cb.belief_text, cb.self_domain, cb.polarity,
                       cb.claim_commitment, cb.crystallization, cb.affective_charge,
                       cb.belief_state, cb.valid_from
                FROM belief_category_memberships bcm
                JOIN current_beliefs cb ON cb.canonical_id = bcm.canonical_id
                WHERE bcm.category_id = ?
                ORDER BY cb.valid_from ASC
                """,
                (cat_id,),
            ).fetchall()

            result.append({
                "category_id": cat_id,
                "label": cat["label"],
                "adjacent": [
                    {"category_id": r["id"], "label": r["label"], "similarity": r["similarity"]}
                    for r in adj_rows
                ],
                "beliefs": [dict(r) for r in belief_rows],
            })
    finally:
        conn.close()

    return JSONResponse(content={"user_id": user_id, "categories": result})


@app.get("/metrics/summary")
def get_metrics_summary() -> JSONResponse:
    try:
        init_db()
    except Exception:
        logger.exception("Failed to initialize DB")

    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM evaluation_metrics ORDER BY evaluated_at DESC").fetchall()
    finally:
        conn.close()

    if not rows:
        return JSONResponse(content={"total_evaluations": 0})

    def _avg(vals: list) -> float | None:
        clean = [v for v in vals if v is not None]
        return round(sum(clean) / len(clean), 2) if clean else None

    def _sum(vals: list) -> int:
        return sum(v for v in vals if v is not None)

    def _pct(vals: list, p: int) -> float | None:
        clean = sorted(v for v in vals if v is not None)
        if not clean:
            return None
        idx = min(int(len(clean) * p / 100), len(clean) - 1)
        return round(clean[idx], 2)

    def _merge_dicts(dicts: list[str | None]) -> dict:
        merged: dict[str, int] = {}
        for raw in dicts:
            if raw is None:
                continue
            try:
                d = json.loads(raw)
                for k, v in d.items():
                    merged[k] = merged.get(k, 0) + (v or 0)
            except Exception:
                pass
        return merged

    latencies = [r["total_latency_ms"] for r in rows]
    viable_rate = _avg([1 if r["viable"] else 0 for r in rows])

    return JSONResponse(content={
        "total_evaluations": len(rows),
        "avg_latency_ms": _avg(latencies),
        "p90_latency_ms": _pct(latencies, 90),
        "avg_tokens_in": _avg([r["llm_tokens_in"] for r in rows]),
        "avg_tokens_out": _avg([r["llm_tokens_out"] for r in rows]),
        "total_tokens_in": _sum([r["llm_tokens_in"] for r in rows]),
        "total_tokens_out": _sum([r["llm_tokens_out"] for r in rows]),
        "avg_llm_retries": _avg([r["llm_retry_count"] for r in rows]),
        "avg_richness_score": _avg([r["richness_score"] for r in rows]),
        "avg_nli_rejection_rate": _avg([r["nli_rejection_rate"] for r in rows]),
        "viable_rate": viable_rate,
        "beliefs_by_domain": _merge_dicts([r["beliefs_by_domain"] for r in rows]),
        "beliefs_by_polarity": _merge_dicts([r["beliefs_by_polarity"] for r in rows]),
        "beliefs_by_affective_charge": _merge_dicts([r["beliefs_by_affective_charge"] for r in rows]),
        "beliefs_by_delta": _merge_dicts([r["beliefs_by_delta"] for r in rows]),
        "beliefs_by_state": _merge_dicts([r["beliefs_by_state"] for r in rows]),
        "avg_nli_confidence": _avg([
            json.loads(r["nli_confidence_stats"]).get("avg")
            for r in rows if r["nli_confidence_stats"]
        ]),
        "avg_claim_commitment": _avg([
            json.loads(r["commitment_stats"]).get("avg")
            for r in rows if r["commitment_stats"]
        ]),
        "avg_crystallization": _avg([
            json.loads(r["crystallization_stats"]).get("avg")
            for r in rows if r["crystallization_stats"]
        ]),
    })


@app.get("/metrics/history")
def get_metrics_history(limit: int = 50) -> JSONResponse:
    try:
        init_db()
    except Exception:
        logger.exception("Failed to initialize DB")

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT evaluated_at, source_type, total_latency_ms, llm_tokens_in, llm_tokens_out, "
            "llm_retry_count, richness_score, beliefs_final, nli_rejection_rate, viable "
            "FROM evaluation_metrics ORDER BY evaluated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    return JSONResponse(content=[dict(r) for r in rows])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
