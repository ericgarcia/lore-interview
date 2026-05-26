"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  DataIndex,
  SourceSummary,
  UserEntry,
  BatchStatus,
  BatchStartResponse,
} from "@/lib/types";

type EvalStatus = "unknown" | "evaluated" | "unevaluated";
type Filter = "unevaluated" | "all";

interface SourceRow {
  source: SourceSummary;
  evalStatus: EvalStatus;
}

interface ProgressItem {
  source_id: string;
  status: BatchStatus;
  error?: string;
}

function statusIcon(status: BatchStatus | undefined) {
  if (!status || status === "pending") return <span className="text-[#4a5568]">○</span>;
  if (status === "running") return <span className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />;
  if (status === "done") return <span className="text-emerald-400">✓</span>;
  return <span className="text-rose-400">✗</span>;
}

function evalBadge(s: EvalStatus) {
  if (s === "evaluated") return <span className="text-[10px] text-emerald-500">evaluated</span>;
  if (s === "unevaluated") return <span className="text-[10px] text-[#4a5568]">—</span>;
  return <span className="text-[10px] text-[#4a5568]">…</span>;
}

function sourceLabel(s: SourceSummary) {
  if (s.source_type === "conversation") return `Conv ${s.ref_conversation_id}`;
  return `Post ${s.post_id}`;
}

