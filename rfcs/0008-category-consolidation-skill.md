# RFC 0008 — Category Consolidation Skill

**Status:** Draft  
**Affects:** `.claude/skills/`, `app/main.py`, `lore-tool/`

---

## Problem

The dynamic category assignment in RFC 0005 produces categories that are as granular as the `subject_tag` values they were created from. Over multiple sessions and users, the category set grows noisy: semantically overlapping labels that passed the 0.72 similarity threshold as distinct ("physical fitness", "fitness and activity"), vague labels ("self-awareness", "self-reflection"), or labels that would be more legible grouped under a shared theme.

Because categories are created independently per user, the same real-world theme ("career ambition", "professional identity") accumulates as separate, slightly-different labels across users. There is no mechanism to review, consolidate, or surface a shared taxonomy without manual DB surgery.

---

## Goals

- Provide a Claude Code skill that a developer can invoke to propose a consolidated, hierarchically structured taxonomy spanning **all users' categories**
- Let the LLM decide the appropriate number of levels (flat vs. two-level vs. deeper) based on the actual categories present
- Output a human-readable JSON proposal file that can be reviewed in the lore-tool before any changes are applied
- No DB mutations on skill run — the proposal is read-only until explicitly applied (v2)

---

## Non-Goals

- Automatically applying the proposal (that is v2, and requires its own RFC covering the migration path and orphan handling)
- Per-user consolidation (the cross-user view subsumes this — a user-scoped view is a filter on the global proposal)
- Backfill of historical belief texts to fit new category labels

---

## Design

### 1. Skill File

A project-level Claude Code skill at `.claude/skills/consolidate-categories.md`.

When invoked as `/consolidate-categories`, Claude:

1. Calls `GET http://localhost:8000/beliefs/categories/export` to fetch all categories across all users
2. Formats the data into a prompt (see §3) and asks the LLM to propose a consolidated cross-user hierarchy
3. Validates that the response references only existing `category_id` values — no hallucinated IDs
4. Writes the proposal to `proposals/categories-global.json`
5. Reports a summary: how many total categories consolidated, how many users represented, how many top-level groups proposed

The skill uses the already-running local API (`http://localhost:8000`) and writes to the `proposals/` directory in the project root (created if absent).

### 2. API Endpoint

`GET /beliefs/categories/export`

Returns **all categories across all users** in a format optimized for LLM input: category labels, IDs, user IDs, belief counts, and a sample of belief texts per category. Belief embeddings are excluded.

```json
{
  "exported_at": "ISO 8601",
  "user_count": 3,
  "category_count": 28,
  "categories": [
    {
      "category_id": "uuid",
      "user_id": "42",
      "label": "physical fitness",
      "belief_count": 3,
      "sample_beliefs": [
        "I am someone who tries to stay active.",
        "My fitness has genuinely slipped."
      ]
    }
  ]
}
```

`sample_beliefs` is capped at 3 per category to bound the prompt size. Including `user_id` in each category entry lets the LLM (and the UI) show which user each category belongs to.

A separate endpoint from `GET /users/{user_id}/beliefs/categories` — that one is shaped for the per-user frontend view; this one aggregates across users and is shaped for the LLM.

### 3. LLM Prompt Structure

The skill constructs a prompt from the export response:

```
You are organizing self-belief categories from multiple users into a shared,
coherent taxonomy. Your job is to propose a consolidation — grouping categories
from different users that represent the same real-world theme, and optionally
renaming them for consistency.

Rules:
- Every existing category_id must appear exactly once in your output.
- Do not invent new category_ids. Only use the IDs provided.
- Categories from different users that represent the same theme should land
  in the same group (or subgroup). This is the primary goal.
- Choose the hierarchy depth that fits the data: if there are ~10 categories
  and they naturally form 2-3 groups, one level of grouping is enough.
  If there are 30+ categories with clear sub-themes, use two levels.
- Proposed group labels should be plain English, 2-4 words, title-cased.
- Proposed category labels may rename the current label if the rename is
  clearly more legible or consistent with sibling categories; otherwise
  leave unchanged.
- Respond ONLY with valid JSON matching the schema below.

Schema:
{
  "groups": [
    {
      "label": "string",
      "subgroups": [            // optional — omit if no sub-level needed
        {
          "label": "string",
          "categories": [{ "category_id": "uuid", "proposed_label": "string" }]
        }
      ],
      "categories": [           // used if no subgroups
        { "category_id": "uuid", "proposed_label": "string" }
      ]
    }
  ]
}

Note: use either "subgroups" or "categories" at each group level, not both.
If no sub-level is needed, use "categories" directly on the group.

Current categories (format: [user_id] category_id | label | N beliefs | samples):
{formatted category list with belief samples}
```

