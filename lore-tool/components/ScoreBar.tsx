export function ScoreBar({
  label,
  value,
  color = "bg-indigo-500",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 text-[#6b7280] shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[#2e3350]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-[#9ca3af] tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}
