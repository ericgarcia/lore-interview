"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { UserCategoriesResponse, BeliefCategory, CategoryBelief } from "@/lib/types";

type Tab = "grid" | "timeline";

const COL_W = 88;
const LABEL_W = 200;

function polarityColor(polarity: string) {
  if (polarity === "positive") return "#22c55e";
  if (polarity === "negative") return "#ef4444";
  return "#6b7280";
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-14 h-1.5 bg-[#2e3350] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Grid tab ─────────────────────────────────────────────────────────────────

function BeliefRow({ belief }: { belief: CategoryBelief }) {
  const date = new Date(belief.valid_from).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#1e2130] last:border-0">
      <div
        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: polarityColor(belief.polarity) }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e8eaf0] leading-snug">{belief.belief_text}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
          <span className="text-xs text-[#6b7280]">{date}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#4b5280]">commit</span>
            <MiniBar value={belief.claim_commitment} color="#6366f1" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#4b5280]">crystal</span>
            <MiniBar value={belief.crystallization} color="#f59e0b" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryCard({ category }: { category: BeliefCategory }) {
  const [expanded, setExpanded] = useState(true);

  const first = category.beliefs[0];
  const last = category.beliefs[category.beliefs.length - 1];
  const dateRange =
    category.beliefs.length > 0
      ? first.valid_from === last.valid_from
        ? new Date(first.valid_from).toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : `${new Date(first.valid_from).toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${new Date(last.valid_from).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : null;

  return (
    <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-[#1e2234] transition-colors"
      >
        <div className="min-w-0">
          <span className="text-sm font-medium text-[#e8eaf0] capitalize">{category.label}</span>
          <div className="mt-0.5 text-xs text-[#6b7280]">
            {category.beliefs.length} belief{category.beliefs.length !== 1 ? "s" : ""}
            {dateRange && <span className="ml-1.5">· {dateRange}</span>}
          </div>
          {category.adjacent.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {category.adjacent.map((adj) => (
                <span
                  key={adj.category_id}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#252840] text-[#7c8aab] border border-[#2e3350] capitalize"
                >
                  {adj.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-[#4b5280] text-xs shrink-0 mt-0.5">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-2 border-t border-[#2e3350]">
          {category.beliefs.length === 0 ? (
            <p className="text-xs text-[#6b7280] py-3">No beliefs in this category.</p>
          ) : (
            <div className="mt-0.5">
              {category.beliefs.map((b) => (
                <BeliefRow key={b.canonical_id} belief={b} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GridView({ categories }: { categories: BeliefCategory[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-w-6xl mx-auto">
      {categories.map((cat) => (
        <CategoryCard key={cat.category_id} category={cat} />
      ))}
    </div>
  );
}

// ── Timeline tab ──────────────────────────────────────────────────────────────

function BeliefDetail({
  belief,
  onClose,
}: {
  belief: CategoryBelief;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div
            className="mt-1 w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: polarityColor(belief.polarity) }}
          />
          <p className="text-sm text-[#e8eaf0] leading-snug">{belief.belief_text}</p>
        </div>
        <button
          onClick={onClose}
          className="text-[#4b5280] hover:text-[#9ca3af] text-xs shrink-0 mt-0.5"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 ml-5">
        <span className="text-xs text-[#6b7280]">
          {new Date(belief.valid_from).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <span className="text-xs text-[#4b5280] capitalize">{belief.self_domain}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#4b5280]">commit</span>
          <MiniBar value={belief.claim_commitment} color="#6366f1" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#4b5280]">crystal</span>
          <MiniBar value={belief.crystallization} color="#f59e0b" />
        </div>
      </div>
    </div>
  );
}

function TimelineView({ categories }: { categories: BeliefCategory[] }) {
  const [selected, setSelected] = useState<CategoryBelief | null>(null);

  const activeCats = categories.filter((c) => c.beliefs.length > 0);

  const allDates = [
    ...new Set(
      activeCats.flatMap((c) => c.beliefs.map((b) => b.valid_from.slice(0, 10)))
    ),
  ].sort();

  const totalW = allDates.length * COL_W;

  return (
    <div className="flex flex-col gap-4 max-w-6xl mx-auto">
      <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] overflow-x-auto">
        <div style={{ minWidth: LABEL_W + totalW }}>
          {/* Date header */}
          <div className="flex border-b border-[#2e3350]">
            <div style={{ width: LABEL_W, minWidth: LABEL_W }} />
            {allDates.map((date) => {
              const d = new Date(date + "T12:00:00");
              return (
                <div
                  key={date}
                  style={{ width: COL_W, minWidth: COL_W }}
                  className="py-2.5 text-center shrink-0"
                >
                  <div className="text-[10px] text-[#6b7280]">
                    {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                  <div className="text-[9px] text-[#3a3f5c]">{d.getFullYear()}</div>
                </div>
              );
            })}
          </div>

          {/* Category rows */}
          {activeCats.map((cat) => {
            const byDate = new Map<string, CategoryBelief[]>();
            for (const b of cat.beliefs) {
              const day = b.valid_from.slice(0, 10);
              if (!byDate.has(day)) byDate.set(day, []);
              byDate.get(day)!.push(b);
            }

            const catDates = [...byDate.keys()].sort();
            const firstIdx = allDates.indexOf(catDates[0]);
            const lastIdx = allDates.indexOf(catDates[catDates.length - 1]);
            const lineLeft = firstIdx * COL_W + COL_W / 2;
            const lineWidth = (lastIdx - firstIdx) * COL_W;

            return (
              <div
                key={cat.category_id}
                className="flex items-center border-b border-[#1e2130] last:border-0"
                style={{ height: 56 }}
              >
                {/* Label */}
                <div
                  style={{ width: LABEL_W, minWidth: LABEL_W }}
                  className="px-4 shrink-0"
                >
                  <p className="text-xs text-[#9ca3af] capitalize truncate">{cat.label}</p>
                  <p className="text-[10px] text-[#4b5280]">
                    {cat.beliefs.length} belief{cat.beliefs.length !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Dots area */}
                <div className="relative flex items-center" style={{ width: totalW, minWidth: totalW }}>
                  {/* Connector line between first and last dot */}
                  {catDates.length > 1 && (
                    <div
                      className="absolute h-px bg-[#2e3350]"
                      style={{ left: lineLeft, width: lineWidth }}
                    />
                  )}

                  {allDates.map((date) => {
                    const beliefs = byDate.get(date);
                    if (!beliefs) {
                      return (
                        <div
                          key={date}
                          style={{ width: COL_W, minWidth: COL_W }}
                          className="shrink-0"
                        />
                      );
                    }
                    const belief = beliefs[0];
                    const isSelected = selected?.canonical_id === belief.canonical_id;
                    return (
                      <div
                        key={date}
                        style={{ width: COL_W, minWidth: COL_W }}
                        className="shrink-0 flex items-center justify-center relative z-10"
                      >
                        <button
                          onClick={() => setSelected(isSelected ? null : belief)}
                          className="flex items-center justify-center w-5 h-5 rounded-full transition-transform hover:scale-125 focus:outline-none"
                          style={{
                            backgroundColor: polarityColor(belief.polarity),
                            boxShadow: isSelected
                              ? `0 0 0 2px #1a1d27, 0 0 0 4px ${polarityColor(belief.polarity)}`
                              : undefined,
                          }}
                          title={belief.belief_text}
                        >
                          {beliefs.length > 1 && (
                            <span className="text-[7px] font-bold text-white leading-none">
                              {beliefs.length}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <BeliefDetail belief={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const params = useParams();
  const router = useRouter();
  const user_id = params.user_id as string;

  const [tab, setTab] = useState<Tab>("grid");
  const [data, setData] = useState<UserCategoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/beliefs/${user_id}/categories`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: UserCategoriesResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [user_id]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs rounded transition-colors ${
        tab === t
          ? "bg-indigo-600 text-white"
          : "text-[#6b7280] hover:text-[#e8eaf0]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#13151f]">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#2e3350] bg-[#1a1d27]">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-[#6b7280] hover:text-[#e8eaf0] transition-colors"
        >
          ← back
        </button>
        <div className="flex items-center gap-4 flex-1">
          <div>
            <span className="text-sm text-[#e8eaf0] font-medium">
              Belief Categories — User {user_id}
            </span>
            {data && (
              <span className="ml-3 text-xs text-[#6b7280]">
                {data.categories.length} categor{data.categories.length !== 1 ? "ies" : "y"}
              </span>
            )}
          </div>
          {data && data.categories.length > 0 && (
            <div className="flex gap-1">
              {tabBtn("grid", "Categories")}
              {tabBtn("timeline", "Over Time")}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[#6b7280]">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs">Loading categories…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-300 max-w-md">
              <p className="font-medium mb-1">Failed to load categories</p>
              <p className="text-xs">{error}</p>
              <p className="text-xs mt-2 text-rose-400">
                Make sure the API server is running and at least one evaluation has been persisted for this user.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {data.categories.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center text-[#6b7280] text-sm">
                  <p>No categories yet for user {user_id}.</p>
                  <p className="text-xs mt-1">
                    Run an evaluation to populate belief categories.
                  </p>
                </div>
              </div>
            ) : tab === "grid" ? (
              <GridView categories={data.categories} />
            ) : (
              <TimelineView categories={data.categories} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
