# RFC 0007 — Simulate Conversation Skill

## Status: Draft

## Motivation

The belief extraction pipeline builds a rich profile of each user's self-model over time. A natural use of that profile is generating synthetic follow-up conversations that continue where the user left off — for testing belief evolution, seeding new evaluation data, or exploring "what would this user say next?"

`conversations2.json` shows the target output: a realistic StoryBot conversation for user 66 (`EagerExplorer`) that references their established beliefs (foot injury, yoga, plant-based diet, meditation) while introducing natural drift and elaboration.

This RFC specifies:
1. Persisting raw conversation and discussion turns to SQLite so the DB is self-contained.
2. A seed script to populate the DB from existing JSON files.
3. A new `/users/{user_id}/simulation-context` API endpoint that assembles everything the generation prompt needs.
4. A Claude Code skill (`/simulate-conversation`) that calls the endpoint and generates a conversation, writing the result to `data/`.

---

## 1. Persist raw turns to SQLite

### New tables

```sql
CREATE TABLE IF NOT EXISTS conversation_turns (
  ref_conversation_id  INTEGER NOT NULL,
  ref_user_id          INTEGER NOT NULL,
  turn_index           INTEGER NOT NULL,
  screen_name          TEXT    NOT NULL,
  message              TEXT    NOT NULL,
  transaction_datetime_utc TEXT NOT NULL,
  PRIMARY KEY (ref_conversation_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_conv_turns_user
  ON conversation_turns (ref_user_id, ref_conversation_id);

CREATE TABLE IF NOT EXISTS discussion_turns (
  post_id              INTEGER NOT NULL,
  comment_id           INTEGER,               -- NULL = original post
  author_ref_user_id   INTEGER NOT NULL,
  body                 TEXT    NOT NULL,
  reported_or_removed  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, COALESCE(comment_id, -1))
);

CREATE INDEX IF NOT EXISTS idx_disc_turns_user
  ON discussion_turns (author_ref_user_id, post_id);
```

These tables hold the raw source material. The pipeline already reads from the JSON files through `DataIndex`; the tables are an additive mirror so the API can serve conversation context without file I/O.

### Seed script: `scripts/seed_db.py`

```
python scripts/seed_db.py [--data-dir data/] [--db lore.db]
```

- Reads `conversations.json`, `conversations2.json`, and `discussions.json`.
- Upserts all turns into `conversation_turns` and `discussion_turns` using `INSERT OR IGNORE`.
- Idempotent — safe to re-run after adding new simulated conversations.
- Prints a summary: N conversation turns inserted, M discussion turns inserted.

The seed script is also the answer to "ensure all data is in SQLite" — run it once on a fresh environment after cloning, and again whenever new JSON files are added to `data/`.

---

## 2. Simulation context endpoint

### `GET /users/{user_id}/simulation-context`

Returns everything needed to construct a generation prompt:

```json
{
  "user_id": "66",
  "screen_name": "EagerExplorer",
  "beliefs": [
    {
      "belief_text": "I am fundamentally an active person — movement is core to who I am.",
      "self_domain": "identity",
      "polarity": "positive",
      "claim_commitment": 0.92,
      "crystallization": 0.88,
      "affective_charge": "enthusiastic",
      "belief_state": "crystallized",
      "valid_from": "2023-10-01T08:00:00Z"
    },
    ...
  ],
  "categories": [
    { "label": "Physical identity and athleticism", "belief_count": 4 },
    { "label": "Injury and adaptation", "belief_count": 3 },
    ...
  ],
  "conversations": [
    {
      "ref_conversation_id": 42615,
      "date": "2023-10-01",
      "turn_count": 18,
      "turns": [
        { "role": "user", "message": "..." },
        { "role": "storybot", "message": "..." },
        ...
      ]
    }
  ]
}
```

**Fields:**
- `beliefs` — from `current_beliefs` joined to `belief_identities` for this user, ordered by `claim_commitment DESC`
- `categories` — from `belief_categories` for this user, with member count
- `conversations` — from `conversation_turns`, one entry per `ref_conversation_id`, turns ordered by `turn_index`. Only user 1 (StoryBot) and the target user are included; turns are labelled `role: "user" | "storybot"`.

If the user has no evaluated beliefs yet, the endpoint returns the raw conversations only (still useful for generation).

---

## 3. Claude Code skill: `/simulate-conversation`

### File: `.claude/commands/simulate-conversation.md`

