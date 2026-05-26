"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryProposal, ProposedGroup, ProposedCategory } from "@/lib/types";

function ProposedCategoryChip({ cat }: { cat: ProposedCategory }) {
  const changed = cat.proposed_label !== cat.current_label;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded bg-[#252840] border border-[#2e3350]">
      <span className="text-[#4b5280] font-mono">u{cat.user_id}</span>
      <span className="text-[#3a3f5c]">·</span>
      {changed ? (
        <>
          <span className="line-through text-[#7c8aab]">{cat.current_label}</span>
          <span className="text-[#4b5280]">→</span>
          <span className="text-[#a5b4fc]">{cat.proposed_label}</span>
        </>
      ) : (
        <span className="text-[#9ca3af]">{cat.proposed_label}</span>
      )}
    </span>
  );
}

function GroupBlock({ group }: { group: ProposedGroup }) {
  const [expanded, setExpanded] = useState(true);
  const directCats = group.categories ?? [];
  const subgroups = group.subgroups ?? [];
  const totalCats =
    directCats.length + subgroups.reduce((s, sg) => s + sg.categories.length, 0);
  const userIds = new Set([
    ...directCats.map((c) => c.user_id),
    ...subgroups.flatMap((sg) => sg.categories.map((c) => c.user_id)),
  ]);

  return (
    <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#1e2234] transition-colors border-b border-[#2e3350]"
      >
        <div>
          <span className="text-sm font-semibold text-[#e8eaf0]">{group.label}</span>
          <span className="ml-3 text-xs text-[#6b7280]">
            {totalCats} categor{totalCats !== 1 ? "ies" : "y"} · {userIds.size} user{userIds.size !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-[#4b5280] text-xs shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="py-2 flex flex-col">
          {subgroups.map((sg, i) => (
            <div
              key={sg.label}
              className={`px-4 py-3 flex gap-4 ${i < subgroups.length - 1 ? "border-b border-[#1e2130]" : ""}`}
            >
              <div className="w-36 shrink-0 pt-0.5">
                <p className="text-xs font-medium text-[#9ca3af]">{sg.label}</p>
                <p className="text-[10px] text-[#4b5280] mt-0.5">
                  {sg.categories.length} categor{sg.categories.length !== 1 ? "ies" : "y"}
                </p>
              </div>
              <div className="flex-1 flex flex-wrap gap-1.5">
                {sg.categories.map((c) => (
                  <ProposedCategoryChip key={c.category_id} cat={c} />
                ))}
              </div>
            </div>
          ))}
          {directCats.length > 0 && (
            <div className="px-4 py-3 flex flex-wrap gap-1.5">
              {directCats.map((c) => (
                <ProposedCategoryChip key={c.category_id} cat={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProposalPage() {
  const router = useRouter();
  const [proposal, setProposal] = useState<CategoryProposal | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/proposals/categories")
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: CategoryProposal | null) => {
        if (d) setProposal(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  const date = proposal
    ? new Date(proposal.proposed_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#13151f]">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#2e3350] bg-[#1a1d27]">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-[#6b7280] hover:text-[#e8eaf0] transition-colors"
        >
          ← back
        </button>
        <div className="flex-1">
          <span className="text-sm text-[#e8eaf0] font-medium">Category Consolidation Proposal</span>
          {proposal && (
            <span className="ml-3 text-xs text-[#6b7280]">
              {proposal.current_category_count} categories · {proposal.user_count} users · {proposal.proposed_group_count} groups · {date}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[#6b7280]">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs">Loading proposal…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-300 max-w-md">
              <p className="font-medium mb-1">Failed to load proposal</p>
              <p className="text-xs">{error}</p>
            </div>
          </div>
        )}

        {notFound && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-[#6b7280] text-sm max-w-sm">
              <p className="text-[#e8eaf0] font-medium mb-2">No proposal yet</p>
              <p className="text-xs mb-4">Run the consolidation skill to generate one:</p>
              <code className="text-[#a5b4fc] text-xs bg-[#1a1d27] px-3 py-2 rounded border border-[#2e3350]">
                /consolidate-categories
              </code>
            </div>
          </div>
        )}

        {proposal && (
          <div className="flex flex-col gap-3 max-w-4xl mx-auto">
            {proposal.groups.map((group) => (
              <GroupBlock key={group.label} group={group} />
            ))}
            <div className="rounded-lg border border-[#2e3350] bg-[#1a1d27] px-4 py-3 text-xs text-[#4b5280]">
              To regenerate, run{" "}
              <code className="text-[#6366f1]">/consolidate-categories</code> in Claude Code.
              <span className="ml-2 text-[#3a3f5c]">· {proposal.model}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
