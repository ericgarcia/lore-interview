"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { UserBeliefsResponse } from "@/lib/types";
import { BeliefTimeline } from "@/components/BeliefTimeline";

export default function BeliefsPage() {
  const params = useParams();
  const router = useRouter();
  const user_id = params.user_id as string;

  const [data, setData] = useState<UserBeliefsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/beliefs/${user_id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: UserBeliefsResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [user_id]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#13151f]">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#2e3350] bg-[#1a1d27]">
        <button
          onClick={() => router.push("/")}
          className="text-xs text-[#6b7280] hover:text-[#e8eaf0] transition-colors"
        >
          ← back
        </button>
        <div>
          <span className="text-sm text-[#e8eaf0] font-medium">
            Belief Timeline — User {user_id}
          </span>
          {data && (
            <span className="ml-3 text-xs text-[#6b7280]">
              {data.lineages.length} lineage{data.lineages.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[#6b7280]">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs">Loading belief graph…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-300 max-w-md">
              <p className="font-medium mb-1">Failed to load beliefs</p>
              <p className="text-xs">{error}</p>
              <p className="text-xs mt-2 text-rose-400">
                Make sure the API server is running and at least one evaluation has been run for this user.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && data && (
          <div className="h-full flex flex-col">
            {data.lineages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-[#6b7280] text-sm">
                  <p>No belief lineages recorded yet for user {user_id}.</p>
                  <p className="text-xs mt-1">Run an evaluation from the home page to populate the graph.</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <BeliefTimeline lineages={data.lineages} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
