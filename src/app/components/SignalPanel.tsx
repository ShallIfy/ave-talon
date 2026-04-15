"use client";

import type { DetectedSignal } from "@/lib/signals/detector";
import { cn } from "@/lib/utils";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { DimensionBars } from "./DimensionBars";

const ACTION_STYLE: Record<string, string> = {
  ENTRY: "border-[var(--ave-accent)] bg-[rgba(124,58,237,0.15)] text-[var(--ave-accent-bright)]",
  DANGER: "border-red-400/40 bg-red-400/10 text-red-400",
  EXIT: "border-red-400/40 bg-red-400/10 text-red-400",
  HOLD: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
  NO_SIGNAL: "border-white/10 bg-white/5 text-white/40",
};

export function SignalPanel({
  signal,
  onProposeTrade,
}: {
  signal: DetectedSignal | null;
  onProposeTrade?: () => void;
}) {
  if (!signal || signal.signal.number === 9) {
    return (
      <div className="ave-card flex h-full flex-col items-center justify-center !p-5">
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          No active signal
        </div>
        <div className="mt-2 font-mono text-2xl font-bold text-white/20">---</div>
      </div>
    );
  }

  const action = signal.signal.action;
  const actionClass = ACTION_STYLE[action] ?? ACTION_STYLE.HOLD;

  return (
    <div className="ave-card flex h-full flex-col !p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
            actionClass,
          )}
        >
          {action}
        </span>
        <span className="font-mono text-sm font-bold text-white">
          #{signal.signal.number} {signal.signal.name}
        </span>
      </div>

      {/* Gauge */}
      <div className="mt-4">
        <ConfidenceGauge score={signal.score} label="Signal Strength" />
      </div>

      {/* Dimension Bars */}
      <div className="mt-4 border-t border-[var(--card-border)] pt-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Dimensions
        </div>
        <DimensionBars dimensions={signal.dimensionsNormalized} />
      </div>

      {/* Reasoning */}
      <div className="mt-4 border-t border-[var(--card-border)] pt-3">
        <p className="text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">
          {signal.reasoning}
        </p>
      </div>

      {/* Trade button */}
      {onProposeTrade && action === "ENTRY" && (
        <button
          type="button"
          onClick={onProposeTrade}
          className="btn-glow mt-auto pt-3 w-full"
        >
          Propose Trade
        </button>
      )}
    </div>
  );
}
