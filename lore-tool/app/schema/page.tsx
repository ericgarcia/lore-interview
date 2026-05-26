"use client";

import { useRouter } from "next/navigation";

// ── Design tokens ─────────────────────────────────────────────────────────────
const INDIGO = "#6366f1";
const TEAL = "#14b8a6";
const AMBER = "#f59e0b";
const VIOLET = "#8b5cf6";
const ROSE = "#f43f5e";

const DOMAIN_COLORS: Record<string, string> = {
  identity: INDIGO,
  capability: TEAL,
  value: AMBER,
  relational: VIOLET,
  aspirational: ROSE,
};

// ── Shared primitives ─────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16">
      <h2 className="text-base font-semibold text-[#e8eaf0] mb-4 pb-2 border-b border-[#2e3350]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-[#a5b4fc] mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  name,
  type,
  children,
}: {
  name: string;
  type: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 py-3 border-b border-[#1e2130] last:border-0">
      <div className="w-48 shrink-0">
        <code className="text-xs text-[#a5b4fc] bg-[#1e2138] px-1.5 py-0.5 rounded">{name}</code>
        <div className="text-[10px] text-[#4b5280] mt-1 font-mono">{type}</div>
      </div>
      <p className="text-sm text-[#9ca3af] leading-relaxed flex-1">{children}</p>
    </div>
  );
}

function DesignNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-indigo-900/60 bg-indigo-950/30 px-4 py-3 text-sm text-[#a5b4fc] leading-relaxed mb-4">
      {children}
    </div>
  );
}

