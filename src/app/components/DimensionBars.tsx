"use client";

const DIMS: { key: string; label: string }[] = [
  { key: "holderGrowth", label: "Holders" },
  { key: "top10Concentration", label: "Top10" },
  { key: "realMoney", label: ">$10" },
  { key: "volume", label: "Volume" },
  { key: "price", label: "Price" },
];

export function DimensionBars({
  dimensions,
}: {
  dimensions: Record<string, number>;
}) {
  return (
    <div className="space-y-2">
      {DIMS.map(({ key, label }) => {
        const raw = dimensions[key] ?? 0;
        const v = Math.max(-1, Math.min(1, raw));
        const pct = Math.abs(v) * 50;
        const positive = v >= 0;
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-right font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
              {label}
            </span>
            <div className="relative h-[5px] flex-1 bg-white/[0.06]">
              <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
              <div
                className="absolute top-0 h-full transition-all duration-300"
                style={{
                  background: positive ? "#7c3aed" : "#ef4444",
                  ...(positive
                    ? { left: "50%", width: `${pct}%` }
                    : { right: "50%", width: `${pct}%` }),
                }}
              />
            </div>
            <span
              className={`w-10 text-right font-mono text-[10px] ${positive ? "text-[var(--ave-accent-bright)]" : "text-red-400"}`}
            >
              {v >= 0 ? "+" : ""}
              {(v * 100).toFixed(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
