# consolidate-categories

Propose a consolidated, cross-user taxonomy for all belief categories in the system.

## Usage

```
/consolidate-categories
```

No arguments needed — this operates on all users at once.

## Steps

1. **Fetch the export** by calling:
   ```
   GET http://localhost:8000/beliefs/categories/export
   ```
   If the API returns an error or `category_count` is 0, tell the user there are no categories to consolidate and stop.

2. **Format the categories** for the LLM prompt. For each category, produce one line:
   ```
   [user_id] category_id | label | N beliefs | "sample 1" / "sample 2" / "sample 3"
   ```

3. **Call the LLM** with this prompt (substitute `{formatted_categories}` with the formatted list):

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
      "subgroups": [
        {
          "label": "string",
          "categories": [{ "category_id": "uuid", "proposed_label": "string" }]
        }
      ],
      "categories": [
        { "category_id": "uuid", "proposed_label": "string" }
      ]
    }
  ]
}

Note: use either "subgroups" or "categories" at each group level, not both.
If no sub-level is needed, use "categories" directly on the group.

Current categories (format: [user_id] category_id | label | N beliefs | samples):
{formatted_categories}
```

4. **Parse and validate** the LLM's JSON response:
   - Extract all `category_id` values from the response
   - Check that every `category_id` from the export appears exactly once
   - If any IDs are missing or fabricated, tell the user which ones and stop

5. **Build the proposal file** with this structure and write it to `proposals/categories-global.json` (create the `proposals/` directory if it does not exist):

```json
{
  "proposed_at": "<ISO 8601 timestamp>",
  "model": "claude-sonnet-4-6",
  "user_count": <N>,
  "current_category_count": <N>,
  "proposed_group_count": <number of top-level groups>,
  "groups": [
    {
      "label": "...",
      "subgroups": [
        {
          "label": "...",
          "categories": [
            {
              "category_id": "...",
              "user_id": "...",
              "current_label": "...",
              "proposed_label": "..."
            }
          ]
        }
      ]
    }
  ]
}
```

Populate `user_id` and `current_label` from the export data (look up each `category_id`).
If a group has no subgroups, use `"categories"` directly on the group object instead of `"subgroups"`.

6. **Report a summary** to the user:
   - How many total categories were consolidated
   - How many users are represented
   - How many top-level groups are proposed
   - Where the file was written
   - Remind them to open the lore-tool at `/proposals/categories` to review