function Callout({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-[#1e2130] last:border-0 items-start">
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
        style={{ backgroundColor: color + "22", color }}
      >
        {label}
      </span>
      <p className="text-sm text-[#9ca3af] leading-relaxed">{children}</p>
    </div>
  );
}

function JsonBlock({ children }: { children: string }) {
  return (
    <pre className="text-[11px] text-[#9ca3af] bg-[#13151f] border border-[#2e3350] rounded-lg p-4 overflow-x-auto leading-relaxed mb-4">
      {children}
    </pre>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "data_quality", label: "data_quality" },
  { id: "signal", label: "signal" },
  { id: "beliefs", label: "beliefs[ ]" },
  { id: "classification", label: "— Classification" },
  { id: "scores", label: "— Scores" },
  { id: "provenance", label: "— Provenance" },
  { id: "design", label: "Design Decisions" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchemaPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#13151f]">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#2e3350] bg-[#1a1d27]">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-[#6b7280] hover:text-[#e8eaf0] transition-colors"
        >
          ← back
        </button>
        <span className="text-sm text-[#e8eaf0] font-medium">Belief Evaluation Schema</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <nav className="w-44 shrink-0 border-r border-[#2e3350] bg-[#1a1d27] py-4 overflow-y-auto">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`block px-4 py-1.5 text-xs transition-colors hover:text-[#e8eaf0] ${
                item.label.startsWith("—")
                  ? "pl-7 text-[#4b5280]"
                  : "text-[#6b7280]"
              }`}
            >
              {item.label.replace("— ", "")}
            </a>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-8 py-6 max-w-3xl">
          <div className="flex flex-col gap-10">

            {/* Overview */}
            <Section id="overview" title="Overview">
              <p className="text-sm text-[#9ca3af] leading-relaxed mb-4">
                Every call to <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">POST /conversations/evaluate</code> returns
                the same envelope. Cached results retrieved via{" "}
                <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">GET /evaluations/{"{source_id}"}</code> are identical.
              </p>
              <JsonBlock>{`{
  "schema_version": "1.0",
  "source_type":    "conversation",       // "conversation" | "discussion"
  "ref_conversation_id": 92818,           // null for discussions
  "post_id":        null,                 // null for conversations
  "ref_user_id":    66,
  "processing_mode": "sync",
  "extraction_method": "baml+nli",
  "data_quality":   { ... },
  "signal":         { ... },
  "beliefs":        [ ... ]
}`}</JsonBlock>
              <p className="text-sm text-[#9ca3af] leading-relaxed">
                <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">extraction_method</code> is stored so the consumer can distinguish results
                produced by different pipeline versions without inspecting the scores directly.
              </p>
            </Section>

            {/* data_quality */}
            <Section id="data_quality" title="data_quality">
              <p className="text-sm text-[#9ca3af] leading-relaxed mb-4">
                Metadata about the source that shapes how much trust to place in the extraction.
                Short conversations don't provide enough context for the model to distinguish
                genuine self-beliefs from conversational small talk.
              </p>
              <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                <Field name="turn_count" type="int">
                  Number of user turns processed. Includes only the evaluated user's turns, not
                  StoryBot's questions.
                </Field>
                <Field name="viable" type="bool">
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">true</code> if{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">turn_count ≥ 8</code>.
                  Below this threshold the conversation is too short for reliable extraction —
                  beliefs are still returned, but with suppressed confidence scores.
                </Field>
                <Field name="confidence_adjustment" type="float 0–1">
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">min(1.0, turn_count / 8)</code>.
                  Multiplied into every belief's final{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">confidence</code> score.
                  A three-turn exchange yields 0.375; anything over eight turns is 1.0.
                </Field>
                <Field name="viable_threshold" type="int">
                  The threshold used (currently <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">8</code>).
                  Stored in the result so the threshold can change without invalidating historical records.
                </Field>
              </div>
            </Section>

            {/* signal */}
            <Section id="signal" title="signal">
              <p className="text-sm text-[#9ca3af] leading-relaxed mb-4">
                A roll-up of what the extraction found. Intended as a fast diagnostic without
                unpacking individual beliefs.
              </p>
              <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                <Field name="richness_score" type="float">
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">belief_count / turn_count</code>.
                  How many beliefs per user turn. A conversation where someone articulates one
                  belief per two turns (0.5) is substantially richer than a surface-level
                  check-in (0.1).
                </Field>
                <Field name="belief_count" type="int">
                  Total beliefs in the <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">beliefs</code> array
                  after deduplication and NLI verification.
                </Field>
                <Field name="high_confidence_count" type="int">
                  Beliefs with{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">confidence ≥ 0.7</code>.
                  A rough proxy for how many beliefs are strongly grounded in the text vs.
                  flagged by short-conversation penalisation.
                </Field>
                <Field name="dominant_self_domain" type="enum | null">
                  The <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">self_domain</code> with the most beliefs in
                  this evaluation. Useful for quickly characterising a session — was this primarily
                  about identity, capability, or values?
                </Field>
                <Field name="beliefs_by_domain" type="object">
                  Count per domain across all five values:{" "}
                  {["identity", "capability", "value", "relational", "aspirational"].map((d) => (
                    <span
                      key={d}
                      className="inline-block text-[10px] px-1.5 py-0.5 rounded mr-1"
                      style={{ backgroundColor: DOMAIN_COLORS[d] + "22", color: DOMAIN_COLORS[d] }}
                    >
                      {d}
                    </span>
                  ))}.
                </Field>
                <Field name="domain_summaries" type="array">
                  One entry per domain with at least one belief:{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">{"{ domain, belief_count, avg_commitment, avg_crystallization }"}</code>.
                  Useful for comparing how firmly vs. tentatively beliefs are held across life areas.
                </Field>
              </div>
            </Section>

            {/* beliefs identity */}
            <Section id="beliefs" title="beliefs[ ] — Identity & Text">
              <p className="text-sm text-[#9ca3af] leading-relaxed mb-4">
                Each entry is a single extracted self-belief. The fields are grouped below by
                concern: identity, classification, scores, and provenance.
              </p>
              <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                <Field name="belief_id" type="string">
                  Deterministic ID:{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">"b_" + sha256(user_id + belief_text + domain)[:8]</code>.
                  The same belief re-extracted from a different conversation produces the same ID,
                  enabling stable deduplication in the belief graph.
                </Field>
                <Field name="belief_text" type="string">
                  A clean, first-person statement of the belief in the user's voice —
                  paraphrased for concision, not verbatim.
                  e.g. <em className="text-[#7c8aab]">"Running is core to how I see myself."</em>
                </Field>
                <Field name="belief_type" type='"explicit" | "implicit"'>
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">explicit</code> — stated directly by the user.{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">implicit</code> — reasonably inferred from what they said.
                  Implicit beliefs are held to a higher NLI threshold before being accepted.
                </Field>
                <Field name="subject_tag" type="string">
                  A 2–5 word noun phrase naming the life topic:{" "}
                  <em className="text-[#7c8aab]">"physical fitness"</em>,{" "}
                  <em className="text-[#7c8aab]">"professional identity"</em>,{" "}
                  <em className="text-[#7c8aab]">"body image and limits"</em>.
                  Used as the seed for belief category clustering. Stable vocabulary: the same
                  topic should produce the same tag across conversations.
                </Field>
                <Field name="evidence_span" type="string">
                  The exact quote from the conversation that most directly supports this belief.
                  The primary anchor for human review and the NLI premise.
                </Field>
                <Field name="depth_markers" type="string[]">
                  Specific words or phrases that drove the{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">claim_commitment</code> and{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">crystallization</code> scores —
                  e.g. <em className="text-[#7c8aab]">["I've always", "that's just who I am"]</em>.
                  Useful for understanding why those scores landed where they did.
                </Field>
              </div>
            </Section>

            {/* classification */}
            <Section id="classification" title="beliefs[ ] — Classification">
              <Sub title="self_domain">
                <p className="text-sm text-[#9ca3af] leading-relaxed mb-3">
                  Which dimension of self-perception this belief belongs to.
                </p>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                  {[
                    { name: "identity", desc: `Core sense of who they are — stable self-concept statements. "I've always been a creative person."` },
                    { name: "capability", desc: `What they can or can't do; strengths and perceived limits. "I'm not coordinated enough for dance."` },
                    { name: "value", desc: `What matters to them morally or personally; principles they hold. "Eating whole plants is non-negotiable for me."` },
                    { name: "relational", desc: `How they see themselves in relation to others — roles they hold, not facts about other people. "I tend to run alone."` },
                    { name: "aspirational", desc: `Who they want to become or are actively working toward. "I'm trying to become someone who shows up consistently."` },
                  ].map(({ name, desc }) => (
                    <Callout key={name} label={name} color={DOMAIN_COLORS[name]}>
                      {desc}
                    </Callout>
                  ))}
                </div>
              </Sub>

              <Sub title="polarity">
                <p className="text-sm text-[#9ca3af] leading-relaxed mb-3">
                  How the user frames this self-perception. This is about framing, not objective
                  valence — <em className="text-[#7c8aab]">"I've always struggled with consistency"</em> is{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">negative</code> even
                  if the speaker is at peace with it.
                </p>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                  <Callout label="positive" color="#22c55e">Pride or affirmation in how they describe themselves.</Callout>
                  <Callout label="negative" color="#ef4444">Framed as a limitation, loss, or concern.</Callout>
                  <Callout label="neutral" color="#6b7280">Matter-of-fact; no discernible positive or negative charge.</Callout>
                </div>
              </Sub>

              <Sub title="affective_charge">
                <p className="text-sm text-[#9ca3af] leading-relaxed mb-3">
                  The emotional quality of how the belief is held. Scored only when surface
                  evidence is present — never guessed. <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">null</code> when
                  evidence is insufficient.
                </p>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                  <Callout label="distress" color="#f43f5e">Anxiety, pain, or fear around how this belief is held.</Callout>
                  <Callout label="defiant" color="#8b5cf6">Identity assertion or active resistance to a challenge.</Callout>
                  <Callout label="resigned" color="#f59e0b">Reluctant acceptance of an unwanted reality.</Callout>
                  <Callout label="enthusiastic" color="#14b8a6">Pride, excitement, or energy.</Callout>
                  <Callout label="neutral" color="#6b7280">Stated as matter-of-fact; no detectable emotional charge.</Callout>
                </div>
              </Sub>

              <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                <Field name="temporal_scope" type="string | null">
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">habitual</code> (ongoing pattern) ·{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">permanent</code> (fixed trait) ·{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">situational</code> (specific context) ·{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">general</code> (broadly applies).
                  Null when the user gives no temporal signal.
                </Field>
              </div>
            </Section>

            {/* scores */}
            <Section id="scores" title="beliefs[ ] — Confidence & Scores">
              <DesignNote>
                <strong>claim_commitment vs. crystallization are deliberately separate.</strong>{" "}
                Commitment measures how firmly someone asserts a belief right now.
                Crystallization measures how open they are to revising it.
                Someone can say <em>"I am absolutely a runner"</em> (high commitment) while also saying{" "}
                <em>"though I've been rethinking what that means lately"</em> (low crystallization).
                Conflating these into a single "confidence" would lose that signal.
              </DesignNote>
              <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                <Field name="nli_confidence" type="float 0–1">
                  Raw NLI entailment score: how strongly the extracted belief is entailed by
                  the full user turn used as the NLI premise. The full turn (not just the
                  evidence span) is used to resolve anaphora — pronouns in a short span often
                  refer to subjects established earlier in the message.
                </Field>
                <Field name="confidence" type="float 0–1">
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">nli_confidence × confidence_adjustment</code>.
                  The final belief confidence after short-conversation penalisation.
                  This is the score to use downstream.
                </Field>
                <Field name="claim_commitment" type="float 0–1">
                  How firmly the speaker presents this belief as fixed, scored by the LLM.
                  Copula frames (<em className="text-[#7c8aab]">"I am X"</em>,{" "}
                  <em className="text-[#7c8aab]">"I've always been X"</em>) score near 1.0.
                  Hedged frames (<em className="text-[#7c8aab]">"I tend to"</em>,{" "}
                  <em className="text-[#7c8aab]">"I suppose I"</em>) score near 0.2.
                  Measures <em>assertion strength</em>.
                </Field>
                <Field name="crystallization" type="float 0–1">
                  How open the speaker is to revising this belief.{" "}
                  <em className="text-[#7c8aab]">"That's just who I am"</em> → 1.0.{" "}
                  <em className="text-[#7c8aab]">"I'm still figuring this out"</em> → 0.0.
                  Actively questioning (<em className="text-[#7c8aab]">"lately I've been rethinking"</em>) → below 0.3.
                  Measures <em>revision-openness</em>, not assertion strength.
                </Field>
                <Field name="belief_state" type='"crystallized" | "transitioning"'>
                  Derived from crystallization:{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">≥ 0.6</code> →{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">crystallized</code>.
                  A convenience field for filtering without thresholding manually.
                </Field>
                <Field name="session_weight" type="float">
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">log(session_number + 1)</code>.
                  Beliefs from later conversations in a long-running relationship carry more
                  weight than first-session disclosures. Always 0.693 for a first session.
                </Field>
              </div>
            </Section>

            {/* provenance */}
            <Section id="provenance" title="beliefs[ ] — Provenance">
              <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] divide-y divide-[#1e2130]">
                <Field name="source_evidence" type="array">
                  One entry per turn this belief draws from:{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">
                    {"{ ref_conversation_id, turn_index, transaction_datetime_utc, post_id, comment_id }"}
                  </code>.
                  A belief can span multiple turns when a user's answer continues across messages.
                </Field>
                <Field name="delta" type='"new" | "reinforced" | "contradicted" | "unchanged"'>
                  How this belief relates to the user's prior belief graph.{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">new</code> if no matching belief existed before.{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">reinforced</code> if a belief with the same ID was
                  already present.{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">contradicted</code> and{" "}
                  <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">unchanged</code> are
                  resolved during the graph persistence pass after the evaluation returns.
                </Field>
              </div>
            </Section>

            {/* design decisions */}
            <Section id="design" title="Design Decisions">
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] p-4">
                  <p className="text-sm font-medium text-[#e8eaf0] mb-2">NLI verification after LLM extraction</p>
                  <p className="text-sm text-[#9ca3af] leading-relaxed">
                    Extracted beliefs are cross-checked against the full source turn using a local
                    NLI cross-encoder before being accepted. This catches hallucinations where the
                    LLM infers a belief the user didn't actually express. The full turn (not just
                    the evidence span) is used as the premise so that anaphora in a short quote
                    can be resolved from earlier in the message. Implicit beliefs are held to a
                    stricter threshold than explicit ones.
                  </p>
                </div>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] p-4">
                  <p className="text-sm font-medium text-[#e8eaf0] mb-2">commitment and crystallization as separate axes</p>
                  <p className="text-sm text-[#9ca3af] leading-relaxed">
                    A single "confidence" score would conflate two meaningfully different things.
                    Commitment captures how assertively someone holds a belief in the moment.
                    Crystallization captures how settled that belief is — whether the person
                    treats it as open to revision or as fixed. Both matter for downstream use:
                    a highly committed but low-crystallization belief is actively in flux and
                    worth revisiting. A low-commitment but high-crystallization belief is quietly
                    held and unlikely to change. Keeping them separate preserves that signal.
                  </p>
                </div>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] p-4">
                  <p className="text-sm font-medium text-[#e8eaf0] mb-2">No fixed taxonomy for domains or categories</p>
                  <p className="text-sm text-[#9ca3af] leading-relaxed">
                    The five <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">self_domain</code> values
                    are broad enough to be stable across any topic but specific enough to be
                    meaningful. Below that level, the <code className="text-[#a5b4fc] text-xs bg-[#1e2138] px-1 rounded">subject_tag</code> is
                    free-form — the LLM names what the belief is actually about rather than
                    mapping it to a pre-built ontology. Tags are then clustered into categories
                    via embedding similarity, so the category structure emerges from the data
                    rather than being imposed upfront.
                  </p>
                </div>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] p-4">
                  <p className="text-sm font-medium text-[#e8eaf0] mb-2">Deterministic belief_id</p>
                  <p className="text-sm text-[#9ca3af] leading-relaxed">
                    The belief ID is a hash of user, text, and domain rather than a random UUID.
                    This means the same belief extracted from two different conversations produces
                    the same ID, so the graph persistence layer can detect reinforcement without
                    requiring an exact string match lookup. It also makes re-ingesting the same
                    conversation idempotent.
                  </p>
                </div>
                <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] p-4">
                  <p className="text-sm font-medium text-[#e8eaf0] mb-2">Short-conversation confidence penalty</p>
                  <p className="text-sm text-[#9ca3af] leading-relaxed">
                    A two-turn conversation might surface a real belief or might just be
                    conversational noise. Rather than discarding short conversations entirely,
                    the pipeline applies a linear penalty to confidence scores —
                    a three-turn exchange yields scores at 37.5% of their raw NLI value.
                    This lets short conversations contribute to the belief graph at reduced
                    weight rather than being silently dropped.
                  </p>
                </div>
              </div>
            </Section>

          </div>
        </main>
      </div>
    </div>
  );
}
