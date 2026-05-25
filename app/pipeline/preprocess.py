from __future__ import annotations
from dataclasses import dataclass
from app.models.input import ConversationInput, DiscussionInput

STORYBOT_USER_ID = 1
MAX_TURNS_PER_CHUNK = 20
OVERLAP_TURNS = 3


@dataclass
class TurnPair:
    turn_index: int
    preceding_context: str | None
    user_response: str
    prompted: bool
    ref_conversation_id: int | None
    ref_user_id: int
    transaction_datetime_utc: str | None
    post_id: int | None
    comment_id: int | None
    source_type: str


def build_turn_pairs(request: ConversationInput | DiscussionInput) -> list[TurnPair]:
    if request.source_type == "conversation":
        return _from_conversation(request)
    return _from_discussion(request)


def _from_conversation(req: ConversationInput) -> list[TurnPair]:
    pairs: list[TurnPair] = []
    last_bot: str | None = None

    for raw_index, msg in enumerate(req.turns):
        if msg.ref_user_id == STORYBOT_USER_ID:
            last_bot = msg.message
        else:
            pairs.append(TurnPair(
                turn_index=raw_index,
                preceding_context=last_bot,
                user_response=msg.message,
                prompted=last_bot is not None,
                ref_conversation_id=msg.ref_conversation_id,
                ref_user_id=msg.ref_user_id,
                transaction_datetime_utc=msg.transaction_datetime_utc,
                post_id=None,
                comment_id=None,
                source_type="conversation",
            ))
            last_bot = None

    return pairs


def _from_discussion(req: DiscussionInput) -> list[TurnPair]:
    # Original post text used as preceding_context for all comments
    original_post: str | None = None
    for msg in req.turns:
        if msg.comment_id is None:
            original_post = msg.text
            break

    pairs: list[TurnPair] = []

    for raw_index, msg in enumerate(req.turns):
        if msg.reported_or_removed:
            continue
        if msg.author_ref_user_id != req.ref_user_id:
            continue

        is_op = msg.comment_id is None
        pairs.append(TurnPair(
            turn_index=raw_index,
            preceding_context=None if is_op else original_post,
            user_response=msg.text,
            prompted=False,
            ref_conversation_id=None,
            ref_user_id=msg.author_ref_user_id,
            transaction_datetime_utc=None,
            post_id=msg.post_id,
            comment_id=msg.comment_id,
            source_type="discussion",
        ))

    return pairs


def chunk_turns(
    turns: list[TurnPair],
    max_turns: int = MAX_TURNS_PER_CHUNK,
    overlap: int = OVERLAP_TURNS,
) -> list[list[TurnPair]]:
    if len(turns) <= max_turns:
        return [turns]

    stride = max_turns - overlap
    chunks: list[list[TurnPair]] = []
    start = 0
    while start < len(turns):
        chunks.append(turns[start : start + max_turns])
        if start + max_turns >= len(turns):
            break
        start += stride
    return chunks
