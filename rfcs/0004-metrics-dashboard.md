# RFC 0004 — Extraction Pipeline Metrics Dashboard

**Status:** Draft  
**Author:** Eric Garcia  
**Date:** 2026-05-26

---

## Problem

The pipeline has no runtime visibility. Every evaluation call passes through five distinct stages (preprocess → extract → verify → aggregate → persist), involves an external LLM call, and runs a local NLI model — but none of that is measured or recorded. Concretely:

- **Latency** is unknown. There is no baseline to detect regressions when the model or chunking strategy changes.
- **LLM cost is a blind spot.** Token usage (in/out) is not captured. Neither are retry counts. A single high-turn conversation that chunks into 5 LLM calls is invisible to any accounting.
- **The NLI funnel is opaque.** `verify_beliefs` silently drops beliefs that fail the entailment threshold. The ratio of extracted beliefs → verified beliefs — and how that varies by domain — is a direct measure of LLM precision, but it is never surfaced.
- **Belief quality has no aggregate view.** `claim_commitment`, `crystallization`, polarity, affective charge, and delta are computed per-belief but never aggregated fleet-wide. There is no way to ask "are users in this cohort expressing crystallized beliefs or transitioning ones?" without a one-off DB query.
- **Coverage cannot be tracked over time.** `signal.richness_score` (beliefs ÷ turns) is returned per response but never persisted as a queryable time series.

---

## Goals

1. Instrument the FastAPI pipeline to record a metrics record per evaluation call, written to SQLite in real time
2. Capture the metrics the product team cares about: latency, token usage, retry count, extraction funnel, and belief quality distribution
3. Expose aggregated metrics via two new read-only API endpoints
4. Add a `/metrics` page to the lore-tool Next.js app that visualizes these aggregates

---

## Non-Goals

- External metrics infrastructure (Prometheus, Grafana, Datadog) — SQLite is sufficient for this stage
- Per-user belief drilldown — that is covered by `GET /users/{user_id}/beliefs`
- Alerting or SLO enforcement
- Metrics for the `GET /evaluations/{source_id}` cache-read path (read-only, no pipeline)

---

## Metrics to Capture

### Operational (per request)

| Metric | Source | Notes |
|--------|--------|-------|
| `total_latency_ms` | Middleware timer | Wall time from request receipt to response sent |
| `preprocess_ms` | Stage timer | `build_turn_pairs` + `chunk_turns` |
| `extract_ms` | Stage timer | All LLM calls across all chunks |
| `verify_ms` | Stage timer | NLI cross-encoder pass |
| `aggregate_ms` | Stage timer | `build_response` + `_deduplicate` |
| `persist_ms` | Stage timer | Belief graph write + vector upsert |
| `llm_tokens_in` | BAML response metadata | Sum across all chunks |
| `llm_tokens_out` | BAML response metadata | Sum across all chunks |
| `llm_call_count` | Instrumented in `extract_beliefs` | One call per chunk |
| `llm_retry_count` | BAML retry hook or wrapper | Total retries across all chunks |

### Extraction Funnel (per request)

| Metric | Source |
|--------|--------|
| `turn_count` | `len(turns)` from preprocess |
| `chunk_count` | `len(chunks)` from preprocess |
| `viable` | `turn_count >= VIABLE_THRESHOLD` |
| `beliefs_extracted` | `len(raw)` before verify |
| `beliefs_verified` | `len(verified)` after NLI |
| `beliefs_deduplicated` | `len(deduplicated)` after dedup |
| `beliefs_final` | `len(response.beliefs)` |
| `nli_rejection_rate` | `1 - (beliefs_verified / beliefs_extracted)` |
| `richness_score` | `beliefs_final / turn_count` (already in Signal) |

### Belief Quality Distribution (per request, stored as JSON)

These are aggregated across all beliefs in the response and stored as a compact JSON blob per evaluation row, so the dashboard can compute fleet-wide distributions by reading all rows.

- `avg_nli_confidence`, `p50_nli_confidence`, `p90_nli_confidence`
- `avg_claim_commitment`, `avg_crystallization`
- `beliefs_by_domain` — `{identity: N, capability: N, ...}` (already in Signal)
- `beliefs_by_polarity` — `{positive: N, negative: N, neutral: N}`
- `beliefs_by_affective_charge` — `{distress: N, defiant: N, resigned: N, neutral: N, enthusiastic: N, null: N}`
- `beliefs_by_delta` — `{new: N, reinforced: N, contradicted: N, unchanged: N}`
- `beliefs_by_state` — `{crystallized: N, transitioning: N}`
- `explicit_belief_count`, `implicit_belief_count`

