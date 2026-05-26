# Lore Belief Extraction API

A conversational evaluation pipeline that extracts and tracks user self-beliefs from StoryBot conversations and community discussions.

## Philosophy

This system is in active development. The current approach uses a large language model (Gemini 2.5 Flash) with deliberately high-latency, high-fidelity extraction rather than a fast heuristic classifier. The reasoning: the space of human identity and self-belief is broad and poorly understood from first principles. Leading with too many assumptions — fixed taxonomies, rigid feature schemas, hard-coded categories — risks encoding our biases before we've seen enough real data to know what actually matters.

The LLM acts as a flexible extraction layer that surfaces the full richness of how people describe themselves. As we accumulate evaluations, patterns emerge organically: which belief domains appear most, how beliefs evolve across conversations, what language signals commitment vs. ambivalence. That empirical base is the right foundation for eventually formalizing the approach — tightening prompts, replacing expensive calls with cheaper models, or introducing structured classifiers — but that formalization should follow the data, not precede it.

---

## Architecture

```
Conversations / Discussions (JSON or SQLite)
        │
        ▼
  Preprocessing        — segment user turns, build context windows
        │
        ▼
  Belief Extraction    — Gemini 2.5 Flash via BAML (async)
        │
        ▼
  NLI Verification     — cross-encoder/nli-deberta-v3-small
        │              — scores extracted beliefs against full turn text
        ▼
  Aggregation          — deduplication, domain scoring, richness signal
        │
        ▼
  Persistence          — SQLite: belief graph, categories, metrics
        │
        ▼
  FastAPI + Next.js    — evaluation UI, batch runner, belief explorer
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Google AI API key ([aistudio.google.com](https://aistudio.google.com))

### 1. Clone and install Python dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_API_KEY=your_key_here
BATCH_CONCURRENCY=3        # max parallel evaluations (raise to 10 for speed)
DB_PATH=lore.db            # SQLite database path (default)
```

### 3. Seed the database

Populates `conversation_turns` and `discussion_turns` from the JSON data files. Idempotent — safe to re-run after adding new conversations.

```bash
python scripts/seed_db.py
# Seeded 881 conversation turns, 516 discussion turns
```

### 4. Start the API server

```bash
uvicorn app.main:app --reload --port 8000
```

The API is now available at `http://localhost:8000`. Schema and docs at `http://localhost:8000/docs`.

### 5. Start the web UI (optional)

```bash
cd lore-tool
npm install
npm run dev
# → http://localhost:3000
```

---

## API Endpoints

### Evaluation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/conversations/evaluate` | Extract beliefs from a single conversation or discussion |
| `GET` | `/evaluations/{source_id}` | Retrieve cached evaluation result |
| `GET` | `/evaluations/{source_id}/rejected` | NLI-rejected belief candidates for QA |

**Evaluate a conversation:**

```bash
curl -X POST http://localhost:8000/conversations/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "source_type": "conversation",
    "ref_conversation_id": 92818,
    "ref_user_id": 66,
    "turns": [
      {
        "ref_conversation_id": 92818,
        "ref_user_id": 1,
        "transaction_datetime_utc": "2023-10-01T08:00:00Z",
        "screen_name": "StoryBot",
        "message": "Good morning! How are you feeling today?"
      },
      {
        "ref_conversation_id": 92818,
        "ref_user_id": 66,
        "transaction_datetime_utc": "2023-10-01T08:05:00Z",
        "screen_name": "EagerExplorer",
        "message": "I've been training for a half marathon. Running is just who I am."
      }
    ]
  }'
```

**Retrieve a cached result:**

```bash
curl http://localhost:8000/evaluations/conv-92818-66
```

### Batch evaluation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/batch/evaluate` | Start a parallel batch run; returns `batch_id` immediately |
| `GET` | `/batch/{batch_id}/progress` | SSE stream of per-source progress events |
| `GET` | `/batch/{batch_id}/status` | Snapshot of current batch state |

**Start a batch run:**

