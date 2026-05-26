# RFC 0003 — Belief Graph: Longitudinal Matching, Storage, and Visualization

**Status:** Draft  
**Affects:** `app/pipeline/`, `app/models/`, `app/api/`, `lore-tool/`  
**Dialogue:** `.blue/dialogues/belief-graph/` (3 rounds, 8 experts, 8/8 tensions resolved)

---

## Problem

The current pipeline extracts beliefs per-session and stores them in isolation. There is no mechanism to:

1. Determine whether a newly extracted belief is related to a belief the user has expressed before
2. Track how a belief evolves across conversations (strengthened, weakened, revised, abandoned)
3. Show this longitudinal structure to the user in a meaningful way

Each session's beliefs are a snapshot. We need a graph.

---

## Goals

- Connect beliefs across sessions without an LLM call in the matching hot path
- Maintain a full, queryable audit trail of how each belief has changed over time
- Visualize the belief trajectory in a swimlane arc timeline
- Lay the foundation for a future cross-lineage graph view (v2), without breaking schema changes

---

## Non-Goals

- LLM-based matching (matching must be deterministic and fast enough to run inline on write)
- Force-directed graph visualization in v1
- Belief merging or user-editable belief content (correction UX writes provenance events, it does not mutate history)

---

## Storage

Two storage layers, each doing what it is good at:

- **SQLite** — the relational event ledger. Full history, constraints, audit trail, API queries. Source of truth.
- **ChromaDB** (embedded) — one vector per current belief per user. Used only during matching to answer "what existing beliefs are semantically close to this new one?" Not a source of truth.

ChromaDB runs in embedded mode (local file, no server process), matching SQLite's operational simplicity.

---

## Design

### 1. SQLite Schema

SQLite does not support `UUID`, `TIMESTAMPTZ`, `JSONB`, or array types natively. These are stored as `TEXT`. SQLite does not enforce numeric precision, so `NUMERIC(4,3)` becomes `REAL` with CHECK constraints for range bounding. Foreign keys are disabled by default and must be enabled per-connection with `PRAGMA foreign_keys = ON`.

#### `belief_identities` — one row per canonical belief lineage

```sql
CREATE TABLE belief_identities (
  id         TEXT PRIMARY KEY,       -- UUID generated in Python (uuid.uuid4())
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL           -- ISO 8601 UTC timestamp
);
```

Insert-only. Every distinct belief lineage gets a stable `id` here the first time it is captured. The row is never updated.

#### `belief_events` — append-only event ledger

```sql
CREATE TABLE belief_events (
  id                        TEXT  PRIMARY KEY,       -- UUID, Python-generated
  canonical_id              TEXT  NOT NULL REFERENCES belief_identities(id),
  belief_text               TEXT  NOT NULL,
  self_domain               TEXT  NOT NULL,
  polarity                  TEXT  NOT NULL,
  claim_commitment          REAL  NOT NULL,
  crystallization           REAL  NOT NULL,
  affective_charge          TEXT,
  belief_state              TEXT  NOT NULL,
  depth_markers             TEXT  NOT NULL DEFAULT '[]',  -- JSON array
  source_turns              TEXT  NOT NULL,               -- JSON object

  -- Lineage and matching
  relation_to_prior         TEXT,                         -- enum or NULL (founding event)
  related_to_canonical_id   TEXT  REFERENCES belief_identities(id),
  match_confidence          REAL,
  relation_confidence       REAL,
  relation_classifier_flags TEXT,                         -- JSON object (sidecar)

  -- Bitemporal envelope
  valid_from                TEXT  NOT NULL,               -- ISO 8601, first turn timestamp
  valid_until               TEXT,
  recorded_at               TEXT  NOT NULL,               -- ISO 8601, now() at insert time

  -- Constraints
  CONSTRAINT match_confidence_range
    CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  CONSTRAINT relation_confidence_range
    CHECK (relation_confidence IS NULL OR (relation_confidence >= 0 AND relation_confidence <= 1)),
  CONSTRAINT relation_requires_match_confidence
    CHECK (relation_to_prior IS NULL OR match_confidence IS NOT NULL),
  CONSTRAINT relation_confidence_requires_relation
    CHECK (relation_confidence IS NULL OR relation_to_prior IS NOT NULL),
  CONSTRAINT related_canonical_requires_relation
    CHECK (related_to_canonical_id IS NULL OR relation_to_prior IS NOT NULL)
);

CREATE INDEX idx_belief_events_low_match_confidence
  ON belief_events (canonical_id, valid_from)
  WHERE match_confidence < 0.80;

CREATE INDEX idx_belief_events_low_relation_confidence
  ON belief_events (canonical_id, valid_from)
  WHERE relation_confidence < 0.80;

CREATE INDEX idx_belief_events_related_canonical
  ON belief_events (related_to_canonical_id, valid_from)
  WHERE related_to_canonical_id IS NOT NULL;
```

