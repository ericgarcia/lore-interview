"use client";

import { useEffect, useRef } from "react";
import type { ConversationSummary, DiscussionSummary } from "@/lib/types";

interface Props {
  source: ConversationSummary | DiscussionSummary;
  highlightedTurns: Set<number>;
  focusTurn: number | null;
}

export function TurnViewer({ source, highlightedTurns, focusTurn }: Props) {
  const refs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (focusTurn !== null) {
      refs.current.get(focusTurn)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusTurn]);

  if (source.source_type === "conversation") {
    const s = source as ConversationSummary;
    const userId = s.ref_user_id;

    return (
      <div className="space-y-3">
        {s.turns.map((turn, i) => {
          const isUser = turn.ref_user_id === userId;
          const isBot = !isUser;
          const isHighlighted = isUser && highlightedTurns.has(i);

          return (
            <div
              key={i}
              ref={(el) => { if (el) refs.current.set(i, el); }}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed transition-colors ${
                  isBot
                    ? "bg-[#22263a] text-[#9ca3af]"
                    : isHighlighted
                    ? "bg-indigo-700/60 text-white ring-1 ring-indigo-500"
                    : "bg-[#2e3350] text-[#e8eaf0]"
                }`}
              >
                {isBot && (
                  <p className="text-[10px] text-[#4a5568] mb-0.5 uppercase tracking-wider">StoryBot</p>
                )}
                {turn.message}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Discussion
  const s = source as DiscussionSummary;
  return (
    <div className="space-y-3">
      {s.turns.map((turn, i) => {
        const isOP = turn.comment_id === null;
        const isHighlighted = highlightedTurns.has(i);

        return (
          <div
            key={i}
            ref={(el) => { if (el) refs.current.set(i, el); }}
            className={`rounded-lg border px-3 py-2 text-xs leading-relaxed transition-colors ${
              isOP
                ? "border-[#4a4f7a] bg-[#22263a] text-[#9ca3af]"
                : isHighlighted
                ? "border-indigo-500 bg-indigo-950/40 text-[#e8eaf0] ring-1 ring-indigo-500"
                : "border-[#2e3350] bg-[#1a1d27] text-[#e8eaf0]"
            }`}
          >
            <p className="text-[10px] text-[#4a5568] mb-0.5 uppercase tracking-wider">
              {isOP ? "Original Post" : `Comment ${turn.comment_id}`}
            </p>
            {turn.text}
          </div>
        );
      })}
    </div>
  );
}
