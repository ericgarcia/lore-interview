# Belief Evolution Test — conv-92819 (user 66, EagerExplorer)

## Setup

**Session 1:** conv-92818 — 2023-10-01 to 2023-10-05  
**Session 2:** conv-92819 — 2023-11-15 (six weeks later)

---

## Beliefs actually extracted from conv-92818

From the UI screenshot — these are the real values in the DB.

| # | Belief text | Domain | Polarity | Affective charge | State | Commitment | Crystallization |
|---|-------------|--------|----------|-----------------|-------|------------|-----------------|
| B1 | "I love being active." | value | positive | distress | transitioning | ~0.90 | ~0.50 |
| B2 | "I am trying to stay active." | aspirational | positive | — | transitioning | ~0.70 | ~0.50 |
| B3 | "I am trying to eat healthier!" | aspirational | positive | — | transitioning | ~0.70 | ~0.50 |

All three are `transitioning` (crystallization ~0.50). B1 carries `distress` charge — the belief is positive but the user is frustrated they can't live it out.

There may be additional beliefs below the fold, but these three are the ones we're designing the follow-up conversation to evolve.

---

## Expected evolutions in conv-92819

### 1. CONTRACTION — B2 ("I am trying to stay active")

**Trigger:** User says they've had to "completely let go" of staying active the same way, that their fitness has genuinely slipped, and they're not trying in the same way anymore. Temporal negation: "I used to think I'd bounce back."

**Cascade:**
- Stage 1: cosine similarity to "I am trying to stay active" — high (~0.75), both about physical activity effort
- Stage 2: passes threshold (≥ 0.50) ✓
- Stage 3: composite passes (≥ 0.50) ✓
- Stage 4:
  - New commitment ≈ **0.35**, prior ≈ 0.70 → delta = **−0.35** < −0.30 ✓
  - New crystallization ≈ **0.40**, prior ≈ 0.50 → delta = **−0.10** < 0 ✓
  - → **CONTRACTION**, relation_confidence ~0.83

Temporal negation ("I used to think") appears in the text but Stage 4a isn't reached — the first branch fires directly. The regex is present as an additional signal of direction.

---

### 2. REVISION — B3 ("I am trying to eat healthier!")

**Trigger:** User says they've gone "fully plant-based," it's "completely non-negotiable," it's "the foundation of my health," and they're "fully committed" — not experimenting anymore. Very high-crystallization language.

**Cascade:**
- Stage 1: cosine similarity to "I am trying to eat healthier" — solid match (~0.70), both about diet and health
- Stage 2: passes ✓
- Stage 3: composite passes ✓
- Stage 4:
  - New commitment ≈ **0.95**, prior ≈ 0.70 → delta = **+0.25** — borderline, but...
  - New crystallization ≈ **0.87**, prior ≈ 0.50 → delta = **+0.37** > 0 ✓
  - If the pipeline assigns commitment ≥ 1.00 (possible with "non-negotiable, fully committed, every single day"): delta = **+0.30** ✓
  - → **REVISION** if commitment delta clears +0.30; **CONTRACTION_OR_REVISION** if it doesn't

This is the most threshold-sensitive case. The conversation text is written to push commitment language as high as possible. If REVISION doesn't fire, CONTRACTION_OR_REVISION is still meaningful and honest — the content *has* changed even if the deltas don't cross cleanly.

---

### 3. CONTRACTION_OR_REVISION — B1 ("I love being active.")

**Trigger:** User says "I love being active — it's just who I am. Even when I can't do the things I want, I still need movement in my life."

**Cascade:**
- Stage 1: cosine similarity very high (~0.88) — almost a restatement
- Stage 4:
  - Commitment barely moves (belief is still strongly held, maybe ~0.88 vs prior 0.90) → delta ≈ **−0.02**
  - Crystallization may tick up slightly (injury deepened this as core identity, distress charge may reduce) → delta ≈ **+0.05**
  - Neither threshold crossed, no polarity flip
  - → **CONTRACTION_OR_REVISION, relation_confidence = 0.50**

This is the "IDENTITY restatement" case. The classifier doesn't produce IDENTITY in v1 — high-similarity, low-delta events land in the middle band. The arc will always be dashed for this event. That's correct: we genuinely can't tell from deltas alone whether this is evolution or repetition.

---

### 4. EXPANSION — Meditation / emotional regulation (new lineage)

**Trigger:** User says they've started meditating every morning, they never saw themselves as a "meditation person," and it's helped them manage emotional weight and handle stress better.

**Cascade:**
- Stage 1: ChromaDB query returns no candidates for user 66 with cosine_sim ≥ 0.50 against "I meditate daily to manage stress and emotional wellbeing" — nothing about mindfulness in conv-92818
- → **EXPANSION**, new canonical_id created, founding event, relation_to_prior = NULL

---

### 5. EXPANSION — Patience / acceptance as a practiced skill (new lineage)

**Trigger:** User says they've developed a genuine belief that patience and acceptance are skills you have to practice, and meditation has been the practice ground.

**Cascade:**
- No prior belief about patience, acceptance, or psychological skills
- → **EXPANSION**, second new lineage

---

## Why these specific deltas

| Belief | Prior commitment | Prior crystallization | Target new commitment | Target new crystallization | Expected delta trigger |
|--------|-----------------|----------------------|----------------------|---------------------------|----------------------|
| B2 (stay active) | 0.70 | 0.50 | ~0.35 | ~0.40 | commit −0.35, crystal −0.10 → CONTRACTION |
| B3 (eat healthier) | 0.70 | 0.50 | ~0.95–1.00 | ~0.87 | commit +0.25–0.30, crystal +0.37 → REVISION (or C_OR_R) |
| B1 (love being active) | 0.90 | 0.50 | ~0.88 | ~0.55 | commit −0.02, crystal +0.05 → CONTRACTION_OR_REVISION |

---

## Swimlane expectation after both sessions evaluated

```
                      [2023-10-01]          [2023-11-15]
love-being-active   | ◆ ─────────────────── ○  (CONTRACTION_OR_REVISION, dashed — rel_conf 0.50)
try-to-stay-active  | ◆ ─────────────────── ▽  (CONTRACTION, solid if rel_conf ≥ 0.80)
eat-healthier       | ◆ ─────────────────── △  (REVISION or C_OR_R depending on commit delta)
meditation          |                        ◆  (EXPANSION, founding event — new lane)
patience-acceptance |                        ◆  (EXPANSION, founding event — new lane)
```

---

## Verification checklist after running

- [ ] `lore.db` → `belief_events` has new rows with correct `relation_to_prior` values
- [ ] `current_beliefs` → updated for B1, B2, B3; new rows for meditation and patience
- [ ] `belief_vectors` → 5 upserts for user 66 (3 updated + 2 new)
- [ ] `GET /users/66/beliefs` → 5 lineages, B1/B2/B3 each with 2 events, expansions with 1
- [ ] `/beliefs/66` swimlane → 5 lanes, 2 session columns, arc styles as above
- [ ] Dashed arc on B1 lane (relation_confidence = 0.50)
- [ ] Solid arc on B2 lane (CONTRACTION with confidence ~0.83 → both conf ≥ 0.80)