---

## Schema

New table added to the existing `lore.db` via `init_db()`:

```sql
CREATE TABLE IF NOT EXISTS evaluation_metrics (
    id              TEXT PRIMARY KEY,          -- UUID, one row per /evaluate call
    source_type     TEXT NOT NULL,             -- 'conversation' | 'discussion'
    ref_user_id     INTEGER NOT NULL,
    evaluated_at    TEXT NOT NULL,             -- ISO 8601 UTC

    -- Operational
    total_latency_ms    INTEGER,
    preprocess_ms       INTEGER,
    extract_ms          INTEGER,
    verify_ms           INTEGER,
    aggregate_ms        INTEGER,
    persist_ms          INTEGER,
    llm_tokens_in       INTEGER,
    llm_tokens_out      INTEGER,
    llm_call_count      INTEGER,
    llm_retry_count     INTEGER,

    -- Extraction funnel
    turn_count              INTEGER,
    chunk_count             INTEGER,
    viable                  INTEGER,           -- 0 | 1
    beliefs_extracted       INTEGER,
    beliefs_verified        INTEGER,
    beliefs_deduplicated    INTEGER,
    beliefs_final           INTEGER,
    nli_rejection_rate      REAL,
    richness_score          REAL,

    -- Quality distributions (JSON blobs)
    nli_confidence_stats    TEXT,              -- {avg, p50, p90}
    commitment_stats        TEXT,              -- {avg, p50, p90}
    crystallization_stats   TEXT,              -- {avg, p50, p90}
    beliefs_by_domain       TEXT,
    beliefs_by_polarity     TEXT,
    beliefs_by_affective_charge TEXT,
    beliefs_by_delta        TEXT,
    beliefs_by_state        TEXT,
    explicit_belief_count   INTEGER,
    implicit_belief_count   INTEGER
);
```

---

## Implementation Plan

### 1. Instrumentation context object (`app/pipeline/context.py`)

A `MetricsContext` dataclass is built at the start of each `/evaluate` request and passed through the pipeline. Each stage populates its own timer and counters. The context is finalized and written to `evaluation_metrics` after `build_response` returns, before `persist_beliefs` runs (so a persist failure does not lose the metrics row).

```python
@dataclass
class MetricsContext:
    evaluation_id: str
    source_type: str
    ref_user_id: int
    evaluated_at: str
    # timers populated by each stage
    preprocess_ms: int | None = None
    extract_ms: int | None = None
    # ... etc
    # funnel counters
    beliefs_extracted: int = 0
    beliefs_verified: int = 0
    # ...
```

### 2. Stage wrappers

Each pipeline function gains an optional `ctx: MetricsContext | None = None` parameter. The call site in `main.py` passes the context through:

```python
ctx = MetricsContext(...)
t0 = time.monotonic_ns()
turns = build_turn_pairs(body)
chunks = chunk_turns(turns)
ctx.preprocess_ms = _ms(t0)
ctx.turn_count = len(turns)
ctx.chunk_count = len(chunks)
# etc.
```

This keeps instrumentation in the call site rather than polluting the pipeline functions themselves.

### 3. BAML token and retry capture

Both token counts and retry counts are available natively through the `Collector` mechanism — no async client, no wrappers needed. The extractor passes a `Collector` instance to each BAML call via `baml_options`:

```python
collector = baml_py.baml_py.Collector("metrics")
result = b.ExtractBeliefs(turns=turns, source_type=source_type, baml_options={"collector": collector})

log = collector.last
tokens_in  = log.usage.input_tokens   # prompt tokens sent to the model
tokens_out = log.usage.output_tokens  # completion tokens returned
retries    = len(log.calls) - 1       # calls list has one entry per attempt; 0 on success with no retry
latency_ms = log.timing.duration_ms   # wall time for this LLM call
```

`log.calls` is a list of `LLMCall` objects — one per attempt made by BAML's `Resilient` retry policy. On a clean success it has length 1 (retry count = 0); each retry adds another entry. Token counts are per-call and available on `log.usage` (aggregated) or per `LLMCall` object.

