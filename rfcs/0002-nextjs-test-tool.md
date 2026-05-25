# RFC 0002 — Next.js Belief Exploration Tool

**Status:** Draft  
**Author:** Eric Garcia  
**Date:** 2026-05-25

---

## Problem

The evaluation API is tested via `baml-cli test` (extraction only) and curl (end-to-end). Neither gives a useful picture of what the pipeline is actually producing across a realistic sample of users and conversations. Specifically:

- It's hard to see whether extractions are high-quality across different user profiles
- The JSON output is unreadable for debugging belief scoring (claim_commitment, crystallization, affective_charge all need visual context to sanity-check)
- There's no way to quickly browse which users produce interesting signal vs. thin output
- The `?view=storybot|recommendation` projections have never been validated against realistic API responses

A lightweight developer tool fixes this. It also demonstrates the API contract concretely, which is valuable for the interview submission.

---

## Goals

1. Browse users and conversations from `data/conversations.json` and `data/discussions.json`
2. Submit a selected conversation or discussion to the evaluation API with one click
3. Visualize the `EvaluationResponse` in a way that makes belief quality immediately legible
4. Switch between `?view=full|storybot|recommendation` to validate each projection
5. Show the raw conversation turns alongside extracted beliefs so the extraction can be spot-checked

---

## Non-Goals

- Auth, user accounts, or persistence — this is a local dev tool
- Production deployment or SSR optimization
- Multi-user comparison or longitudinal tracking across sessions (out of scope for the interview)
- Real-time streaming of extraction results

---

## Architecture

```
lore-tool/               ← Next.js app (separate directory from the API)
  app/
    page.tsx             ← user/conversation browser
    evaluate/
      [id]/
        page.tsx         ← evaluation result view for one conversation/user
    api/
      data/route.ts      ← server-side: reads data/ files, returns user+convo index
      evaluate/route.ts  ← server-side: proxies POST to FastAPI, returns EvaluationResponse
  components/
    ConversationBrowser.tsx
    BeliefCard.tsx
    DomainRadar.tsx
    SignalSummary.tsx
    TurnViewer.tsx
    ViewSwitcher.tsx
  lib/
    data.ts              ← types + loaders for conversations.json / discussions.json
    api.ts               ← typed fetch wrapper for evaluation API
    types.ts             ← EvaluationResponse, BeliefObject, etc. (mirrored from Python models)
```

### Why proxy through Next.js API routes?

The FastAPI runs on `localhost:8000` and the browser would need CORS headers to call it directly. Proxying through a Next.js route at `/api/evaluate` avoids that and keeps the tool self-contained — one `npm run dev` command, no CORS config needed on the FastAPI.

### Data loading

`data/` is gitignored and lives on the local filesystem. Next.js API routes run in Node.js and can read files directly via `fs.readFileSync`. The `/api/data` route reads both JSON files once, builds a user index (grouped by `ref_user_id`), and returns it. The browser never touches the filesystem.

---

## Pages and Routes

### `/` — Conversation Browser

Left sidebar: list of users. Each user shows:
- `ref_user_id` and `screen_name` (from conversations) or `author_ref_user_id` (from discussions)
- Number of conversations and/or discussion posts
- Source type badge (conversation / discussion)

Main panel: when a user is selected, show their conversations/posts as selectable cards. Each card shows:
- Source type, turn count, date of first turn
- An "Evaluate" button that POSTs to `/api/evaluate` and navigates to `/evaluate/[id]`

### `/evaluate/[id]` — Evaluation Result

Four zones:

**1. Signal Summary bar** (top)
- Richness score, belief count, high-confidence count, dominant domain
- Data quality indicator: viable / not viable, turn count

**2. Domain Radar** (left panel)
- Radar/spider chart with 5 axes: identity, capability, value, relational, aspirational
- Two overlaid series: `belief_count` per domain, `avg_commitment` per domain
- Clicking a domain filters the belief list to that domain

**3. Belief List** (center panel)
- One `BeliefCard` per extracted belief, sorted by `confidence` descending
- `ViewSwitcher` tabs at the top toggle between full / storybot / recommendation projections
- Each card shows the fields relevant to the active view (see below)

