# RFC 0005 — Belief Category Groups: Thematic Grouping Without Relationship Inference

**Status:** Draft  
**Affects:** `app/db/schema.py`, `app/pipeline/persist.py`, `app/main.py`, `lore-tool/`  

---

## Problem

The current system tracks belief evolution along lineage chains: each belief event is connected to its prior via a typed relation (REVISION, CONTRACTION, EXPANSION, etc.). This models *how a belief changes over time* well, but provides no way to browse beliefs *thematically*.

A person may hold five distinct, independently-evolving beliefs that all concern the same area of their life — their health, their career, their relationships — without any one belief revising another. There is no way to surface these as a coherent group today.

`self_domain` (5-value fixed enum) is too coarse to serve as a meaningful grouping key. `subject_tag` (free-text noun phrase, LLM-generated per belief) is too fine-grained and noisy: "physical fitness", "fitness level", "physical capacity", and "strength and endurance" refer to the same thematic area but appear as four different strings.

---

## Goals

- Group beliefs into dynamic, normalized categories that emerge from the data rather than from a fixed taxonomy
- Display all of a person's beliefs about a category over time (chronological, no relationship inference within the category)
- Surface related categories alongside each other via a lightweight category adjacency layer
- No additional LLM calls on the write path

---

## Non-Goals

- Inferring relationships between individual beliefs within a category
- Replacing the belief lineage system — lineage tracks evolution; categories track theme
- User-editable category labels or manual curation in v1
- Cross-user category analysis

---

## Design

### 1. How Categories Are Assigned

At belief write time, the `subject_tag` extracted by the BAML pipeline is already available. Category assignment runs immediately after the matching pipeline, before the SQLite write:

```
Input: subject_tag (e.g., "physical fitness")

Step 1 — Encode
  embedding = encode(subject_tag)  [all-MiniLM-L6-v2, already loaded]

Step 2 — Query existing user categories
  Query: SELECT id, label, embedding FROM belief_categories WHERE user_id = ?
  For each existing category:
    cosine_similarity = dot(embedding, category.embedding)
  Select category with highest cosine_similarity

Step 3 — Threshold gate
  If max_similarity >= 0.72: assign to that category
  Else: create new category
    label = subject_tag (raw, lowercased and stripped)
    INSERT INTO belief_categories (id, user_id, label, embedding, created_at)

Step 4 — Write membership
  INSERT OR IGNORE INTO belief_category_memberships (canonical_id, category_id)
```

The 0.72 threshold clusters near-synonyms ("physical fitness" / "fitness level") without merging distinct topics ("fitness" / "emotional resilience"). Category labels are set to the first `subject_tag` that creates a given category; subsequent assignments adopt the existing label unchanged.

Category embeddings are stored as JSON arrays in SQLite (same pattern as other vector data in this project). They are not indexed in ChromaDB — the number of categories per user stays small enough that an in-memory linear scan is fast.

### 2. Category Adjacency

Two categories are adjacent if their label embeddings have cosine similarity ≥ 0.60. Adjacency is computed when a new category is created:

```
on new category created (new_category_id, new_embedding):
  for each existing category (other_id, other_embedding) for this user:
    similarity = cosine(new_embedding, other_embedding)
    if similarity >= 0.60:
      INSERT OR IGNORE INTO category_adjacencies
        (category_id_a, category_id_b, similarity)
      using canonical ordering: category_id_a < category_id_b (lexicographic)
```

Adjacency is undirected and stores no relationship type — it carries only a similarity scalar. The frontend uses it to show "related categories" chips alongside each category view.

### 3. SQLite Schema

#### `belief_categories` — one row per normalized category label per user

```sql
CREATE TABLE IF NOT EXISTS belief_categories (
  id         TEXT PRIMARY KEY,  -- UUID, Python-generated
  user_id    TEXT NOT NULL,
  label      TEXT NOT NULL,     -- normalized subject_tag (lowercased, stripped)
  embedding  TEXT NOT NULL,     -- JSON array of floats (all-MiniLM-L6-v2)
  created_at TEXT NOT NULL      -- ISO 8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_belief_categories_user
  ON belief_categories (user_id);
```

#### `belief_category_memberships` — many-to-many: canonical_id → category

```sql
CREATE TABLE IF NOT EXISTS belief_category_memberships (
  canonical_id TEXT NOT NULL REFERENCES belief_identities(id),
  category_id  TEXT NOT NULL REFERENCES belief_categories(id),
  PRIMARY KEY (canonical_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_category
  ON belief_category_memberships (category_id);
```

A belief may belong to more than one category — a belief about "managing stress at work" legitimately falls under both "emotional regulation" and "professional identity".

#### `category_adjacencies` — undirected edges between categories

```sql
CREATE TABLE IF NOT EXISTS category_adjacencies (
  category_id_a TEXT NOT NULL REFERENCES belief_categories(id),
  category_id_b TEXT NOT NULL REFERENCES belief_categories(id),
  similarity    REAL NOT NULL,
  PRIMARY KEY (category_id_a, category_id_b),
  CHECK (category_id_a < category_id_b)  -- canonical ordering, no duplicate pairs
);
```

