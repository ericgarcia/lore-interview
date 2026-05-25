"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  EvaluationResponse,
  SourceSummary,
  SelfDomain,
  ViewMode,
  BeliefObject,
} from "@/lib/types";
import { SignalSummary } from "@/components/SignalSummary";
import { DomainRadar } from "@/components/DomainRadar";
import { BeliefCard } from "@/components/BeliefCard";
import { TurnViewer } from "@/components/TurnViewer";

const VIEWS: ViewMode[] = ["full", "storybot", "recommendation"];

function ViewSwitcher({ active, onChange }: { active: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex gap-1 p-0.5 rounded-lg bg-[#22263a] border border-[#2e3350]">
      {VIEWS.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`text-xs px-3 py-1 rounded transition-colors ${
            active === v
              ? "bg-indigo-600 text-white"
              : "text-[#6b7280] hover:text-[#e8eaf0]"
          }`}
        >
          {v}
        </button>
      ))}
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
  const [view, setView] = useState<ViewMode>("full");
  const [activeDomain, setActiveDomain] = useState<SelfDomain | null>(null);
  const [selectedBelief, setSelectedBelief] = useState<BeliefObject | null>(null);

  // Load source from sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem("lore:source");
    if (!raw) { router.replace("/"); return; }
    const s = JSON.parse(raw) as SourceSummary;
    if (s.id !== id) { router.replace("/"); return; }
    setSource(s);
  }, [id, router]);

  const runEvaluation = useCallback(async (s: SourceSummary, v: ViewMode) => {
    setLoading(true);
    setResult(null);
    setError(null);
    setSelectedBelief(null);
    setStartedAt(Date.now());
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: s, view: v }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error ?? "Unknown error");
      setResult(data as EvaluationResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setStartedAt(null);
    }
  }, []);

  // Auto-run on load
  useEffect(() => {
    if (source) runEvaluation(source, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const handleViewChange = (v: ViewMode) => {
    setView(v);
    if (source) runEvaluation(source, v);
  };

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
          <ViewSwitcher active={view} onChange={handleViewChange} />
          {source && !loading && (
            <button
              onClick={() => runEvaluation(source, view)}
              className="text-xs bg-[#22263a] hover:bg-[#2e3350] border border-[#2e3350] text-[#9ca3af] hover:text-[#e8eaf0] px-3 py-1 rounded transition-colors"
            >
              Re-run
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
                  view={view}
                  highlighted={selectedBelief?.belief_id === b.belief_id}
                  onClick={() =>
                    setSelectedBelief(selectedBelief?.belief_id === b.belief_id ? null : b)
                  }
                />
              ))}
            </div>
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
