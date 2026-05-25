from __future__ import annotations
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field


class ConversationTurn(BaseModel):
    ref_conversation_id: int
    ref_user_id: int
    transaction_datetime_utc: str
    screen_name: str
    message: str


class DiscussionTurn(BaseModel):
    author_ref_user_id: int
    post_id: int
    comment_id: int | None
    text: str
    reported_or_removed: bool = False


class ConversationInput(BaseModel):
    source_type: Literal["conversation"]
    ref_conversation_id: int
    ref_user_id: int
    session_number: int = 1
    prior_belief_ids: list[str] = Field(default_factory=list)
    webhook_url: str | None = None
    turns: list[ConversationTurn]


class DiscussionInput(BaseModel):
    source_type: Literal["discussion"]
    post_id: int
    ref_user_id: int
    prior_belief_ids: list[str] = Field(default_factory=list)
    webhook_url: str | None = None
    turns: list[DiscussionTurn]


EvaluationInput = Annotated[
    Union[ConversationInput, DiscussionInput],
    Field(discriminator="source_type"),
]