### 4. Write Path Integration

Category assignment runs in `app/pipeline/persist.py`, after the existing matching pipeline and before the SQLite transaction:

```
for belief in extracted_beliefs:

    # existing: run matching pipeline
    result = run_matching_pipeline(belief, user_id)

    # existing: resolve canonical_id, write belief_identities, belief_events, current_beliefs
    # ...

    # new: assign category
    category_id = assign_category(
        subject_tag=belief.subject_tag,
        user_id=user_id,
        conn=conn,
    )
    conn.execute(
        "INSERT OR IGNORE INTO belief_category_memberships VALUES (?, ?)",
        (canonical_id, category_id),
    )
```

`assign_category` is a pure function: loads existing categories, runs the in-memory linear scan, creates a new category row and computes adjacencies if needed. It participates in the same SQLite transaction as the belief write.

### 5. API Endpoint

`GET /users/{user_id}/beliefs/categories`

Returns all categories for a user with their adjacent categories and the beliefs belonging to each, ordered chronologically.

```json
{
  "user_id": "...",
  "categories": [
    {
      "category_id": "uuid",
      "label": "physical fitness",
      "adjacent": [
        { "category_id": "uuid", "label": "injury recovery", "similarity": 0.74 }
      ],
      "beliefs": [
        {
          "canonical_id": "uuid",
          "belief_text": "I'm not as strong as I used to be",
          "self_domain": "CAPABILITY",
          "polarity": "NEGATIVE",
          "claim_commitment": 0.75,
          "crystallization": 0.65,
          "valid_from": "2025-10-01T10:00:00Z"
        }
      ]
    }
  ]
}
```

`beliefs` within each category entry are drawn from `current_beliefs` (latest event per lineage), ordered by `valid_from` ascending. Full event history per belief is not included here — the existing `GET /users/{user_id}/beliefs` lineage endpoint handles that.

### 6. Visualization

**New view: category grid**

A grid of category cards, one card per category. Each card shows:
- Category label
- Belief count and date range (first `valid_from` → latest `valid_from`)
- Adjacent category chips (click to jump to that category)
- A compact list of belief texts, ordered chronologically

Clicking a category card expands it into a full-page category view showing all beliefs as a vertical timeline (date on left, belief card on right). Each belief card shows `belief_text`, `polarity`, `claim_commitment`, `crystallization`, and links to the belief's lineage in the swimlane view.

There is no arc or relationship visualization within the category view. Beliefs are displayed as an ordered list — the user is meant to read them as related statements about the same theme, not as a causal chain.

The category grid lives at `/beliefs/[user_id]/categories` alongside the existing swimlane view at `/beliefs/[user_id]`.

---

## Implementation Order

1. **Schema** — add `belief_categories`, `belief_category_memberships`, `category_adjacencies` to `app/db/schema.py`
2. **Category assignment** — `assign_category()` helper in `app/pipeline/categories.py`
3. **Write path** — call `assign_category` from `app/pipeline/persist.py` inside the existing transaction
4. **API endpoint** — `GET /users/{user_id}/beliefs/categories` in `app/main.py`
5. **Frontend** — category grid and expanded category view in `lore-tool`

---

## Decisions

- **Threshold 0.72 for assignment**: tighter than the 0.50 floor in the belief matching cascade because category merging is less recoverable than a missed belief match. Tunable.
- **Threshold 0.60 for adjacency**: loose enough to surface genuinely related themes; tight enough to avoid connecting distant topics. Tunable.
- **Embeddings stored in SQLite as JSON**: consistent with the project's single-file operational model. Linear scan over a small per-user category set (typically < 30) is negligible.
- **Category label set by first arrival**: the first `subject_tag` to create a category becomes its label. Later near-matches silently join without updating the label. This is stable and deterministic; a v2 could vote on the most representative label.
- **Many-to-many memberships**: a belief about "managing stress at work" belongs to both "emotional regulation" and "professional identity". Forcing a single category would misrepresent the belief.
- **No category merging in v1**: if the threshold is too low and two categories should be one, the fix is to wipe and recompute from `subject_tag` values — all source data is preserved in `belief_events`.

---

## Alternatives Considered

**Use `self_domain` as category** — rejected. Five fixed values are too coarse to be meaningful as thematic groups. "CAPABILITY" is not a category a person would recognize as describing their beliefs.

**Use `subject_tag` directly (no normalization)** — rejected. LLM-generated noun phrases vary per-extraction. "Physical fitness" and "fitness capacity" would appear as separate categories despite describing the same theme.

**Separate LLM call for category assignment** — rejected. Adds latency and cost to the write path. `all-MiniLM-L6-v2` is already loaded for belief matching; reusing it for category assignment is free.

**Co-occurrence-based adjacency** — rejected for v1. Requires enough session data to produce a meaningful signal. Embedding similarity between label strings is available immediately and requires no warm-up period.

**ChromaDB for category vectors** — rejected. Category sets per user are small (< 30 typically). A SQLite JSON column with in-memory linear scan is simpler and avoids a second collection.