**`relation_to_prior`** enum values stored as TEXT:

| Value | Meaning |
|---|---|
| `IDENTITY` | Restatement — same belief, same lineage |
| `SUBSUMPTION` | Belief absorbed into a broader one |
| `CONTRACTION` | Scope or commitment narrowed |
| `REVISION` | Core content changed |
| `CONTRACTION_OR_REVISION` | Ambiguous — classifier uncertain between the two |
| `EXPANSION` | Spawned a new lineage (semantically related but distinct) |
| `NULL` | Founding event — no prior exists |

**`related_to_canonical_id`** null semantics:
- NULL: founding event, IDENTITY continuations (same lineage), EXPANSION spawns (spawn is its own root)
- Populated: any cross-lineage REVISION, CONTRACTION, CONTRACTION_OR_REVISION, or SUBSUMPTION

**Two confidence scalars** serve distinct UI purposes:
- `match_confidence` — retrieval score from vector search + metadata delta; drives solid/dashed arc threshold (< 0.80 = dashed)
- `relation_confidence` — classifier confidence in the relation type; drives ambiguous-transition-type indicator independently (< 0.80 = dashed, separate from match_confidence)
- `relation_classifier_flags` — JSON sidecar with `cosine_similarity`, `metadata_delta_penalty`, `candidate_types`; not a query column

#### `current_beliefs` — read model (shadow table)

SQLite has no native materialized views. `current_beliefs` is a real table maintained by the application write path — a derived projection, not a source of truth.

```sql
CREATE TABLE current_beliefs (
  canonical_id  TEXT PRIMARY KEY REFERENCES belief_identities(id),
  -- mirrors all columns of belief_events for the latest event per canonical_id
  belief_text               TEXT  NOT NULL,
  self_domain               TEXT  NOT NULL,
  polarity                  TEXT  NOT NULL,
  claim_commitment          REAL  NOT NULL,
  crystallization           REAL  NOT NULL,
  affective_charge          TEXT,
  belief_state              TEXT  NOT NULL,
  depth_markers             TEXT  NOT NULL DEFAULT '[]',
  source_turns              TEXT  NOT NULL,
  relation_to_prior         TEXT,
  related_to_canonical_id   TEXT,
  match_confidence          REAL,
  relation_confidence       REAL,
  relation_classifier_flags TEXT,
  valid_from                TEXT  NOT NULL,
  valid_until               TEXT,
  recorded_at               TEXT  NOT NULL
);
```

Updated via `INSERT OR REPLACE` after every `belief_events` insert. Because beliefs are low-frequency writes, this is cheap.

---

### 2. ChromaDB Collection

One ChromaDB collection per deployment: `belief_vectors`.

Each document in the collection represents the **current state** of a belief lineage:

- **id**: `canonical_id` (UUID string)
- **embedding**: `all-MiniLM-L6-v2` encoding of `belief_text`
- **metadata**: `{ user_id, self_domain, polarity, claim_commitment, crystallization }`
- **document**: `belief_text` (stored for inspection; not used in queries)

When a belief is revised/updated, its vector entry is upserted — the embedding and metadata reflect the latest event. The full history remains in SQLite; ChromaDB holds only the current snapshot for matching purposes.

---

### 3. Matching Pipeline

Runs after extraction, before writing to SQLite. All stages are deterministic; no LLM calls.

