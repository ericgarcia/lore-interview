from __future__ import annotations

from baml_client import b
from baml_client.types import ExtractedBelief, AffectiveCharge
from app.pipeline.preprocess import TurnPair

from baml_client.types import TurnPair as BamlTurnPair


def _to_baml_turn(t: TurnPair) -> BamlTurnPair:
    return BamlTurnPair(
        turn_index=t.turn_index,
        preceding_context=t.preceding_context,
        user_message=t.user_response,
        prompted=t.prompted,
    )


def extract_from_chunk(turns: list[TurnPair], source_type: str) -> list[ExtractedBelief]:
    baml_turns = [_to_baml_turn(t) for t in turns]
    result = b.ExtractBeliefs(turns=baml_turns, source_type=source_type)
    return result.beliefs


def extract_beliefs(chunks: list[list[TurnPair]], source_type: str) -> list[ExtractedBelief]:
    beliefs: list[ExtractedBelief] = []
    for chunk in chunks:
        beliefs.extend(extract_from_chunk(chunk, source_type))
    return beliefs
