"use client";

import { useState, useMemo } from "react";
import type { BeliefLineage, BeliefEvent, RelationToPrior } from "@/lib/types";

const LABEL_WIDTH = 200;
const COL_WIDTH = 110;
const LANE_HEIGHT = 72;
const HEADER_HEIGHT = 44;
const DOT_R = 6;
const ARC_HEIGHT = 22;
const RIGHT_PAD = 32;

const RELATION_COLOR: Record<string, string> = {
  null: "#6366f1",       // indigo — founding event
  EXPANSION: "#6366f1",
  IDENTITY: "#6b7280",
  CONTRACTION: "#f97316",
  REVISION: "#a855f7",
  CONTRACTION_OR_REVISION: "#eab308",
  ELABORATION: "#3b82f6",
  SUBSUMPTION: "#14b8a6",
};

const RELATION_LABEL: Record<string, string> = {
  EXPANSION: "founding",
  IDENTITY: "identity",
  CONTRACTION: "contraction",
  REVISION: "revision",
  CONTRACTION_OR_REVISION: "contraction/revision",
  ELABORATION: "elaboration",
  SUBSUMPTION: "subsumption",
};

const ARC_LABEL: Record<string, string> = {
  CONTRACTION: "contracting",
  REVISION: "revision",
  CONTRACTION_OR_REVISION: "shifting",
  ELABORATION: "elaborating",
  IDENTITY: "stable",
  SUBSUMPTION: "subsumed",
};

const POLARITY_FILL: Record<string, string> = {
  positive: "#22c55e",
  negative: "#ef4444",
  neutral: "#6366f1",
};

function dotColor(relation: RelationToPrior | null): string {
  return RELATION_COLOR[relation ?? "null"] ?? "#6366f1";
}

function isDashed(event: BeliefEvent): boolean {
  return (
    (event.match_confidence !== null && event.match_confidence < 0.8) ||
    (event.relation_confidence !== null && event.relation_confidence < 0.8)
  );
}