```
Input: NewBelief { belief_text, self_domain, polarity, claim_commitment, crystallization }

Stage 1 — Vector search with domain filter
  Query ChromaDB collection:
    embedding = encode(new_belief.belief_text)  [all-MiniLM-L6-v2]
    where: { user_id == current_user_id, self_domain == new_belief.self_domain }
    n_results = 5
  If no results returned: → EXPANSION (new lineage, founding event)

Stage 2 — Cosine threshold gate
  ChromaDB returns (canonical_id, distance) pairs; distance = 1 - cosine_similarity
  cosine_similarity = 1 - distance
  Drop candidates with cosine_similarity < 0.50
  If no candidates remain: → EXPANSION

Stage 3 — Composite score
  For each surviving candidate, fetch metadata from ChromaDB result:
    metadata_delta_penalty = |commit_delta| * 0.5 + |crystal_delta| * 0.5
      where commit_delta  = new_belief.claim_commitment - candidate.claim_commitment
            crystal_delta = new_belief.crystallization  - candidate.crystallization
    composite = 0.65 × cosine_similarity
              + 0.35 × (1 - metadata_delta_penalty)
  Select top candidate. If composite < 0.50: → EXPANSION
  Else: → Stage 4 with top candidate as matched_prior

Stage 4 — Relation classifier
  Look up matched_prior's latest event from current_beliefs (SQLite)
  Inputs: new_belief, matched_prior
    commitment_delta = new_belief.claim_commitment - matched_prior.claim_commitment
    crystal_delta    = new_belief.crystallization  - matched_prior.crystallization
    polarity_flip    = new_belief.polarity != matched_prior.polarity
  Classification:
    If commitment_delta < -0.3 AND crystal_delta < 0:  → CONTRACTION (high confidence)
    If commitment_delta > +0.3 AND crystal_delta > 0:  → REVISION   (high confidence)
    If polarity_flip:                                  → Stage 4a
    Else:                                              → CONTRACTION_OR_REVISION (middle band)
  relation_confidence reflects distance from nearest threshold boundary

Stage 4a — Temporal negation regex (polarity flip / middle band only)
  Patterns (15): "I used to", "I no longer", "I don't anymore", "not like I used to",
    "I've changed my mind", "I used to think", "I no longer believe", "I've stopped",
    "used to feel", "not anymore", "I've realized", "I was wrong", "I previously",
    "I once thought", "I've come to"
  Match → additive signal toward CONTRACTION or REVISION
  No match → CONTRACTION_OR_REVISION retained

Output:
  matched_prior_canonical_id  (None → EXPANSION)
  relation_to_prior
  match_confidence            (composite score; None for EXPANSION)
  relation_confidence         (None for EXPANSION)
  relation_classifier_flags   { cosine_similarity, metadata_delta_penalty, candidate_types }
```

Note on weights: BM25 is dropped entirely. It was included in the original design as a pre-filter to reduce the candidate pool before computing embeddings. ChromaDB's ANN search makes this unnecessary — the vector query with metadata filters already returns a small, relevant candidate set efficiently.

---

### 4. Write Path

```
for belief in extracted_beliefs:

    # 1. Run matching
    result = run_matching_pipeline(belief, user_id)

    # 2. Resolve canonical_id
    if result is EXPANSION:
        canonical_id = uuid4()
        INSERT INTO belief_identities (id, user_id, created_at)
    else:
        canonical_id = result.matched_prior_canonical_id

    # 3. Write event (single transaction)
    event_id = uuid4()
    INSERT INTO belief_events (id, canonical_id, ..., valid_from=session_first_turn_timestamp)

    # 4. Update read model
    INSERT OR REPLACE INTO current_beliefs (canonical_id, ...)

    # 5. Upsert vector (outside transaction — eventual consistency acceptable here)
    chroma.upsert(
        ids=[canonical_id],
        embeddings=[encode(belief.belief_text)],
        metadatas=[{ user_id, self_domain, polarity, claim_commitment, crystallization }],
        documents=[belief.belief_text],
    )
```

Steps 3 and 4 happen inside a single SQLite transaction. Step 5 (ChromaDB upsert) happens after commit. If the ChromaDB upsert fails, the SQLite record still exists; the vector can be re-synced from SQLite on next startup if needed.

`valid_from` is set to the timestamp of the first turn in the source session — the time the belief was expressed, not when the pipeline ran.

---

### 5. API Endpoint

`GET /users/{user_id}/beliefs`

Returns all belief lineages for a user with their full event history, suitable for driving the swimlane timeline.

```json
{
  "user_id": "...",
  "lineages": [
    {
      "canonical_id": "uuid",
      "current": { "belief_text": "...", "self_domain": "...", "claim_commitment": 0.8, "..." : "..." },
      "events": [
        {
          "id": "uuid",
          "belief_text": "...",
          "relation_to_prior": "REVISION",
          "match_confidence": 0.87,
          "relation_confidence": 0.74,
          "valid_from": "2025-11-03T14:22:00Z",
          "recorded_at": "2025-11-03T15:01:00Z"
        }
      ]
    }
  ]
}
```

---

### 6. Visualization

**Primary view: swimlane arc timeline**

- X-axis: sessions (chronological left → right)
- Y-axis: belief lanes (one horizontal lane per `canonical_id`)
- Each event is a dot/marker on its lane at the session column
- Arcs connect markers within a lane; cross-lineage arcs connect across lanes
- Background fill per lane encodes crystallization and claim_commitment level over time

