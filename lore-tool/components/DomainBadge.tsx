import type { SelfDomain } from "@/lib/types";

const COLORS: Record<SelfDomain, string> = {
  identity:    "bg-violet-900/60 text-violet-300 border-violet-700",
  capability:  "bg-blue-900/60   text-blue-300   border-blue-700",
  value:       "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  relational:  "bg-amber-900/60  text-amber-300  border-amber-700",
  aspirational:"bg-pink-900/60   text-pink-300   border-pink-700",
};

export function DomainBadge({ domain }: { domain: SelfDomain }) {
  return (
    <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${COLORS[domain]}`}>
      {domain}
    </span>
  );
}
