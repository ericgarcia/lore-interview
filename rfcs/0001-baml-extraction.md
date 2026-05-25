# RFC 0001 — BAML-based Belief Extraction

**Status:** Draft  
**Affects:** `app/pipeline/extract.py`, `baml_src/`

---

## Problem

The current extraction pipeline in `app/pipeline/extract.py` has three compounding issues:

**1. Silent failure is load-bearing.**  
`extract_from_chunk` wraps the entire LLM call + parse in `except Exception: return []`. A malformed response, a schema mismatch, a quota error, and a network timeout all look identical to the caller: zero beliefs. This is what caused the debugging session — the model was working, the code was failing, and nothing surfaced it.

**2. The output contract is implicit.**  
`RawBelief` is a Pydantic model defined in Python. The prompt is an f-string in the same file. There is no enforced relationship between what the prompt asks for and what `RawBelief` expects. When they drift — a field renamed, a new enum value added — the mismatch is only caught at runtime, inside the silenced exception.

**3. The model is a string constant.**  
`"gemini-2.5-flash"` appears directly in the `generate_content` call. Swapping providers means editing Python. A/B testing two models means branching logic. The plan says "provider swap is one config line" — that is not currently true.

---

## Proposal

Replace the f-string + manual parse approach with [BAML](https://docs.boundaryml.com) (Boundary ML).

BAML is a DSL that defines LLM functions as typed contracts:

- **Input and output types** are declared in `.baml` files
- **The prompt** is co-located with the type it must produce — drift is a build error, not a runtime surprise
- **The provider** is a config entry in `clients.baml` — swapping it requires no Python changes
- **The generated Python client** returns a validated, typed object; no `json.loads`, no `model_validate`, no silent fallback

The generated client replaces `extract_from_chunk` entirely. `extract_beliefs` becomes a thin orchestration wrapper.

---

## BAML Source Files

### `baml_src/clients.baml`

```baml
client<llm> GeminiFlash {
  provider google-ai
  options {
    model "gemini-2.5-flash"
    api_key env.GOOGLE_API_KEY
  }
}
```

Swapping to a different model or provider is a one-line change here — no Python touched.

---

### `baml_src/types.baml`

```baml
enum BeliefCategory { SELF TOPIC }
enum SelfDomain { IDENTITY CAPABILITY VALUE RELATIONAL ASPIRATIONAL }
enum TopicCategory { TECHNOLOGY WORK EDUCATION SOCIETY HEALTH RELATIONSHIPS POLITICS }
enum Polarity { POSITIVE NEGATIVE NEUTRAL }

class TurnPair {
  turn_index        int
  preceding_context string?
  user_message      string
  prompted          bool
}

class ExtractedBelief {
  belief_category      BeliefCategory
  belief_text          string
  belief_type          string           @description("explicit or implicit")
  self_domain          SelfDomain?
  topic_entity         string?
  topic_category       TopicCategory?
  polarity             Polarity
  temporal_scope       string?
  identity_anchoring   float?           @description("self-beliefs only, 0-1")
  conviction_strength  float?           @description("topic beliefs only, 0-1")
  crystallization      float            @description("0=open to revision, 1=fully fixed")
  source_turn_indices  int[]
  evidence_spans       string[]
  depth_markers        string[]
  linked_self_domain   SelfDomain?
}

class BeliefExtractionResult {
  beliefs ExtractedBelief[]
}
```

---

### `baml_src/extraction.baml`

```baml
function ExtractBeliefs(
  turns: TurnPair[],
  source_type: string
) -> BeliefExtractionResult {
  client GeminiFlash

  prompt #"
    Extract all beliefs expressed by the user across the following
    {{ source_type == "conversation" ? "StoryBot conversation" : "community discussion" }}.
    Only extract beliefs from user messages. Return an empty beliefs array if none are present.
    Turns marked (unprompted) were not elicited by a direct question — weight these slightly higher.

    {% for turn in turns %}
    [Turn {{ turn.turn_index }}{% if not turn.prompted %} · unprompted{% endif %}]
    {% if turn.preceding_context %}
    {{ source_type == "conversation" ? "StoryBot" : "Thread topic" }}: {{ turn.preceding_context }}
    {% endif %}
    User: {{ turn.user_message }}

    {% endfor %}

    For each belief, score:
    - identity_anchoring (self only, 0–1): copula frames ("I am X") → near 1.0; preference ("I like X") → near 0.2
    - conviction_strength (topic only, 0–1): absolute language ("fundamentally") → 1.0; hedged ("I wonder if") → 0.3
    - crystallization (all, 0–1): "this is just who I am" → 1.0; "I'm still figuring this out" → 0.0
    - depth_markers: exact words/phrases that drove your scores

    {{ ctx.output_format }}
  "#
}
```

`{{ ctx.output_format }}` is BAML's injection point — it renders the JSON schema for `BeliefExtractionResult` automatically, keeping the schema and the prompt in sync without manual maintenance.

---

## Replacement in `extract.py`

The current `extract_from_chunk`:

```python
# Before: f-string prompt, manual json.loads, silent except
def extract_from_chunk(turns, source_type) -> list[RawBelief]:
    prompt = PROMPT.format(...)
    try:
        response = _get_client().models.generate_content(...)
        data = json.loads(response.text)
        return RawExtractionResult.model_validate(data).beliefs
    except Exception:
        return []  # ← swallows everything
```

Becomes:

```python
# After: typed BAML call, exceptions propagate, no manual parsing
from baml_client import b
from baml_client.types import TurnPair as BAMLTurnPair

def extract_from_chunk(turns: list[TurnPair], source_type: str) -> list[ExtractedBelief]:
    baml_turns = [
        BAMLTurnPair(
            turn_index=t.turn_index,
            preceding_context=t.preceding_context,
            user_message=t.user_response,
            prompted=t.prompted,
        )
        for t in turns
    ]
    result = b.ExtractBeliefs(turns=baml_turns, source_type=source_type)
    return result.beliefs
```

No `json.loads`. No `model_validate`. No silent fallback. Exceptions propagate to the route handler, which returns a 500 with a real error message.

---

## Error Handling After Migration

With BAML, errors propagate cleanly. The route handler in `main.py` should catch them explicitly:

```python
from baml_py import BamlError

@app.post("/conversations/evaluate")
def evaluate(body: EvaluationInput, view: str = "full") -> JSONResponse:
    try:
        turns = build_turn_pairs(body)
        ...
    except BamlError as e:
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")
```

A 502 with a real message is debuggable. An empty beliefs array is not.

---

## Migration Steps

1. `pip install baml-py`
2. Write `baml_src/clients.baml`, `baml_src/types.baml`, `baml_src/extraction.baml`
3. Run `baml generate` → produces `baml_client/`
4. Add `baml_client/` to `.gitignore` (generated — not committed)
5. Add `baml generate` as a project setup step in README
6. Replace `extract_from_chunk` body with BAML call
7. Delete `RawBelief`, `RawExtractionResult`, `PROMPT`, `_format_turns` from `extract.py`
8. Map `baml_client.types.ExtractedBelief` → `app/pipeline/aggregate.py` (field names align already)

---

## Trade-offs

| | BAML | Current f-string |
|---|---|---|
| Schema drift | Build error | Silent runtime failure |
| Provider swap | `clients.baml` config | Edit Python |
| Debugging | Errors propagate | `return []` swallows everything |
| Setup | `baml generate` step | Zero setup |
| Dependency | `baml-py` + CLI | None beyond `google-genai` |

The setup cost is real but one-time. The debugging cost of the current approach is ongoing.

---

## Decisions

1. **`baml_client/` is generated, not committed.** Add to `.gitignore`. Add `baml generate` to README setup. Same pattern as gRPC stubs — the source of truth is `baml_src/`, not the generated artefact.
2. **Retry is configured in BAML via `retry_policy`.** Exponential backoff on the client, not in Python. This keeps retry behaviour co-located with the provider config and out of application code.
