"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { DataIndex, UserEntry, SourceSummary } from "@/lib/types";

function SourceCard({
  source,
  onEvaluate,
}: {
  source: SourceSummary;
  onEvaluate: () => void;
}) {
  const isConv = source.source_type === "conversation";
  const label = isConv
    ? `Conversation ${(source as { ref_conversation_id: number }).ref_conversation_id}`
    : `Post ${(source as { post_id: number }).post_id}`;
  const date = isConv
    ? (source as { first_turn_at: string }).first_turn_at?.slice(0, 10)
    : null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#2e3350] bg-[#22263a] px-3 py-2">
      <div>
        <p className="text-sm text-[#e8eaf0]">{label}</p>
        <p className="text-xs text-[#6b7280]">
          {source.turn_count} turns{date ? ` · ${date}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded border ${
          isConv
            ? "bg-blue-900/50 text-blue-300 border-blue-700"
            : "bg-amber-900/50 text-amber-300 border-amber-700"
        }`}>
          {source.source_type}
        </span>
        <button
          onClick={onEvaluate}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded transition-colors"
        >
          Evaluate
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserEntry | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then(setIndex)
      .catch((e) => setError(String(e)));
  }, []);

  const handleEvaluate = useCallback(
    (source: SourceSummary) => {
      sessionStorage.setItem("lore:source", JSON.stringify(source));
      router.push(`/evaluate/${source.id}`);
    },
    [router]
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-[#2e3350] bg-[#1a1d27] flex flex-col">
        <div className="px-4 py-4 border-b border-[#2e3350]">
          <h1 className="text-sm font-semibold text-[#e8eaf0]">Lore Belief Explorer</h1>
          <p className="text-xs text-[#6b7280] mt-0.5">
            {index ? `${index.users.length} users` : "Loading data…"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {error && (
            <p className="px-4 text-xs text-rose-400">{error}</p>
          )}
          {index?.users.map((user) => (
            <button
              key={user.ref_user_id}
              onClick={() => setSelectedUser(user)}
              className={`w-full text-left px-4 py-2.5 transition-colors ${
                selectedUser?.ref_user_id === user.ref_user_id
                  ? "bg-indigo-950/60 text-[#e8eaf0]"
                  : "text-[#9ca3af] hover:bg-[#22263a] hover:text-[#e8eaf0]"
              }`}
            >
              <p className="text-sm font-medium truncate">
                {user.screen_name ?? `User ${user.ref_user_id}`}
              </p>
              <p className="text-xs text-[#6b7280]">
                {user.sources.length} source{user.sources.length !== 1 ? "s" : ""}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-6">
        {!selectedUser ? (
          <div className="flex items-center justify-center h-full text-[#6b7280] text-sm">
            Select a user to browse their conversations and discussions
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold text-[#e8eaf0] mb-1">
              {selectedUser.screen_name ?? `User ${selectedUser.ref_user_id}`}
            </h2>
            <p className="text-xs text-[#6b7280] mb-4">
              ref_user_id: {selectedUser.ref_user_id} · {selectedUser.sources.length} sources
            </p>
            <div className="space-y-2">
              {selectedUser.sources.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  onEvaluate={() => handleEvaluate(s)}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
