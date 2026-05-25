import type { Signal, DataQuality } from "@/lib/types";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-[#6b7280]">{label}</span>
      <span className="text-sm font-semibold text-[#e8eaf0]">{value}</span>
    </div>
  );
}

export function SignalSummary({ signal, quality }: { signal: Signal; quality: DataQuality }) {
  return (
    <div className="flex flex-wrap items-center gap-6 px-4 py-3 rounded-lg border border-[#2e3350] bg-[#1a1d27]">
      <Stat label="beliefs" value={signal.belief_count} />
      <Stat label="high-conf" value={signal.high_confidence_count} />
      <Stat label="richness" value={signal.richness_score.toFixed(2)} />
      <Stat
        label="dominant"
        value={signal.dominant_self_domain ?? <span className="text-[#6b7280]">—</span>}
      />
      <div className="ml-auto flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded border ${
          quality.viable
            ? "bg-emerald-900/50 text-emerald-300 border-emerald-700"
            : "bg-rose-900/50 text-rose-300 border-rose-700"
        }`}>
          {quality.viable ? "viable" : "low signal"}
        </span>
        <span className="text-xs text-[#6b7280]">{quality.turn_count} turns</span>
      </div>
    </div>
  );
}