### 4. Proposal File Schema

Written to `proposals/categories-global.json`:

```json
{
  "proposed_at": "ISO 8601",
  "model": "claude-sonnet-4-6",
  "user_count": 3,
  "current_category_count": 28,
  "proposed_group_count": 6,
  "groups": [
    {
      "label": "Health & Body",
      "subgroups": [
        {
          "label": "Physical Activity",
          "categories": [
            {
              "category_id": "uuid",
              "user_id": "42",
              "current_label": "physical fitness",
              "proposed_label": "Physical Fitness"
            },
            {
              "category_id": "uuid",
              "user_id": "99",
              "current_label": "fitness and activity",
              "proposed_label": "Physical Fitness"
            }
          ]
        }
      ]
    }
  ]
}
```

`user_id` and `current_label` are preserved alongside `proposed_label` so the UI can show both what changed and which user each category belongs to.

### 5. Proposal Serving Endpoint

`GET /proposals/categories`

Reads `proposals/categories-global.json` from disk and serves it. Returns 404 if no proposal exists. The frontend polls this endpoint on page load to check whether a proposal is available.

```python
PROPOSALS_DIR = os.environ.get("PROPOSALS_DIR", "proposals")
```

### 6. Webapp Proposal View

A new standalone page at `/proposals/categories` in the lore-tool.

The page fetches `GET /api/proposals/categories` on load and renders the proposed hierarchy as a tree:
- A header showing summary stats: total categories consolidated, users covered, groups proposed, proposal date
- Top-level group headers (e.g., "Health & Body")
- Optional subgroup rows (indented)
- Category chips within each group, showing `user_id`, and `current → proposed` label if they differ
- A count of categories and distinct users under each group

No apply button in v1 — the proposal is read-only. The page serves as a review surface.

A "Regenerate" note instructs the user to run `/consolidate-categories` again from Claude Code.

If no proposal exists (404 from the API), the page shows a prompt to run the skill.

A link to this page is added to the home page (`/`) alongside the existing navigation.

---

## Implementation Order

1. **API export endpoint** — `GET /beliefs/categories/export` in `app/main.py`
2. **Proposals directory + serving endpoint** — `GET /proposals/categories`, creates `proposals/` on first write
3. **Skill file** — `.claude/skills/consolidate-categories.md`
4. **Frontend proxy** — `lore-tool/app/api/proposals/categories/route.ts`
5. **Frontend types** — `CategoryProposal`, `ProposedGroup`, `ProposedSubgroup`, `ProposedCategory` in `lib/types.ts`
6. **Proposal page** — new page at `lore-tool/app/proposals/categories/page.tsx`
7. **Home page link** — add a link to `/proposals/categories` on the home page

---

## Decisions

- **Cross-user scope as primary goal**: per-user consolidation is a filter on the global proposal (show only groups/categories where `user_id` matches). The global view is more operationally useful — it surfaces redundancy that can't be seen looking at one user at a time.
- **Proposal is write-only by the skill, read-only by the webapp in v1**: applying a consolidation requires a migration path (re-assigning memberships, merging duplicate canonical categories). That complexity warrants its own RFC.
- **File-based proposal storage**: a `proposals/` directory is operationally simple and consistent with the project's single-file DB approach. A `proposals` SQLite table is the natural v2 upgrade path.
- **LLM decides depth**: constraining to a fixed number of levels would produce artificially shallow or over-deep hierarchies. Giving the model latitude with a schema that makes subgroups optional handles both cases.
- **Export endpoint separate from existing GET /categories endpoint**: the per-user frontend endpoint returns adjacencies and full belief content for rendering; the cross-user export endpoint returns belief samples capped at 3, includes `user_id`, and excludes adjacency data. Keeping them separate avoids bloating the frontend payload.
- **`sample_beliefs` cap at 3**: enough for the LLM to understand a category's semantic territory without making the prompt scale linearly with belief count.

---

## Alternatives Considered

**Run per-user and merge manually** — rejected. Separate per-user proposals don't show cross-user redundancy, which is the primary signal this feature is meant to surface.

**Apply the consolidation immediately in the skill** — rejected. Applying means rewriting `belief_category_memberships` (potentially merging multiple `category_id` rows into one) across users. That is a write-path migration, not a skill responsibility. The proposal pattern gives the operator a review step and makes rollback trivial (delete the file).

**Use embeddings to auto-cluster instead of LLM** — rejected. Clustering produces groups without labels, requires choosing k, and can't use belief text semantics to override label similarity. The LLM can read belief texts and reason about what grouping is humanly legible across users, which is the actual goal.

**Store proposals in SQLite** — fine for v2. In v1, a file is simpler and doesn't require schema changes or migrations. The serving endpoint already abstracts the storage.