**4. Turn Viewer** (right panel, always visible)
- The raw conversation turns rendered as a chat transcript
- Turns that contributed to at least one belief are highlighted
- Clicking a belief in the belief list scrolls to and highlights its source turns

---

## Component Breakdown

### `BeliefCard`

Full view:
```
┌─────────────────────────────────────────────────────┐
│ [VALUE] [explicit] [DEFIANT]        confidence: 0.84 │
│                                                       │
│ "I don't want to leave my home."                      │
│                                                       │
│ claim_commitment  ████████░░  0.90                    │
│ crystallization   ███████░░░  0.80                    │
│                                                       │
│ evidence: "I don't want to leave my home."            │
│ permanent · depth: don't want to leave                │
└─────────────────────────────────────────────────────┘
```

Storybot view (fewer fields):
```
┌─────────────────────────────────────────────────────┐
│ [VALUE] [crystallized] [DEFIANT]          new · 0.84 │
│ "I don't want to leave my home."                      │
│ commitment ████████░░   crystallization ███████░░░    │
└─────────────────────────────────────────────────────┘
```

Recommendation view (numeric scalars only):
```
┌──────────────────────────────────────────────────────┐
│ b_3f2a1c8d  [VALUE]  commitment 0.90  cryst. 0.80    │
│ confidence 0.84  session_weight 0.693  new            │
└──────────────────────────────────────────────────────┘
```

### `DomainRadar`

Recharts `RadarChart` with two `Radar` series:
- **Belief count** (filled, primary color)
- **Avg commitment** (stroke only, secondary color)

Clicking a domain segment filters the `BeliefCard` list.

### `SignalSummary`

Horizontal stat bar:
```
Beliefs: 7   High-confidence: 5   Richness: 1.00   Dominant: VALUE   ● viable (7 turns)
```

### `TurnViewer`

Chat-style rendering of the raw turns. StoryBot messages left-aligned (gray), user messages right-aligned. Turns with `source_turn_indices` references from any belief get a subtle highlight ring. Clicking a highlighted turn shows a tooltip with which beliefs reference it.

### `ViewSwitcher`

Tab group: Full | StoryBot | Recommendation. Each tab switch re-renders the belief list with the appropriate field subset — no new API call, just a different projection of the same response.

---

## Data Flow

```
Browser                  Next.js                   FastAPI
  │                         │                          │
  │  GET /api/data          │                          │
  │────────────────────────▶│  fs.readFileSync(        │
  │                         │    data/conversations,   │
  │                         │    data/discussions      │
  │                         │  )                       │
  │◀────────────────────────│                          │
  │  { users[], convos[] }  │                          │
  │                         │                          │
  │  POST /api/evaluate     │                          │
  │  { source_type, turns } │                          │
  │────────────────────────▶│  POST /conversations/    │
  │                         │    evaluate?view=full    │
  │                         │──────────────────────────▶
  │                         │         EvaluationResponse
  │                         │◀──────────────────────────
  │◀────────────────────────│                          │
  │   EvaluationResponse    │                          │
```

The browser stores the `EvaluationResponse` in React state (or URL search params for shareability). No database, no persistence.

---

## Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15, App Router | Server components for data loading; RSC eliminates a separate data-fetching layer |
| Language | TypeScript | Mirror the Python output schema as TS types for end-to-end type safety |
| Styling | Tailwind CSS + shadcn/ui | Fast component assembly; shadcn gives accessible primitives without a full design system |
| Charts | Recharts | Lightweight, React-native, good `RadarChart` support |
| State | React `useState` / URL params | No server state needed; URL params allow deep-linking to a specific evaluation result |

---

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Loading state | Progress indicator with elapsed time. No streaming — NLI runs after extraction so individual beliefs can't arrive incrementally. |
| 2 | Turn viewer | Always visible alongside the result as a persistent panel, regardless of whether beliefs were extracted. This makes it easy to spot-check any extraction, including zero-belief cases. |
| 3 | Multi-session chaining | Out of scope for this tool. |
| 4 | Data path | `DATA_DIR` environment variable in `.env.local`. Default to `../data` if unset so it works out of the box from the standard repo layout. |