export default function BatchPage() {
  const router = useRouter();
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [evalStatuses, setEvalStatuses] = useState<Record<string, EvalStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("unevaluated");
  const [progress, setProgress] = useState<Record<string, ProgressItem>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<{ succeeded: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Load data index
  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((data: DataIndex) => setIndex(data))
      .catch(() => {});
  }, []);

  // Check evaluated status for all sources
  useEffect(() => {
    if (!index) return;
    const allSources = index.users.flatMap((u) => u.sources);
    Promise.all(
      allSources.map(async (s) => {
        try {
          const r = await fetch(`/api/evaluations/${s.id}`);
          return [s.id, r.ok ? "evaluated" : "unevaluated"] as const;
        } catch {
          return [s.id, "unevaluated"] as const;
        }
      })
    ).then((pairs) => {
      setEvalStatuses(Object.fromEntries(pairs));
    });
  }, [index]);

  const visibleSources = useCallback(
    (user: UserEntry): SourceRow[] => {
      return user.sources
        .map((s) => ({ source: s, evalStatus: evalStatuses[s.id] ?? "unknown" }))
        .filter((r) => filter === "all" || r.evalStatus !== "evaluated");
    },
    [evalStatuses, filter]
  );

  const allVisible = index
    ? index.users.flatMap((u) => visibleSources(u).map((r) => r.source.id))
    : [];

  const toggleSource = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleUser = (user: UserEntry) => {
    const ids = visibleSources(user).map((r) => r.source.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const toggleAll = () => {
    const allSelected = allVisible.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allVisible));
  };

  const run = useCallback(async () => {
    if (!index || selected.size === 0) return;
    setIsRunning(true);
    setRunSummary(null);
    setError(null);

    const sourcesToRun = index.users
      .flatMap((u) => u.sources)
      .filter((s) => selected.has(s.id));

    // Initialise progress entries as pending
    const initial: Record<string, ProgressItem> = {};
    sourcesToRun.forEach((s) => { initial[s.id] = { source_id: s.id, status: "pending" }; });
    setProgress(initial);

    let batchId: string;
    try {
      const res = await fetch("/api/batch/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: sourcesToRun }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail ?? d.error ?? "Failed to start batch");
      }
      const data = (await res.json()) as BatchStartResponse;
      batchId = data.batch_id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsRunning(false);
      return;
    }

    // Open SSE stream
    const es = new EventSource(`/api/batch/${batchId}/progress`);
    esRef.current = es;

    es.onmessage = (evt) => {
      const event = JSON.parse(evt.data) as {
        done?: boolean;
        succeeded?: number;
        failed?: number;
        source_id?: string;
        status?: BatchStatus;
        error?: string;
      };

      if (event.done) {
        setRunSummary({ succeeded: event.succeeded ?? 0, failed: event.failed ?? 0 });
        setIsRunning(false);
        es.close();
        esRef.current = null;
        // Refresh eval statuses for completed sources
        setEvalStatuses((prev) => {
          const next = { ...prev };
          sourcesToRun.forEach((s) => {
            const p = progress[s.id];
            if (!p || p.status === "done") next[s.id] = "evaluated";
          });
          return next;
        });
        return;
      }

      if (event.source_id && event.status) {
        setProgress((prev) => ({
          ...prev,
          [event.source_id!]: {
            source_id: event.source_id!,
            status: event.status!,
            error: event.error,
          },
        }));
      }
    };

    es.onerror = () => {
      setError("Lost connection to progress stream");
      setIsRunning(false);
      es.close();
      esRef.current = null;
    };
  }, [index, selected, progress]);

  // Cleanup on unmount
  useEffect(() => () => esRef.current?.close(), []);

  const selectedCount = selected.size;
  const hasVisible = allVisible.length > 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#2e3350] bg-[#1a1d27]">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-[#6b7280] hover:text-[#e8eaf0] transition-colors"
        >
          ← back
        </button>
        <h1 className="text-sm font-semibold text-[#e8eaf0]">Batch Evaluation</h1>
        <div className="ml-auto flex items-center gap-3">
          {runSummary && (
            <span className="text-xs text-[#6b7280]">
              <span className="text-emerald-400">{runSummary.succeeded} done</span>
              {runSummary.failed > 0 && <span className="text-rose-400 ml-2">{runSummary.failed} failed</span>}
            </span>
          )}
          <button
            onClick={run}
            disabled={selectedCount === 0 || isRunning}
            className="text-xs px-3 py-1.5 rounded transition-colors bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRunning ? "Running…" : `Run Selected (${selectedCount})`}
          </button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 mx-4 mt-3 rounded-lg border border-rose-700 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: source list */}
        <aside className="w-72 shrink-0 border-r border-[#2e3350] bg-[#1a1d27] flex flex-col">
          <div className="px-3 py-2 border-b border-[#2e3350] flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {(["unevaluated", "all"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    filter === f
                      ? "bg-indigo-900/50 border-indigo-700 text-indigo-300"
                      : "border-[#2e3350] text-[#6b7280] hover:text-[#e8eaf0]"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={toggleAll}
              disabled={!hasVisible}
              className="text-[10px] text-[#6b7280] hover:text-[#e8eaf0] disabled:opacity-40"
            >
              {allVisible.every((id) => selected.has(id)) && allVisible.length > 0 ? "deselect all" : "select all"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {!index && (
              <p className="px-4 py-3 text-xs text-[#6b7280]">Loading…</p>
            )}
            {index?.users.map((user) => {
              const rows = visibleSources(user);
              if (rows.length === 0) return null;
              const userIds = rows.map((r) => r.source.id);
              const userAllSelected = userIds.every((id) => selected.has(id));
              return (
                <div key={user.ref_user_id} className="mb-1">
                  <button
                    onClick={() => toggleUser(user)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#22263a] transition-colors text-left"
                  >
                    <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center text-[9px] ${
                      userAllSelected
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "border-[#4a5568] text-transparent"
                    }`}>✓</span>
                    <span className="text-xs font-medium text-[#9ca3af]">
                      {user.screen_name ?? `User ${user.ref_user_id}`}
                    </span>
                    <span className="text-[10px] text-[#4a5568] ml-auto">{rows.length}</span>
                  </button>
                  {rows.map(({ source, evalStatus }) => (
                    <button
                      key={source.id}
                      onClick={() => toggleSource(source.id)}
                      className="w-full flex items-center gap-2 pl-7 pr-3 py-1.5 hover:bg-[#22263a] transition-colors text-left"
                    >
                      <span className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center text-[9px] ${
                        selected.has(source.id)
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "border-[#4a5568] text-transparent"
                      }`}>✓</span>
                      <span className="text-xs text-[#9ca3af] flex-1 truncate">{sourceLabel(source)}</span>
                      {evalBadge(evalStatus)}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right: progress panel */}
        <main className="flex-1 overflow-y-auto p-4">
          {Object.keys(progress).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#6b7280]">
              <p className="text-sm">Select sources and click Run</p>
              <p className="text-xs">Progress will appear here as evaluations complete.</p>
            </div>
          ) : (
            <div className="max-w-xl space-y-1.5">
              <p className="text-[10px] uppercase tracking-widest text-[#6b7280] mb-3">Progress</p>
              {Object.values(progress).map((item) => (
                <div
                  key={item.source_id}
                  className="flex items-center gap-3 rounded-lg border border-[#2e3350] bg-[#1a1d27] px-3 py-2"
                >
                  <span className="w-4 flex items-center justify-center text-sm">
                    {statusIcon(item.status)}
                  </span>
                  <span className="flex-1 text-xs text-[#9ca3af] font-mono truncate">{item.source_id}</span>
                  <span className={`text-[10px] tabular-nums ${
                    item.status === "done" ? "text-emerald-500"
                    : item.status === "error" ? "text-rose-400"
                    : item.status === "running" ? "text-indigo-400"
                    : "text-[#4a5568]"
                  }`}>
                    {item.status}
                  </span>
                  {item.error && (
                    <span className="text-[10px] text-rose-400 truncate max-w-[200px]" title={item.error}>
                      {item.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