// Diamond marker (EXPANSION / founding)
function Diamond({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const pts = `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
  return <polygon points={pts} fill={fill} stroke="#1a1d27" strokeWidth={1.5} />;
}

// Downward wedge (CONTRACTION)
function Wedge({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  const pts = `${x - r},${y - r * 0.8} ${x + r},${y - r * 0.8} ${x},${y + r}`;
  return <polygon points={pts} fill={fill} stroke="#1a1d27" strokeWidth={1.5} />;
}

// Chevron right (REVISION)
function Chevron({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  return (
    <polyline
      points={`${x - r * 0.6},${y - r} ${x + r * 0.6},${y} ${x - r * 0.6},${y + r}`}
      fill="none"
      stroke={fill}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function EventMarker({
  x, y, event, selected, onClick,
}: {
  x: number; y: number; event: BeliefEvent; selected: boolean; onClick: () => void;
}) {
  const fill = dotColor(event.relation_to_prior);
  const r = selected ? DOT_R + 2 : DOT_R;
  const rel = event.relation_to_prior;

  return (
    <g
      onClick={onClick}
      style={{ cursor: "pointer" }}
      opacity={selected ? 1 : 0.85}
    >
      {/* Hit area */}
      <circle cx={x} cy={y} r={DOT_R + 6} fill="transparent" />
      {selected && (
        <circle cx={x} cy={y} r={r + 5} fill={fill} opacity={0.2} />
      )}
      {rel === null || rel === "EXPANSION" ? (
        <Diamond x={x} y={y} r={r} fill={fill} />
      ) : rel === "CONTRACTION" ? (
        <Wedge x={x} y={y} r={r} fill={fill} />
      ) : rel === "REVISION" ? (
        <Chevron x={x} y={y} r={r} fill={fill} />
      ) : rel === "CONTRACTION_OR_REVISION" ? (
        <>
          <circle cx={x - 3} cy={y} r={r * 0.65} fill={fill} stroke="#1a1d27" strokeWidth={1} />
          <circle cx={x + 3} cy={y} r={r * 0.65} fill={fill} stroke="#1a1d27" strokeWidth={1} />
        </>
      ) : (
        <circle cx={x} cy={y} r={r} fill={fill} stroke="#1a1d27" strokeWidth={1.5} />
      )}
    </g>
  );
}

function ArcPath({
  x1, x2, y, event,
}: {
  x1: number; x2: number; y: number; event: BeliefEvent;
}) {
  const mx = (x1 + x2) / 2;
  const controlY = y - ARC_HEIGHT - (x2 - x1) / 12;
  const labelY = controlY - 4;
  const dashed = isDashed(event);
  const fill = dotColor(event.relation_to_prior);
  const label = event.relation_to_prior ? ARC_LABEL[event.relation_to_prior] : null;
  return (
    <g>
      <path
        d={`M ${x1},${y} Q ${mx},${controlY} ${x2},${y}`}
        fill="none"
        stroke={fill}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "5,3" : undefined}
        opacity={0.7}
      />
      {label && (
        <text
          x={mx}
          y={labelY}
          textAnchor="middle"
          fontSize={8}
          fill={fill}
          opacity={0.8}
          fontFamily="monospace"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function DetailPanel({ event, priorEvent, onClose }: { event: BeliefEvent; priorEvent: BeliefEvent | null; onClose: () => void }) {
  let flags: Record<string, unknown> | null = null;
  try {
    if (event.relation_classifier_flags) flags = JSON.parse(event.relation_classifier_flags);
  } catch {}

  let sourceTurns: unknown[] = [];
  try {
    if (event.source_turns) sourceTurns = JSON.parse(event.source_turns);
  } catch {}

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="flex flex-col gap-3 text-[11px]">
      <div className="flex items-start justify-between">
        <p className="text-[#e8eaf0] font-medium leading-snug pr-4">{event.belief_text}</p>
        <button onClick={onClose} className="shrink-0 text-[#6b7280] hover:text-[#e8eaf0]">✕</button>
      </div>

      {priorEvent && (
        <div className="border border-[#2e3350] rounded p-2 bg-[#12141f]">
          <p className="text-[9px] uppercase tracking-widest text-[#6b7280] mb-1">Previously</p>
          <p className="text-[#6b7280] leading-snug">{priorEvent.belief_text}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[#9ca3af]">
        {event.subject_tag && (
          <><span>Topic</span><span className="text-[#e8eaf0]">{event.subject_tag}</span></>
        )}
        <span>Domain</span><span className="text-[#e8eaf0]">{event.self_domain}</span>
        <span>Polarity</span><span className="text-[#e8eaf0]">{event.polarity}</span>
        <span>State</span><span className="text-[#e8eaf0]">{event.belief_state}</span>
        <span>Commitment</span><span className="text-[#e8eaf0]">{pct(event.claim_commitment)}</span>
        <span>Crystallization</span><span className="text-[#e8eaf0]">{pct(event.crystallization)}</span>
        {event.affective_charge && (
          <><span>Affect</span><span className="text-[#e8eaf0]">{event.affective_charge}</span></>
        )}
        {event.relation_to_prior && (
          <><span>Relation</span>
          <span className="text-[#e8eaf0]">{RELATION_LABEL[event.relation_to_prior] ?? event.relation_to_prior}</span></>
        )}
        {event.match_confidence !== null && (
          <><span>Match conf.</span><span className="text-[#e8eaf0]">{event.match_confidence.toFixed(2)}</span></>
        )}
        {event.relation_confidence !== null && (
          <><span>Relation conf.</span><span className="text-[#e8eaf0]">{event.relation_confidence.toFixed(2)}</span></>
        )}
        <span>Valid from</span><span className="text-[#e8eaf0]">{event.valid_from.slice(0, 10)}</span>
      </div>

      {flags && (
        <div className="border-t border-[#2e3350] pt-2">
          <p className="text-[#6b7280] mb-1 uppercase tracking-widest text-[9px]">Classifier flags</p>
          {Object.entries(flags).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-[#6b7280]">{k}</span>
              <span className="text-[#9ca3af] text-right">{JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      )}

      {sourceTurns.length > 0 && (
        <div className="border-t border-[#2e3350] pt-2">
          <p className="text-[#6b7280] mb-1 uppercase tracking-widest text-[9px]">Source turns</p>
          <p className="text-[#9ca3af]">{sourceTurns.length} turn{sourceTurns.length !== 1 ? "s" : ""}</p>
        </div>
      )}
    </div>
  );
}

export function BeliefTimeline({ lineages }: { lineages: BeliefLineage[] }) {
  const [selected, setSelected] = useState<{ event: BeliefEvent; prior: BeliefEvent | null } | null>(null);

  // Collect all unique valid_from timestamps → sorted session columns
  const sessions = useMemo(() => {
    const tsSet = new Set<string>();
    for (const l of lineages) {
      for (const e of l.events) tsSet.add(e.valid_from);
    }
    return Array.from(tsSet).sort();
  }, [lineages]);

  const sessionIndex = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s, i) => m.set(s, i));
    return m;
  }, [sessions]);

  const svgWidth = LABEL_WIDTH + sessions.length * COL_WIDTH + RIGHT_PAD;
  const svgHeight = HEADER_HEIGHT + lineages.length * LANE_HEIGHT + 20;

  function laneY(laneIdx: number): number {
    return HEADER_HEIGHT + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
  }

  function eventX(valid_from: string): number {
    const idx = sessionIndex.get(valid_from) ?? 0;
    return LABEL_WIDTH + idx * COL_WIDTH + COL_WIDTH / 2;
  }

  if (lineages.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#6b7280] text-sm">
        No belief lineages recorded yet. Run an evaluation to populate the graph.
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-hidden">
      {/* Swimlane SVG */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <svg width={svgWidth} height={svgHeight} className="block">
          {/* Session date headers */}
          {sessions.map((ts, i) => (
            <text
              key={ts}
              x={LABEL_WIDTH + i * COL_WIDTH + COL_WIDTH / 2}
              y={HEADER_HEIGHT - 10}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
              fontFamily="monospace"
            >
              {ts.slice(0, 10)}
            </text>
          ))}

          {/* Session column guide lines */}
          {sessions.map((ts, i) => (
            <line
              key={`guide-${ts}`}
              x1={LABEL_WIDTH + i * COL_WIDTH + COL_WIDTH / 2}
              y1={HEADER_HEIGHT - 4}
              x2={LABEL_WIDTH + i * COL_WIDTH + COL_WIDTH / 2}
              y2={svgHeight - 4}
              stroke="#2e3350"
              strokeWidth={1}
              strokeDasharray="2,4"
            />
          ))}

          {/* Lanes */}
          {lineages.map((lineage, laneIdx) => {
            const y = laneY(laneIdx);
            const current = lineage.current;
            const polarity = current?.polarity ?? "neutral";
            const crystallization = current?.crystallization ?? 0;
            const laneFill = POLARITY_FILL[polarity] ?? "#6366f1";
            const sortedEvents = [...lineage.events].sort((a, b) =>
              a.valid_from.localeCompare(b.valid_from)
            );
            const foundingEvent = sortedEvents[0];
            const hasEvolution = sortedEvents.length > 1;
            const foundingText = foundingEvent?.belief_text ?? "";
            const currentText = current?.belief_text ?? lineage.canonical_id.slice(0, 8);

            return (
              <g key={lineage.canonical_id}>
                {/* Lane background */}
                <rect
                  x={LABEL_WIDTH}
                  y={y - LANE_HEIGHT / 2 + 6}
                  width={sessions.length * COL_WIDTH}
                  height={LANE_HEIGHT - 12}
                  fill={laneFill}
                  opacity={0.03 + crystallization * 0.08}
                  rx={4}
                />

                {/* Lane center line */}
                <line
                  x1={LABEL_WIDTH + 8}
                  y1={y}
                  x2={LABEL_WIDTH + sessions.length * COL_WIDTH - 8}
                  y2={y}
                  stroke="#2e3350"
                  strokeWidth={1}
                />

                {/* Label — two lines when evolved, one line when founding only */}
                {hasEvolution ? (
                  <foreignObject x={0} y={y - 22} width={LABEL_WIDTH - 8} height={44}>
                    <div
                      // @ts-expect-error - xmlns is needed for SVG foreignObject
                      xmlns="http://www.w3.org/1999/xhtml"
                      style={{ padding: "0 6px" }}
                    >
                      <div style={{
                        fontSize: 9,
                        color: "#6b7280",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: "13px",
                      }} title={foundingText}>
                        {foundingText}
                      </div>
                      <div style={{
                        fontSize: 8,
                        color: "#4b5563",
                        lineHeight: "10px",
                      }}>↓</div>
                      <div style={{
                        fontSize: 9,
                        color: "#c4c9d8",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: "13px",
                      }} title={currentText}>
                        {currentText}
                      </div>
                    </div>
                  </foreignObject>
                ) : (
                  <foreignObject x={0} y={y - 10} width={LABEL_WIDTH - 8} height={20}>
                    <div
                      // @ts-expect-error - xmlns is needed for SVG foreignObject
                      xmlns="http://www.w3.org/1999/xhtml"
                      style={{
                        fontSize: 9,
                        color: "#9ca3af",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: "14px",
                        padding: "0 6px",
                      }}
                      title={currentText}
                    >
                      {currentText}
                    </div>
                  </foreignObject>
                )}

                {/* Arcs between consecutive events */}
                {sortedEvents.map((event, ei) => {
                  if (ei === 0) return null;
                  const prev = sortedEvents[ei - 1];
                  const x1 = eventX(prev.valid_from);
                  const x2 = eventX(event.valid_from);
                  if (x1 === x2) return null;
                  return (
                    <ArcPath key={`arc-${event.id}`} x1={x1} x2={x2} y={y} event={event} />
                  );
                })}

                {/* Event markers */}
                {sortedEvents.map((event, ei) => {
                  const x = eventX(event.valid_from);
                  const prior = ei > 0 ? sortedEvents[ei - 1] : null;
                  const isSelected = selected?.event.id === event.id;
                  return (
                    <EventMarker
                      key={event.id}
                      x={x}
                      y={y}
                      event={event}
                      selected={isSelected}
                      onClick={() =>
                        setSelected(isSelected ? null : { event, prior })
                      }
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-64 shrink-0 border-l border-[#2e3350] bg-[#1a1d27] p-4 overflow-y-auto">
          <DetailPanel event={selected.event} priorEvent={selected.prior} onClose={() => setSelected(null)} />
        </div>
      )}

      {/* Legend */}
      {!selected && (
        <div className="w-48 shrink-0 border-l border-[#2e3350] bg-[#1a1d27] p-4">
          <p className="text-[9px] uppercase tracking-widest text-[#6b7280] mb-3">Legend</p>
          <div className="space-y-2">
            {Object.entries(RELATION_LABEL).map(([k, label]) => (
              <div key={k} className="flex items-center gap-2">
                <svg width={14} height={14} className="shrink-0">
                  <circle cx={7} cy={7} r={4} fill={RELATION_COLOR[k]} />
                </svg>
                <span className="text-[10px] text-[#9ca3af]">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1.5">
            <p className="text-[9px] uppercase tracking-widest text-[#6b7280] mb-2">Arc style</p>
            <div className="flex items-center gap-2">
              <svg width={28} height={8}><line x1={0} y1={4} x2={28} y2={4} stroke="#9ca3af" strokeWidth={1.5} /></svg>
              <span className="text-[10px] text-[#9ca3af]">solid ≥ 0.80</span>
            </div>
            <div className="flex items-center gap-2">
              <svg width={28} height={8}><line x1={0} y1={4} x2={28} y2={4} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5,3" /></svg>
              <span className="text-[10px] text-[#9ca3af]">dashed &lt; 0.80</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
