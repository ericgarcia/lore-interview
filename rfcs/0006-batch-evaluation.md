# RFC 0006 — Batch Parallel Evaluation

## Status: Draft

## Motivation

Currently, evaluating a source requires manually navigating to it in the explorer and clicking Evaluate. Running the full dataset requires N sequential clicks and page visits. The LLM extraction step (Gemini Flash via BAML) dominates latency (~3–8s per source), so parallelism is the obvious lever.

This RFC specifies:
1. Migrating the BAML client from sync to async so multiple evaluations can be in-flight simultaneously.
2. A new `/batch/evaluate` API that accepts a list of sources and runs them concurrently under a configurable semaphore.
3. Server-Sent Events (SSE) for live per-source progress on the frontend.
4. A dedicated `/batch` page with source selection, run controls, and a progress panel.

---

## 1. Async BAML migration

### Problem

`b.ExtractBeliefs(...)` from `baml_client.sync_client` blocks the event loop. Running N evaluations concurrently in a single FastAPI process requires async I/O; blocking calls would serialize execution despite `asyncio.gather`.

### Change

Replace `baml_client.sync_client.b` with `baml_client.async_client.b` in `app/pipeline/extract.py`:

```python
from baml_client.async_client import b as b_async

async def extract_from_chunk(turns, source_type, ctx=None):
    collector = _bp.Collector("metrics") if ctx is not None else None
    baml_options = {"collector": collector} if collector is not None else {}
    result = await b_async.ExtractBeliefs(
        turns=baml_turns, source_type=source_type, baml_options=baml_options
    )
    # token/retry accounting unchanged
    return result.beliefs

async def extract_beliefs(chunks, source_type, ctx=None):
    beliefs = []
    for chunk in chunks:
        beliefs.extend(await extract_from_chunk(chunk, source_type, ctx))
    return beliefs
```

The NLI `CrossEncoder` inference in `verify.py` is CPU-bound and runs locally (fast, ~50ms). It will be wrapped with `asyncio.get_event_loop().run_in_executor(None, ...)` to avoid blocking the event loop during batch runs.

The existing `/conversations/evaluate` endpoint becomes `async def evaluate(...)` with `await` calls through the pipeline. No external contract changes — the request/response shape is identical.

---

## 2. Batch API

### Concurrency

Controlled by `BATCH_CONCURRENCY` env var (default: `3`). A single `asyncio.Semaphore` is created at startup and shared across all batch runs.

```python
import os, asyncio
_sem = asyncio.Semaphore(int(os.environ.get("BATCH_CONCURRENCY", "3")))
```

### In-memory batch state

```python
from dataclasses import dataclass, field
from typing import Literal
import uuid

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
    created_at: float = field(default_factory=time.monotonic)

_runs: dict[str, BatchRun] = {}
```

State is transient — it lives only as long as the server process. Completed evaluations are retrievable via the existing `GET /evaluations/{source_id}` cache endpoint.

### Endpoints

#### `POST /batch/evaluate`

Accepts a list of source payloads (same shape as `EvaluationInput`), kicks off background tasks, returns immediately.

```
POST /batch/evaluate
Content-Type: application/json

{
  "sources": [ <EvaluationInput>, ... ]
}

→ 202 Accepted
{ "batch_id": "uuid", "count": 12 }
```

The endpoint creates a `BatchRun`, spawns `asyncio.create_task` for each source, and returns. Each task acquires `_sem`, runs the full evaluation pipeline, writes to the cache, then releases `_sem`.

#### `GET /batch/{batch_id}/progress`

SSE stream. Emits one JSON event per state transition, then a terminal `done` event.

```
GET /batch/{batch_id}/progress
Accept: text/event-stream

data: {"source_id": "conv-12-7", "status": "running"}
data: {"source_id": "conv-12-7", "status": "done"}
data: {"source_id": "conv-44-7", "status": "error", "error": "No extractable user turns found."}
...
data: {"done": true, "succeeded": 11, "failed": 1}
```

Implementation uses `asyncio.Queue` per batch run. Each task pushes events onto the queue; the SSE handler reads from it and yields. The queue is drained when `done` is received.

#### `GET /batch/{batch_id}/status`

Non-streaming snapshot for reconnect/refresh cases. Returns current state of all items in the batch.