```bash
curl -X POST http://localhost:8000/batch/evaluate \
  -H "Content-Type: application/json" \
  -d '{"sources": [<EvaluationInput>, ...]}'
# → {"batch_id": "uuid", "count": 12}
```

**Stream progress:**

```bash
curl -N http://localhost:8000/batch/{batch_id}/progress
# data: {"source_id": "conv-92818-66", "status": "running"}
# data: {"source_id": "conv-92818-66", "status": "done"}
# data: {"done": true, "succeeded": 11, "failed": 1}
```

### Belief graph

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/users/{user_id}/beliefs` | Full belief lineage with event history |
| `GET` | `/users/{user_id}/beliefs/categories` | Clustered belief categories with adjacencies |
| `GET` | `/users/{user_id}/simulation-context` | Belief profile + conversation history for generation |

### Data & metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/data` | All users and conversation sources from SQLite |
| `GET` | `/metrics/summary` | Aggregate pipeline metrics across all evaluations |
| `GET` | `/metrics/history` | Per-evaluation metrics history |
| `GET` | `/health` | Liveness check |

---

## Testing the endpoint

A minimal end-to-end test using the seeded data:

```bash
# 1. Health check
curl http://localhost:8000/health
# {"status":"ok"}

# 2. List available sources
curl http://localhost:8000/data | python3 -m json.tool | head -40

# 3. Evaluate a conversation (use the web UI or the batch endpoint for full payloads)
#    The web UI at localhost:3000 handles payload construction automatically.

# 4. Check metrics after a run
curl http://localhost:8000/metrics/summary | python3 -m json.tool

# 5. Inspect rejected beliefs for QA
curl http://localhost:8000/evaluations/conv-92818-66/rejected | python3 -m json.tool
```

For full evaluation testing, the **web UI** is the recommended path:

1. Open `http://localhost:3000`
2. Select a user from the sidebar
3. Click a conversation source → **Evaluate**
4. Or use **↗ Batch Evaluate** to run all unevaluated sources in parallel

---

## Simulating conversations

The `/simulate-conversation` Claude Code skill generates synthetic follow-up conversations from a user's belief profile:

```
/simulate-conversation 66
```

This calls `/users/{user_id}/simulation-context`, generates a realistic StoryBot conversation grounded in the user's extracted beliefs, and writes it to `data/simulated_{user_id}_{timestamp}.json`. Re-run `python scripts/seed_db.py` to ingest it, then evaluate via the batch UI.

---

## Project structure

```
app/
  main.py               — FastAPI application and all endpoints
  models/               — Pydantic input/output models, batch state
  pipeline/
    preprocess.py       — Turn segmentation and context windowing
    extract.py          — Async BAML belief extraction (Gemini 2.5 Flash)
    verify.py           — NLI verification (cross-encoder, thread pool)
    aggregate.py        — Deduplication, signal scoring, response building
    persist.py          — Belief graph persistence and two-pass matching
    context.py          — Metrics collection threading through pipeline
  db/
    schema.py           — SQLite schema and migrations
baml_src/               — BAML prompt definitions and client config
lore-tool/              — Next.js 16 belief explorer and evaluation UI
scripts/
  seed_db.py            — Seed SQLite from data/*.json files
rfcs/                   — Design documents for each major feature
```

---

## Key design decisions

**NLI verification over raw LLM output.** Extracted beliefs are cross-checked against the source turn text using a local NLI model before being persisted. This catches hallucinations where the LLM infers a belief the user didn't actually express. The full user turn (not just the extracted evidence span) is used as the NLI premise to resolve anaphora.

**Async pipeline with bounded concurrency.** The LLM call dominates latency (~3–8s). Using `asyncio` with a configurable semaphore (`BATCH_CONCURRENCY`) lets multiple evaluations run in parallel without overwhelming the API rate limit.

**Belief graph over flat storage.** Each belief has a canonical identity that persists across sessions. New evaluations are matched against the existing graph to track deltas — whether a belief was reinforced, contradicted, or elaborated over time — rather than treating each conversation independently.
