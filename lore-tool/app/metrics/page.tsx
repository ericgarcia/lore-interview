"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { MetricsSummary, MetricsHistoryRow } from "@/lib/types";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG = "#13151f";
const PANEL = "#1a1d27";
const BORDER = "#2e3350";
const TEXT = "#e8eaf0";
const MUTED = "#6b7280";
const INDIGO = "#6366f1";
const TEAL = "#14b8a6";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";
const VIOLET = "#8b5cf6";

const DOMAIN_COLORS: Record<string, string> = {
  identity: INDIGO,
  capability: TEAL,
  value: AMBER,
  relational: VIOLET,
  aspirational: ROSE,
};

const POLARITY_COLORS: Record<string, string> = {
  positive: TEAL,
  negative: ROSE,
  neutral: "#6b7280",
};

const STATE_COLORS: Record<string, string> = {
  crystallized: INDIGO,
  transitioning: AMBER,
};

const DELTA_COLORS: Record<string, string> = {
  new: TEAL,
  reinforced: INDIGO,
  contradicted: ROSE,
  unchanged: "#6b7280",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}
function dictToBar(d: Record<string, number>, colors: Record<string, string>) {
  return Object.entries(d).map(([name, value]) => ({ name, value, fill: colors[name] ?? MUTED }));
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-1"
      style={{ borderColor: BORDER, background: PANEL }}
    >
      <span className="text-xs" style={{ color: MUTED }}>{label}</span>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: TEXT }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: MUTED }}>{sub}</span>}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: MUTED }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ── Funnel ────────────────────────────────────────────────────────────────────