`extract_beliefs` accumulates totals across chunks and writes them into `MetricsContext`:

```python
ctx.llm_tokens_in  += log.usage.input_tokens
ctx.llm_tokens_out += log.usage.output_tokens
ctx.llm_retry_count += len(log.calls) - 1
ctx.llm_call_count += 1
```

### 4. New API endpoints

```
GET /metrics/summary
```

Returns fleet-wide aggregates computed from all rows in `evaluation_metrics`:

```json
{
  "total_evaluations": 142,
  "avg_latency_ms": 3240,
  "p90_latency_ms": 7100,
  "avg_tokens_in": 4200,
  "avg_tokens_out": 890,
  "total_tokens_in": 596400,
  "total_tokens_out": 126380,
  "avg_llm_retries": 0.12,
  "avg_richness_score": 0.41,
  "avg_nli_rejection_rate": 0.28,
  "viable_rate": 0.83,
  "beliefs_by_domain": { "identity": 312, "capability": 198, ... },
  "beliefs_by_delta": { "new": 480, "reinforced": 102, ... },
  "beliefs_by_state": { "crystallized": 394, "transitioning": 188 },
  "beliefs_by_polarity": { ... },
  "avg_claim_commitment": 0.61,
  "avg_crystallization": 0.57
}
```

```
GET /metrics/history?limit=50
```

Returns one row per evaluation in reverse-chronological order (for sparklines / time series charts):

```json
[
  {
    "evaluated_at": "2026-05-26T01:22:00Z",
    "total_latency_ms": 2910,
    "richness_score": 0.38,
    "beliefs_final": 4,
    "nli_rejection_rate": 0.25,
    "llm_tokens_in": 3800,
    "llm_tokens_out": 720,
    "viable": true
  },
  ...
]
```

Both endpoints are read-only and require no auth (same policy as existing endpoints).

### 5. Dashboard page (`lore-tool/app/metrics/page.tsx`)

A new top-level nav item alongside the existing user/conversation browser. Data is fetched from `GET /metrics/summary` and `GET /metrics/history`.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Pipeline Metrics                                              [refresh]     │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│  Avg Latency │  Avg Tokens  │  Avg Retries │  Coverage    │  NLI Rejection  │
│  3,240 ms    │  4.2k / 890  │  0.12        │  41%         │  28%            │
│              │  in   / out  │              │  beliefs/turn│  of extracted   │
├──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┤
│  Latency over time (line chart, last 50 evals)                               │
│  Token usage over time (stacked: in / out)                                   │
├─────────────────────────────┬───────────────────────────────────────────────┤
│  Beliefs by Domain (bar)    │  Beliefs by Delta (bar: new/reinforced/...)    │
├─────────────────────────────┼───────────────────────────────────────────────┤
│  Belief State (pie)         │  Polarity (pie)   │  Affective Charge (bar)   │
├─────────────────────────────┴───────────────────────────────────────────────┤
│  Extraction Funnel  extracted → verified → deduplicated → final             │
│  [============================] 148  →  107  →  98  →  96                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

No new charting library is required if the existing lore-tool already has one; otherwise, `recharts` (already widely used with Next.js) is the default choice.

---

## Resolved Pre-Implementation Questions

1. **BAML token metadata** ✓ — `collector.last.usage.input_tokens` / `.output_tokens` are available on the sync client via the `Collector` mechanism. No async client required.

2. **Retry count** ✓ — `len(collector.last.calls) - 1`. BAML exposes one `LLMCall` entry per attempt; no external retry library or wrapper needed.

3. **Dashboard placement** ✓ — Top-level nav item.

---

## Affected Files

| File | Change |
|------|--------|
| `app/db/schema.py` | Add `evaluation_metrics` table to `init_db()` |
| `app/pipeline/context.py` | New — `MetricsContext` dataclass and `write_metrics()` helper |
| `app/pipeline/extract.py` | Capture token counts and retry counts; pass ctx |
| `app/pipeline/verify.py` | Pass ctx; record `beliefs_verified` |
| `app/pipeline/aggregate.py` | Pass ctx; record dedup count, quality distributions |
| `app/main.py` | Create MetricsContext per request; wire timers; call write_metrics |
| `lore-tool/app/metrics/page.tsx` | New — dashboard page |
| `lore-tool/app/metrics/route handlers` | Proxy to `/metrics/summary` and `/metrics/history` |