```
GET /batch/{batch_id}/status

→ {
  "batch_id": "uuid",
  "items": [
    { "source_id": "conv-12-7", "status": "done", "started_at": 1234, "completed_at": 1242, "error": null },
    ...
  ],
  "total": 12, "pending": 0, "running": 2, "done": 9, "error": 1
}
```

---

## 3. Frontend: `/batch` page

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ← back   Batch Evaluation                    [Run Selected (8)] │
├──────────────────────────┬──────────────────────────────────────┤
│ Source list              │ Progress panel                       │
│                          │                                      │
│ Filter: [All ▾] [User ▾] │ (empty until run starts)            │
│ [☐ Select all]           │                                      │
│                          │                                      │
│ ☑ User 7                 │                                      │
│   ☑ conv-12-7   done ✓   │ conv-12-7   ████████████  done      │
│   ☑ conv-44-7   —        │ conv-44-7   ████░░░░░░░░  running   │
│   ☐ conv-51-7   done ✓   │ conv-19-7   ░░░░░░░░░░░░  pending   │
│                          │ ...                                  │
│ ☑ User 12                │                                      │
│   ☑ disc-99-12  —        │                                      │
│   ☐ disc-101-12 done ✓   │                                      │
└──────────────────────────┴──────────────────────────────────────┘
```

### Behaviour

- **Source list**: Grouped by user. Each source shows its evaluated/unevaluated status (from the existing `/api/data` index plus a check against cached evaluations). Default filter: unevaluated only.
- **Selection**: Checkboxes at source and user level. "Select all" applies current filter. Selected count shown in Run button.
- **Run**: POSTs selected sources to `/batch/evaluate`, receives `batch_id`, opens `EventSource` on `/batch/{batch_id}/progress`.
- **Progress panel**: One row per selected source. Status badge: `pending` (dim) → `running` (spinner) → `done ✓` (green) / `error` (red, expandable message). Sources transition in real time as SSE events arrive.
- **Re-run**: After a run completes, individual errored sources can be re-queued with a retry button.
- **Already evaluated**: Sources with a cached result are shown as `done ✓` in the list and pre-filtered out by default, but can be included if the user wants to re-evaluate.

### Knowing which sources are unevaluated

The frontend calls `GET /api/evaluations/{source_id}` for each source on page load to determine evaluated status. This is N parallel requests against the local SQLite cache and is fast. The batch page renders a loading skeleton while these resolve.

---

## 4. Data flow summary

```
/batch page
  → POST /batch/evaluate [{source}, ...]
      → create BatchRun, spawn N asyncio tasks
      ← 202 { batch_id }
  → EventSource /batch/{batch_id}/progress
      task acquires _sem
        → await extract_beliefs (async BAML)
        → verify_beliefs (executor)
        → build_response, persist, cache
      task emits { source_id, status: "running" }
      task emits { source_id, status: "done"|"error" }
      ...
      → data: { done: true, succeeded, failed }
```

---

## 5. Open questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Sync vs async BAML client | Async — required for true concurrency in FastAPI |
| 2 | Job persistence | Transient in-memory only; completed results visible via existing cache |
| 3 | Concurrency limit | `BATCH_CONCURRENCY` env var, default 3 |
| 4 | Selection UI | Dedicated `/batch` page with table, filters, multi-select |
| 5 | SSE vs WebSocket | SSE — unidirectional progress push is sufficient; simpler than WS |

---

## 6. Files changed

| File | Change |
|------|--------|
| `app/pipeline/extract.py` | sync → async BAML client |
| `app/pipeline/verify.py` | wrap CrossEncoder in `run_in_executor` |
| `app/main.py` | `evaluate` becomes `async def`; add `/batch/evaluate`, `/batch/{id}/progress`, `/batch/{id}/status` |
| `app/models/batch.py` | `BatchRun`, `BatchItem` dataclasses, `_runs` registry |
| `lore-tool/app/batch/page.tsx` | new page |
| `lore-tool/app/api/batch/evaluate/route.ts` | proxy |
| `lore-tool/app/api/batch/[id]/progress/route.ts` | SSE proxy (pass-through stream) |
| `lore-tool/app/api/batch/[id]/status/route.ts` | proxy |
| `lore-tool/app/page.tsx` | add "Batch Evaluate" nav link |
