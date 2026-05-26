from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from typing import Literal
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.models.input import EvaluationInput
from app.models.output import EvaluationResponse
from app.pipeline.preprocess import build_turn_pairs, chunk_turns
from app.pipeline.extract import extract_beliefs
from app.pipeline.verify import verify_beliefs
from app.pipeline.aggregate import build_response
from app.pipeline.persist import persist_beliefs
from app.db.schema import init_db, get_connection

logger = logging.getLogger(__name__)

app = FastAPI(title="Lore Conversational Evaluation API", version="1.0")

_STORYBOT_FIELDS = {
    "belief_id", "belief_text", "belief_state", "self_domain",
    "polarity", "claim_commitment", "crystallization", "affective_charge", "delta",
}
_RECOMMENDATION_FIELDS = {
    "belief_id", "self_domain", "confidence",
    "claim_commitment", "crystallization", "session_weight", "delta",
}


def _filter_view(data: dict, view: str) -> dict:
    if view == "full":
        return data
    fields = _STORYBOT_FIELDS if view == "storybot" else _RECOMMENDATION_FIELDS
    data = dict(data)
    data["beliefs"] = [{k: v for k, v in b.items() if k in fields} for b in data.get("beliefs", [])]
    return data


def _apply_view(response: EvaluationResponse, view: str) -> dict:
    return _filter_view(response.model_dump(), view)


def _source_id(body) -> str:
    if body.source_type == "conversation":
        return f"conv-{body.ref_conversation_id}-{body.ref_user_id}"
    return f"disc-{body.post_id}-{body.ref_user_id}"


@app.post("/conversations/evaluate")
def evaluate(
    body: EvaluationInput,
    view: Literal["full", "storybot", "recommendation"] = "full",
) -> JSONResponse:
    turns = build_turn_pairs(body)
    if not turns:
        raise HTTPException(status_code=422, detail="No extractable user turns found.")

    chunks = chunk_turns(turns)
    raw = extract_beliefs(chunks, body.source_type)
    verified = verify_beliefs(raw)
    response = build_response(verified, body, turns)

    full_data = _apply_view(response, "full")

    # Cache the full response so revisiting the conversation reloads results
    try:
        init_db()
        _conn = get_connection()
        _conn.execute(
            "INSERT OR REPLACE INTO evaluation_cache (source_id, response_json, cached_at) VALUES (?, ?, ?)",
            (_source_id(body), json.dumps(full_data), datetime.now(timezone.utc).isoformat()),
        )
        _conn.commit()
        _conn.close()
    except Exception:
        logger.exception("Failed to cache evaluation for %s", _source_id(body))

    # Persist belief graph — failures are non-fatal so evaluation always returns
    try:
        session_ts = turns[0].transaction_datetime_utc if turns else None
        persist_beliefs(response.beliefs, str(body.ref_user_id), session_ts)
    except Exception:
        logger.exception("Failed to persist beliefs for user %s", body.ref_user_id)

    return JSONResponse(content=_filter_view(full_data, view))


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

    data = json.loads(row["response_json"])
    return JSONResponse(content=_filter_view(data, view))


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


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