function Funnel({ rows }: { rows: MetricsHistoryRow[] }) {
  const extracted = rows.reduce((s, r) => s, 0); // placeholder, we only have beliefs_final in history
  // Compute totals from history rows
  const finals = rows.reduce((s, r) => s + (r.beliefs_final ?? 0), 0);
  const steps = [
    { label: "extracted", value: null },
    { label: "verified", value: null },
    { label: "deduped", value: null },
    { label: "final", value: finals },
  ];
  void extracted;
  // Funnel only works well with summary data; for now render what we have
  const max = Math.max(...steps.map((s) => s.value ?? 0), 1);
  return (
    <div className="flex items-end gap-3">
      {steps.map((s) => (
        <div key={s.label} className="flex flex-col items-center gap-1 flex-1">
          <span className="text-xs tabular-nums" style={{ color: TEXT }}>
            {s.value != null ? s.value : "—"}
          </span>
          <div
            className="w-full rounded-sm"
            style={{
              background: INDIGO,
              opacity: 0.7,
              height: s.value != null ? `${Math.max(8, (s.value / max) * 80)}px` : "8px",
            }}
          />
          <span className="text-[10px]" style={{ color: MUTED }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MetricsPage() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [history, setHistory] = useState<MetricsHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/metrics/summary").then((r) => r.json()),
      fetch("/api/metrics/history?limit=50").then((r) => r.json()),
    ])
      .then(([s, h]) => {
        setSummary(s as MetricsSummary);
        setHistory((h as MetricsHistoryRow[]).reverse()); // oldest first for charts
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const historyForChart = history.map((r, i) => ({
    ...r,
    idx: i + 1,
    label: r.evaluated_at.slice(5, 16).replace("T", " "),
  }));

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: BG }}>
      {/* Header */}
      <header
        className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: BORDER, background: PANEL }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs transition-colors hover:underline"
            style={{ color: MUTED }}
          >
            ← home
          </Link>
          <span className="text-sm font-semibold" style={{ color: TEXT }}>
            Pipeline Metrics
          </span>
          {summary && (
            <span className="text-xs" style={{ color: MUTED }}>
              {summary.total_evaluations} evaluation{summary.total_evaluations !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1 rounded border transition-colors"
          style={{ borderColor: BORDER, color: MUTED }}
        >
          refresh
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: MUTED }}>
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: INDIGO, borderTopColor: "transparent" }} />
            <p className="text-xs">Loading metrics…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="rounded-lg border px-4 py-3 text-sm max-w-md" style={{ borderColor: "#b45309", background: "#451a03", color: "#fcd34d" }}>
              <p className="font-medium mb-1">Failed to load metrics</p>
              <p className="text-xs">{error}</p>
              <p className="text-xs mt-2">Make sure the API server is running.</p>
            </div>
          </div>
        )}

        {!loading && !error && summary && (
          <div className="max-w-5xl mx-auto space-y-8">

            {/* ── Stat cards ── */}
            <Section title="Overview">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard
                  label="Avg Latency"
                  value={summary.avg_latency_ms != null ? `${fmt(summary.avg_latency_ms)} ms` : "—"}
                  sub={summary.p90_latency_ms != null ? `p90: ${fmt(summary.p90_latency_ms)} ms` : undefined}
                />
                <StatCard
                  label="Avg Tokens"
                  value={summary.avg_tokens_in != null ? `${fmt(summary.avg_tokens_in)} in` : "—"}
                  sub={summary.avg_tokens_out != null ? `${fmt(summary.avg_tokens_out)} out` : undefined}
                />
                <StatCard
                  label="Avg Retries"
                  value={fmt(summary.avg_llm_retries, 2)}
                  sub="per evaluation"
                />
                <StatCard
                  label="Coverage"
                  value={pct(summary.avg_richness_score)}
                  sub="beliefs / turn"
                />
                <StatCard
                  label="NLI Rejection"
                  value={pct(summary.avg_nli_rejection_rate)}
                  sub="of extracted"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <StatCard label="Viable Rate" value={pct(summary.viable_rate)} sub="≥ 8 turns" />
                <StatCard label="Avg NLI Conf." value={fmt(summary.avg_nli_confidence, 2)} />
                <StatCard label="Avg Commitment" value={fmt(summary.avg_claim_commitment, 2)} />
                <StatCard label="Avg Crystallization" value={fmt(summary.avg_crystallization, 2)} />
              </div>
            </Section>

            {/* ── Time series ── */}
            {historyForChart.length > 0 && (
              <Section title="Over Time">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>Latency (ms)</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={historyForChart}>
                        <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip
                          contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }}
                          labelFormatter={(v) => `eval #${v}`}
                          formatter={(v) => [`${v} ms`, "latency"]}
                        />
                        <Line type="monotone" dataKey="total_latency_ms" stroke={INDIGO} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>Token Usage (in / out)</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={historyForChart}>
                        <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip
                          contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }}
                          labelFormatter={(v) => `eval #${v}`}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, color: MUTED }} />
                        <Line type="monotone" dataKey="llm_tokens_in" name="tokens in" stroke={TEAL} dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="llm_tokens_out" name="tokens out" stroke={AMBER} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>Coverage (beliefs / turn)</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={historyForChart}>
                        <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={[0, "auto"]} />
                        <Tooltip
                          contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }}
                          labelFormatter={(v) => `eval #${v}`}
                          formatter={(v) => [typeof v === "number" ? v.toFixed(2) : v, "richness"]}
                        />
                        <Line type="monotone" dataKey="richness_score" name="richness" stroke={VIOLET} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>NLI Rejection Rate</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={historyForChart}>
                        <XAxis dataKey="idx" tick={false} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={40} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                        <Tooltip
                          contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }}
                          labelFormatter={(v) => `eval #${v}`}
                          formatter={(v) => [typeof v === "number" ? `${Math.round(v * 100)}%` : v, "rejection"]}
                        />
                        <Line type="monotone" dataKey="nli_rejection_rate" name="rejection" stroke={ROSE} dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Section>
            )}

            {/* ── Distribution charts ── */}
            <Section title="Belief Distributions">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* By domain */}
                {Object.keys(summary.beliefs_by_domain).length > 0 && (
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>By Self-Domain</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={dictToBar(summary.beliefs_by_domain, DOMAIN_COLORS)} layout="vertical">
                        <XAxis type="number" tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fill: TEXT, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                        <Tooltip contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {dictToBar(summary.beliefs_by_domain, DOMAIN_COLORS).map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* By delta */}
                {Object.keys(summary.beliefs_by_delta).length > 0 && (
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>By Delta (new / reinforced / …)</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={dictToBar(summary.beliefs_by_delta, DELTA_COLORS)} layout="vertical">
                        <XAxis type="number" tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fill: TEXT, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
                        <Tooltip contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {dictToBar(summary.beliefs_by_delta, DELTA_COLORS).map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Polarity pie */}
                {Object.keys(summary.beliefs_by_polarity).length > 0 && (
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>By Polarity</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={dictToBar(summary.beliefs_by_polarity, POLARITY_COLORS)}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          label={({ name, percent }) =>
                            `${name ?? ""} ${Math.round((percent ?? 0) * 100)}%`
                          }
                          labelLine={false}
                        >
                          {dictToBar(summary.beliefs_by_polarity, POLARITY_COLORS).map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Belief state pie */}
                {Object.keys(summary.beliefs_by_state).length > 0 && (
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>By Belief State</p>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={dictToBar(summary.beliefs_by_state, STATE_COLORS)}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          label={({ name, percent }) =>
                            `${name ?? ""} ${Math.round((percent ?? 0) * 100)}%`
                          }
                          labelLine={false}
                        >
                          {dictToBar(summary.beliefs_by_state, STATE_COLORS).map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Affective charge bar */}
                {Object.keys(summary.beliefs_by_affective_charge).length > 0 && (
                  <div className="rounded-lg border p-4 lg:col-span-2" style={{ borderColor: BORDER, background: PANEL }}>
                    <p className="text-xs mb-3" style={{ color: MUTED }}>By Affective Charge</p>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={dictToBar(summary.beliefs_by_affective_charge, {
                        distress: ROSE, defiant: VIOLET, resigned: AMBER,
                        neutral: "#6b7280", enthusiastic: TEAL, null: "#374151",
                      })}>
                        <XAxis dataKey="name" tick={{ fill: TEXT, fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                        <Tooltip contentStyle={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11 }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {dictToBar(summary.beliefs_by_affective_charge, {
                            distress: ROSE, defiant: VIOLET, resigned: AMBER,
                            neutral: "#6b7280", enthusiastic: TEAL, null: "#374151",
                          }).map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </Section>

            {/* ── Extraction funnel ── */}
            {historyForChart.length > 0 && (
              <Section title="Extraction Funnel (fleet total)">
                <div className="rounded-lg border p-4" style={{ borderColor: BORDER, background: PANEL }}>
                  <p className="text-xs mb-4" style={{ color: MUTED }}>
                    Beliefs across pipeline stages (from history endpoint; extracted/verified/deduped available in summary with full data)
                  </p>
                  <Funnel rows={history} />
                </div>
              </Section>
            )}

            {/* ── Token totals ── */}
            <Section title="Cumulative Token Usage">
              <div className="rounded-lg border p-4 flex gap-8" style={{ borderColor: BORDER, background: PANEL }}>
                <div>
                  <p className="text-xs mb-1" style={{ color: MUTED }}>Total tokens in</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: TEAL }}>
                    {summary.total_tokens_in.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: MUTED }}>Total tokens out</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: AMBER }}>
                    {summary.total_tokens_out.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: MUTED }}>Total tokens</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: TEXT }}>
                    {(summary.total_tokens_in + summary.total_tokens_out).toLocaleString()}
                  </p>
                </div>
              </div>
            </Section>

          </div>
        )}

        {!loading && !error && summary?.total_evaluations === 0 && (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: MUTED }}>
            No evaluations recorded yet. Run an evaluation to see metrics.
          </div>
        )}
      </main>
    </div>
  );
}
