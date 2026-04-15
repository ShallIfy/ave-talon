"use client";

// 0..100 horizontal gauge with a draggable-looking marker.
// Colors blend red → yellow → teal as score increases.

import { cn } from "@/lib/utils";

export function ConfidenceGauge({
  score,
  label,
  className,
}: {
  score: number; // 0..100
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const tier =
    clamped >= 70 ? "HIGH" : clamped >= 40 ? "MED" : clamped > 0 ? "LOW" : "NONE";
  const tierColor =
    tier === "HIGH"
      ? "text-[color:var(--ave-teal)]"
      : tier === "MED"
        ? "text-yellow-400"
        : tier === "LOW"
          ? "text-orange-400"
          : "text-[color:var(--muted-foreground)]";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="stat-label">{label ?? "Signal Confidence"}</span>
        <span className={cn("stat-value font-mono", tierColor)}>
          {clamped.toFixed(0)}
          <span className="ml-1 text-xs font-medium opacity-70">/ 100</span>
        </span>
      </div>
      <div className="confidence-gauge-track">
        <div
          className="confidence-gauge-marker"
          style={{ left: `calc(${clamped}% - 2px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
        <span>low</span>
        <span>med</span>
        <span className={tier === "HIGH" ? "text-[color:var(--ave-teal)]" : ""}>
          high
        </span>
      </div>
    </div>
  );
}
