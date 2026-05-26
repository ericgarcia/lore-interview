from __future__ import annotations
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

BatchStatus = Literal["pending", "running", "done", "error"]


@dataclass
class BatchItem:
    source_id: str
    status: BatchStatus = "pending"
    started_at: float | None = None
    completed_at: float | None = None
    error: str | None = None


@dataclass
class BatchRun:
    batch_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    items: list[BatchItem] = field(default_factory=list)
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    created_at: float = field(default_factory=time.monotonic)


# In-memory registry — transient, cleared on server restart
_runs: dict[str, BatchRun] = {}
