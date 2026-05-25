from __future__ import annotations
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

app = FastAPI(title="Lore Conversational Evaluation API", version="1.0")

_STORYBOT_FIELDS = {
    "belief_id", "belief_text", "belief_state", "self_domain",
    "polarity", "claim_commitment", "crystallization", "affective_charge", "delta",
}
_RECOMMENDATION_FIELDS = {
    "belief_id", "self_domain", "confidence",
    "claim_commitment", "crystallization", "session_weight", "delta",
}


def _apply_view(response: EvaluationResponse, view: str) -> dict:
    data = response.model_dump()
    if view == "full":
        return data
    fields = _STORYBOT_FIELDS if view == "storybot" else _RECOMMENDATION_FIELDS
    data["beliefs"] = [{k: v for k, v in b.items() if k in fields} for b in data["beliefs"]]
    return data


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

    return JSONResponse(content=_apply_view(response, view))


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