**Arc styling:**

| Condition | Style |
|---|---|
| `match_confidence >= 0.80` AND `relation_confidence >= 0.80` | Solid arc |
| `match_confidence < 0.80` OR `relation_confidence < 0.80` | Dashed arc |

**Relation-type markers:**

| Relation | Visual Encoding |
|---|---|
| IDENTITY | Small dot |
| SUBSUMPTION | Chevron + widening lane |
| CONTRACTION | Downward wedge + fade |
| REVISION | Hue-inversion + chevron |
| EXPANSION | New lane origin + diamond |
| CONTRACTION_OR_REVISION | Diagonal split + two-tone lane |

**Interaction:**

- Click a belief marker → detail panel shows belief_text, all field values, source turn(s)
- Hover arc → tooltip with match_confidence, relation_confidence, classifier flags
- Hover belief marker → ghost "Split" and "Merge" buttons for manual correction

**Manual correction UX:**

- "Split" — user indicates the pipeline mis-matched; this event starts a new lineage
- "Merge" — user indicates the pipeline missed a match; two lineages are the same belief
- Both write a `MANUAL_CORRECTION` provenance event to `belief_events`; no history is mutated

**v2 (not v1):** hierarchical DAG snapshot — topological graph of `canonical_id` nodes connected by cross-lineage edges at a selected session, derived from `(canonical_id, related_to_canonical_id, relation_to_prior, valid_from)`. No additional schema changes required.

---

## Implementation Order

1. **Schema** — `app/db/`: SQLite init, `belief_identities`, `belief_events`, `current_beliefs`
2. **Vector store** — `app/db/vectors.py`: ChromaDB embedded client, collection setup, upsert/query helpers
3. **Matching pipeline** — `app/pipeline/match.py`: 4-stage cascade, `all-MiniLM-L6-v2` via sentence-transformers
4. **Write path integration** — extend `app/pipeline/` to persist beliefs after extraction
5. **API endpoint** — `GET /users/{user_id}/beliefs`
6. **Swimlane visualization** — new view in `lore-tool`

---

## Decisions

- **Database**: SQLite. No server to run; file-based; sufficient for this scale. UUID values generated in Python (`uuid.uuid4()`), stored as TEXT. Timestamps stored as ISO 8601 TEXT. Foreign keys enabled per-connection via `PRAGMA foreign_keys = ON`.
- **Vector store**: ChromaDB in embedded mode. Local file, no server, Python-native. Holds one vector per current belief (current state only); SQLite holds the full event history.
- **Embedding model**: `all-MiniLM-L6-v2` via `sentence-transformers`, running locally (~80MB). No hosted API dependency on the write path.
- **BM25 dropped**: Was a pre-filter to reduce candidates before embedding computation. ChromaDB's ANN search with metadata filtering makes it redundant.
- **Composite score weights**: 0.65 × cosine + 0.35 × (1 − metadata_delta_penalty). BM25's 0.20 weight redistributed to the semantic signal.
- **`current_beliefs` as shadow table**: SQLite has no native materialized views. `current_beliefs` is a real table kept in sync by the write path via `INSERT OR REPLACE`. It is a derived projection; `belief_events` is the source of truth.
- **`valid_from` semantics**: timestamp of the first turn in the source session — when the belief was expressed, not when the pipeline ran.

---

## Alternatives Considered

**LLM-based matching** — rejected. Too slow for inline use on the write path, cost compounds with user history size, and outputs are non-deterministic. The cascade produces a stable, auditable trace via `relation_classifier_flags`.

**Mutable concept node (CQRS anti-pattern)** — rejected. Treating a mutable "current belief" row as authoritative inverts the dependency: the event ledger becomes secondary. The aggregate root must be `belief_events`; `current_beliefs` is a derived projection.

**Single compound confidence scalar + JSONB** — rejected. Storing `relation_type_confidence` only in JSON makes it inaccessible to partial indexes. Two first-class scalars + JSON sidecar gives independent thresholds with clean column semantics.

**Force-directed graph in v1** — rejected. Positional instability makes it poor for comparison across time. A hierarchical DAG snapshot is more useful and requires no new schema primitives.

**Postgres** — rejected for this project's scale. Adds operational complexity (server process, connection pooling) with no benefit over SQLite at current write volumes.

**sqlite-vec / sqlite-vss** — considered as an alternative to ChromaDB. Would keep everything in one file. Rejected because it requires a compiled C extension, complicates deployment, and ChromaDB's embedded mode provides the same operational simplicity with a better Python API and metadata filtering built in.
