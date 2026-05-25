"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Signal, SelfDomain } from "@/lib/types";

const DOMAINS: SelfDomain[] = ["identity", "capability", "value", "relational", "aspirational"];

interface Props {
  signal: Signal;
  activeDomain: SelfDomain | null;
  onDomainClick: (d: SelfDomain | null) => void;
}

export function DomainRadar({ signal, activeDomain, onDomainClick }: Props) {
  const maxCount = Math.max(...DOMAINS.map((d) => signal.beliefs_by_domain[d] ?? 0), 1);

  const summaryMap = Object.fromEntries(
    signal.domain_summaries.map((s) => [s.domain, s])
  );

  const data = DOMAINS.map((d) => ({
    domain: d,
    beliefs: signal.beliefs_by_domain[d] ?? 0,
    commitment: Math.round((summaryMap[d]?.avg_commitment ?? 0) * 100),
    // normalize belief count to 0–100 for same scale as commitment
    beliefsNorm: Math.round(((signal.beliefs_by_domain[d] ?? 0) / maxCount) * 100),
  }));

  return (
    <div className="flex flex-col gap-3">
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data}>
          <PolarGrid stroke="#2e3350" />
          <PolarAngleAxis
            dataKey="domain"
            tick={({ x, y, payload }) => {
              const d = payload.value as SelfDomain;
              const isActive = activeDomain === d;
              return (
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="cursor-pointer select-none"
                  fill={isActive ? "#818cf8" : "#6b7280"}
                  fontSize={10}
                  fontWeight={isActive ? 700 : 400}
                  onClick={() => onDomainClick(activeDomain === d ? null : d)}
                >
                  {d}
                </text>
              );
            }}
          />
          <Radar
            name="beliefs"
            dataKey="beliefsNorm"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.25}
          />
          <Radar
            name="commitment"
            dataKey="commitment"
            stroke="#a78bfa"
            fill="none"
            strokeDasharray="4 2"
          />
          <Tooltip
            contentStyle={{ background: "#1a1d27", border: "1px solid #2e3350", borderRadius: 6, fontSize: 11 }}
            formatter={(value, name) => {
              const n = Number(value);
              return name === "beliefs"
                ? [`${Math.round((n / 100) * maxCount)} beliefs`, "count"]
                : [`${n}%`, "avg commitment"];
            }}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Domain filter chips */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {DOMAINS.map((d) => {
          const count = signal.beliefs_by_domain[d] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={d}
              onClick={() => onDomainClick(activeDomain === d ? null : d)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                activeDomain === d
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-[#22263a] border-[#2e3350] text-[#9ca3af] hover:border-[#4a4f7a]"
              }`}
            >
              {d} ({count})
            </button>
          );
        })}
      </div>
    </div>
  );
}
