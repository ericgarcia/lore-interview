"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  EvaluationResponse,
  SourceSummary,
  SelfDomain,
  BeliefObject,
  RejectedBelief,
  RejectedBeliefResponse,
} from "@/lib/types";
import { SignalSummary } from "@/components/SignalSummary";
import { DomainRadar } from "@/components/DomainRadar";
import { BeliefCard } from "@/components/BeliefCard";
import { TurnViewer } from "@/components/TurnViewer";

const REASON_LABEL: Record<string, { label: string; color: string }> = {
  nli_threshold: { label: "NLI threshold", color: "text-rose-400 bg-rose-950/50 border-rose-800" },
  low_commitment: { label: "low commitment", color: "text-amber-400 bg-amber-950/50 border-amber-800" },
  no_evidence: { label: "no evidence", color: "text-[#6b7280] bg-[#1a1d27] border-[#2e3350]" },
};

function NliBar({ score, threshold }: { score: number; threshold: number }) {
  const pct = Math.round(score * 100);
  const threshPct = Math.round(threshold * 100);
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-[#6b7280] mb-0.5">
        <span>NLI score: <span className="text-rose-400 font-mono">{score.toFixed(3)}</span></span>
        <span>threshold: <span className="text-[#9ca3af] font-mono">{threshold.toFixed(2)}</span></span>
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-[#22263a]">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-rose-600"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-[-2px] h-[10px] w-px bg-[#9ca3af]"
          style={{ left: `${threshPct}%` }}
        />
      </div>
    </div>
  );
}

function RejectedCard({ r }: { r: RejectedBelief }) {
  const meta = REASON_LABEL[r.rejection_reason] ?? { label: r.rejection_reason, color: "text-[#6b7280] bg-[#1a1d27] border-[#2e3350]" };
  return (
    <div className="rounded-lg border border-[#2e3350] bg-[#13151f] px-3 py-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[#e8eaf0] leading-snug flex-1">{r.belief_text}</p>
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${meta.color}`}>
          {meta.label}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] text-[#6b7280]">
        <span>{r.self_domain}</span>
        <span>·</span>
        <span>commit {r.claim_commitment.toFixed(2)}</span>
        <span>·</span>
        <span>{r.belief_type}</span>
        {r.subject_tag && <><span>·</span><span>{r.subject_tag}</span></>}
      </div>
      {r.evidence_spans.length > 0 && (
        <p className="text-[11px] text-[#9ca3af] italic border-l-2 border-[#2e3350] pl-2 leading-snug">
          &ldquo;{r.evidence_spans[0]}&rdquo;
        </p>
      )}
      {r.rejection_reason === "nli_threshold" && r.nli_score != null && r.nli_threshold != null && (
        <>
          {r.nli_premise && r.nli_premise !== r.evidence_spans[0] && (
            <div className="mt-1.5">
              <p className="text-[10px] text-[#6b7280] mb-0.5">NLI scored against full turn:</p>
              <p className="text-[11px] text-[#9ca3af] border-l-2 border-indigo-800 pl-2 leading-snug">
                {r.nli_premise}
              </p>
            </div>
          )}
          <NliBar score={r.nli_score} threshold={r.nli_threshold} />
        </>
      )}
    </div>
  );
}

function RejectedSection({ rejected }: { rejected: RejectedBelief[] }) {
  const [open, setOpen] = useState(false);
  if (rejected.length === 0) return null;

  const byReason = rejected.reduce<Record<string, number>>((acc, r) => {
    acc[r.rejection_reason] = (acc[r.rejection_reason] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mt-4 border border-[#2e3350] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#1a1d27] hover:bg-[#22263a] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#9ca3af]">
            NLI Rejected ({rejected.length})
          </span>
          <div className="flex gap-1.5">
            {Object.entries(byReason).map(([reason, count]) => {
              const meta = REASON_LABEL[reason];
              return (
                <span key={reason} className={`text-[10px] px-1.5 py-0.5 rounded border ${meta?.color ?? "text-[#6b7280] border-[#2e3350]"}`}>
                  {count} {meta?.label ?? reason}
                </span>
              );
            })}
          </div>
        </div>
        <span className="text-[10px] text-[#6b7280]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-[#13151f]">
          {rejected.map((r) => <RejectedCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span>{secs}s</span>;
}

export default function EvaluatePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [source, setSource] = useState<SourceSummary | null>(null);
  const [result, setResult] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [activeDomain, setActiveDomain] = useState<SelfDomain | null>(null);
  const [selectedBelief, setSelectedBelief] = useState<BeliefObject | null>(null);
  const [rejected, setRejected] = useState<RejectedBelief[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem("lore:source");
    if (!raw) { router.replace("/"); return; }
    const s = JSON.parse(raw) as SourceSummary;
    if (s.id !== id) { router.replace("/"); return; }
    setSource(s);

    fetch(`/api/evaluations/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setResult(data as EvaluationResponse); })
      .catch(() => {});

    fetch(`/api/evaluations/${id}/rejected`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setRejected((data as RejectedBeliefResponse).rejected); })
      .catch(() => {});
  }, [id, router]);

  const runEvaluation = useCallback(async (s: SourceSummary) => {
    setLoading(true);
    setResult(null);
    setError(null);
    setSelectedBelief(null);
    setStartedAt(Date.now());
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: s }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error ?? "Unknown error");
      setResult(data as EvaluationResponse);

      fetch(`/api/evaluations/${id}/rejected`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d) setRejected((d as RejectedBeliefResponse).rejected); })
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setStartedAt(null);
    }
  }, [id]);

  const filteredBeliefs = result
    ? activeDomain
      ? result.beliefs.filter((b) => b.self_domain === activeDomain)
      : result.beliefs
    : [];

  const highlightedTurns = new Set<number>(
    selectedBelief
      ? selectedBelief.source_evidence.map((e) => e.turn_index ?? -1).filter((i) => i >= 0)
      : []
  );

  const focusTurn = selectedBelief?.source_evidence[0]?.turn_index ?? null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#2e3350] bg-[#1a1d27]">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-[#6b7280] hover:text-[#e8eaf0] transition-colors"
        >
          ← back
        </button>
        <span className="text-sm text-[#e8eaf0] font-medium truncate">{id}</span>
        <div className="ml-auto flex items-center gap-3">
          {loading && startedAt && (
            <span className="text-xs text-[#6b7280]">
              Extracting… <Elapsed startedAt={startedAt} />
            </span>
          )}
          {source && !loading && (
            <button
              onClick={() => runEvaluation(source)}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                result
                  ? "bg-[#22263a] hover:bg-[#2e3350] border border-[#2e3350] text-[#9ca3af] hover:text-[#e8eaf0]"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {result ? "Re-run" : "Evaluate"}
            </button>
          )}
        </div>
      </header>

      {/* Signal summary */}
      {result && (
        <div className="shrink-0 px-4 py-2">
          <SignalSummary signal={result.signal} quality={result.data_quality} />
        </div>
      )}

      {/* Main three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: radar */}
        <aside className="w-56 shrink-0 border-r border-[#2e3350] bg-[#1a1d27] p-4 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-[#6b7280] mb-3">Self Domains</p>
          {result ? (
            <DomainRadar
              signal={result.signal}
              activeDomain={activeDomain}
              onDomainClick={setActiveDomain}
            />
          ) : (
            <div className="h-40 flex items-center justify-center text-xs text-[#6b7280]">
              {loading ? "…" : "—"}
            </div>
          )}
        </aside>

        {/* Center: belief list */}
        <section className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          {!loading && !result && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[#6b7280]">
              <p className="text-sm">Ready to evaluate</p>
              <p className="text-xs">Click <span className="text-indigo-400">Evaluate</span> in the header to extract beliefs from this conversation.</p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#6b7280]">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Extracting beliefs…</p>
            </div>
          )}

          {!loading && result && filteredBeliefs.length === 0 && (
            <div className="flex items-center justify-center h-full text-xs text-[#6b7280]">
              {activeDomain ? `No ${activeDomain} beliefs extracted` : "No beliefs extracted"}
            </div>
          )}

          {!loading && result && filteredBeliefs.length > 0 && (
            <div className="space-y-2">
              {filteredBeliefs.map((b) => (
                <BeliefCard
                  key={b.belief_id}
                  belief={b}
                  highlighted={selectedBelief?.belief_id === b.belief_id}
                  onClick={() =>
                    setSelectedBelief(selectedBelief?.belief_id === b.belief_id ? null : b)
                  }
                />
              ))}
            </div>
          )}

          {!loading && result && !activeDomain && (
            <RejectedSection rejected={rejected} />
          )}
        </section>

        {/* Right: turn viewer */}
        <aside className="w-72 shrink-0 border-l border-[#2e3350] bg-[#1a1d27] flex flex-col">
          <div className="px-3 py-2 border-b border-[#2e3350] flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[#6b7280]">Conversation</p>
            {selectedBelief && (
              <button
                onClick={() => setSelectedBelief(null)}
                className="text-[10px] text-[#6b7280] hover:text-[#e8eaf0]"
              >
                clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {source ? (
              <TurnViewer
                source={source}
                highlightedTurns={highlightedTurns}
                focusTurn={focusTurn}
              />
            ) : (
              <p className="text-xs text-[#6b7280]">Loading…</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
