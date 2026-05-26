from __future__ import annotations

import baml_py.baml_py as _bp
from baml_client.async_client import b as b_async
from baml_client.types import ExtractedBelief, AffectiveCharge
from app.pipeline.preprocess import TurnPair
from app.pipeline.context import MetricsContext

from baml_client.types import TurnPair as BamlTurnPair


def _to_baml_turn(t: TurnPair) -> BamlTurnPair:
    return BamlTurnPair(
        turn_index=t.turn_index,
        preceding_context=t.preceding_context,
        user_message=t.user_response,
        prompted=t.prompted,
    )


async def extract_from_chunk(
    turns: list[TurnPair],
    source_type: str,
    ctx: MetricsContext | None = None,
) -> list[ExtractedBelief]:
    baml_turns = [_to_baml_turn(t) for t in turns]
    collector = _bp.Collector("metrics") if ctx is not None else None
    baml_options = {"collector": collector} if collector is not None else {}
    result = await b_async.ExtractBeliefs(turns=baml_turns, source_type=source_type, baml_options=baml_options)

    if ctx is not None and collector is not None:
        log = collector.last
        if log is not None:
            if log.usage is not None:
                ctx.llm_tokens_in += log.usage.input_tokens or 0
                ctx.llm_tokens_out += log.usage.output_tokens or 0
            ctx.llm_retry_count += max(0, len(log.calls) - 1) if log.calls else 0
            ctx.llm_call_count += 1

    return result.beliefs


async def extract_beliefs(
    chunks: list[list[TurnPair]],
    source_type: str,
    ctx: MetricsContext | None = None,
) -> list[ExtractedBelief]:
    beliefs: list[ExtractedBelief] = []
    for chunk in chunks:
        beliefs.extend(await extract_from_chunk(chunk, source_type, ctx))
    return beliefs