```markdown
Simulate a new StoryBot conversation for a Lore user based on their belief profile.

Usage: /simulate-conversation <user_id>

Steps:
1. Call GET http://localhost:8000/users/$ARGUMENTS/simulation-context
2. Read the response. Note the user's screen_name, their current beliefs
   (especially crystallized ones and their dominant domain), belief categories,
   and what topics have already been covered in prior conversations.
3. Generate a realistic StoryBot conversation as a JSON array matching this structure:
   [
     {
       "ref_conversation_id": <new unique integer, e.g. 99001>,
       "ref_user_id": <user_id>,
       "messages_list": [
         {
           "ref_conversation_id": <same id>,
           "ref_user_id": 1,
           "transaction_datetime_utc": "<ISO datetime, ~6 weeks after last conversation>",
           "screen_name": "StoryBot",
           "message": "<StoryBot opening turn>"
         },
         {
           "ref_conversation_id": <same id>,
           "ref_user_id": <user_id>,
           "transaction_datetime_utc": "<5 minutes later>",
           "screen_name": "<screen_name>",
           "message": "<user response>"
         },
         ...
       ]
     }
   ]

Generation guidelines:
- The conversation should feel like a natural follow-up, set 4–8 weeks after
  the most recent prior conversation.
- Include 8–12 user turns. StoryBot asks open, reflective questions.
- Touch on at least 2 of the user's existing belief categories, but introduce
  at least one new development or shift (belief delta).
- For crystallized beliefs: the user reinforces or slightly elaborates them.
- For transitioning beliefs: allow some evolution — could resolve or drift further.
- The user's voice should match their screen_name and established tone.
- Do NOT invent facts that contradict the existing belief record.

4. Write the generated JSON to data/simulated_<user_id>_<timestamp>.json
5. Print the file path and a brief summary of what belief themes the
   conversation covers and what (if any) belief changes it introduces.
```

### Example invocation

```
/simulate-conversation 66
```

Output:
```
Generated conversation for EagerExplorer (user 66)
Written to: data/simulated_66_20231201_143022.json

Themes covered:
  • Physical identity and athleticism (crystallized reinforcement)
  • Injury and adaptation (elaboration — return to cycling)
  • Nutrition values (crystallized reinforcement)

New developments:
  • Introduces tentative aspiration: training for a low-impact triathlon
  • Belief transition: "I can push my limits safely" (aspirational, new)
```

---

## 3b. Webapp data source: JSON → SQLite

Currently `lore-tool/app/api/data/route.ts` reads `conversations.json` and `conversations2.json` directly from disk and assembles the `DataIndex` response in TypeScript. This means the webapp has no visibility into simulated conversations unless they happen to live in one of those files, and the data source diverges from everything else in the stack.

### New FastAPI endpoint: `GET /data`

Replaces the file-reading logic with a DB query:

```python
@app.get("/data")
def get_data() -> JSONResponse:
    conn = get_connection()
    rows = conn.execute(
        "SELECT ref_conversation_id, ref_user_id, screen_name, message, "
        "transaction_datetime_utc, turn_index "
        "FROM conversation_turns ORDER BY ref_conversation_id, turn_index"
    ).fetchall()
    # group by (ref_conversation_id, ref_user_id), build UserEntry list
    # same DataIndex shape as before
    ...
```

The response shape is identical to what the Next.js route currently returns — same `DataIndex`, `UserEntry`, `ConversationSummary`, `turns` array — so no frontend types or components change.

### Updated Next.js proxy: `lore-tool/app/api/data/route.ts`

Becomes a one-liner proxy to `${API_URL}/data`, the same pattern as every other route in the app. The file-reading logic and `loadJson` helper are removed entirely.

### Effect on simulated conversations

After `seed_db.py` runs (or is extended to include simulated files), those conversations appear automatically in the webapp without any code changes. The seed script becomes the single ingestion point for all raw turn data.

---

## 4. Data flow

```
/simulate-conversation 66
  → GET /users/66/simulation-context
      ← { screen_name, beliefs, categories, conversations }
  → Claude generates conversation JSON
  → Write to data/simulated_66_{ts}.json
  → (Optional manual step) Add file to data sources, run batch eval
      → beliefs extracted and persisted to DB
      → belief graph updated with deltas
```

The generated file has the same shape as `conversations.json` entries, so no changes are needed to the data index loader or the evaluation pipeline to process it.

---

## 5. Files changed

| File | Change |
|------|--------|
| `app/db/schema.py` | Add `conversation_turns`, `discussion_turns` tables |
| `scripts/seed_db.py` | New — seeds DB from JSON files |
| `app/main.py` | Add `GET /users/{user_id}/simulation-context` |
| `.claude/commands/simulate-conversation.md` | New skill |
| `lore-tool/app/api/data/route.ts` | Replace file-reading logic with proxy to `GET /data` |

---

## 6. Open questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Output format | JSON matching conversations.json structure; written to `data/simulated_{user_id}_{ts}.json` |
| 2 | Ingestion scope | Persist raw turns to SQLite + seed script; batch eval populates belief tables |
| 3 | Skill trigger | Claude Code `/simulate-conversation <user_id>` slash command |
| 4 | Auto-evaluate after generation? | No — manual; user adds file to data sources and uses batch UI |
