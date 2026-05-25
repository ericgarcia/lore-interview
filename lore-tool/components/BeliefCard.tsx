"use client";

import type { BeliefObject, ViewMode } from "@/lib/types";
import { DomainBadge } from "./DomainBadge";
import { ScoreBar } from "./ScoreBar";

const POLARITY_ICON: Record<string, string> = {
  positive: "↑",
  negative: "↓",
  neutral: "–",
};

const POLARITY_COLOR: Record<string, string> = {
  positive: "text-emerald-400",
  negative: "text-rose-400",
  neutral: "text-gray-400",
};

const CHARGE_COLOR: Record<string, string> = {
  distress:     "bg-rose-900/50 text-rose-300 border-rose-700",
  defiant:      "bg-orange-900/50 text-orange-300 border-orange-700",
  resigned:     "bg-slate-700/50 text-slate-300 border-slate-600",
  neutral:      "bg-gray-800/50 text-gray-400 border-gray-600",
  enthusiastic: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
};

interface Props {
  belief: BeliefObject;
  view: ViewMode;
  highlighted?: boolean;
  onClick?: () => void;
}

export function BeliefCard({ belief, view, highlighted, onClick }: Props) {
  const isRecommendation = view === "recommendation";
  const isStorybot = view === "storybot";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        highlighted
          ? "border-indigo-500 bg-indigo-950/40"
          : "border-[#2e3350] bg-[#1a1d27] hover:border-[#4a4f7a]"
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <DomainBadge domain={belief.self_domain} />

        {!isRecommendation && (
          <>
            <span className={`text-xs font-semibold ${POLARITY_COLOR[belief.polarity]}`}>
              {POLARITY_ICON[belief.polarity]} {belief.polarity}
            </span>
            {belief.affective_charge && (
              <span className={`text-xs px-2 py-0.5 rounded border ${CHARGE_COLOR[belief.affective_charge]}`}>
                {belief.affective_charge}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded border ${
              belief.belief_state === "crystallized"
                ? "bg-indigo-900/50 text-indigo-300 border-indigo-700"
                : "bg-yellow-900/50 text-yellow-300 border-yellow-700"
            }`}>
              {belief.belief_state}
            </span>
          </>
        )}

        <span className="ml-auto text-xs text-[#6b7280] tabular-nums">
          {belief.delta === "new" ? (
            <span className="text-indigo-400">new</span>
          ) : (
            <span className="text-emerald-400">{belief.delta}</span>
          )}
          {" · "}conf {belief.confidence.toFixed(2)}
        </span>
      </div>

      {/* Belief text */}
      {!isRecommendation && (
        <p className="text-sm text-[#e8eaf0] mb-2 leading-snug">
          &ldquo;{belief.belief_text}&rdquo;
        </p>
      )}

      {/* Score bars */}
      {(view === "full" || isStorybot) && (
        <div className="space-y-1 mb-2">
          <ScoreBar label="claim_commitment" value={belief.claim_commitment} color="bg-indigo-500" />
          <ScoreBar label="crystallization" value={belief.crystallization} color="bg-violet-500" />
        </div>
      )}

      {/* Recommendation: compact numeric row */}
      {isRecommendation && (
        <div className="flex flex-wrap gap-4 text-xs text-[#9ca3af] tabular-nums">
          <span className="font-mono text-[#6b7280]">{belief.belief_id}</span>
          <span>commitment <strong className="text-[#e8eaf0]">{belief.claim_commitment.toFixed(2)}</strong></span>
          <span>cryst. <strong className="text-[#e8eaf0]">{belief.crystallization.toFixed(2)}</strong></span>
          <span>session_wt <strong className="text-[#e8eaf0]">{belief.session_weight.toFixed(3)}</strong></span>
        </div>
      )}

      {/* Evidence + depth markers (full view only) */}
      {view === "full" && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-[#6b7280] italic leading-snug">
            &ldquo;{belief.evidence_span}&rdquo;
          </p>
          {belief.depth_markers.length > 0 && (
            <p className="text-xs text-[#4a5568]">
              depth: {belief.depth_markers.join(", ")}
            </p>
          )}
          {belief.temporal_scope && (
            <p className="text-xs text-[#4a5568]">{belief.temporal_scope}</p>
          )}
        </div>
      )}
    </button>
  );
}
