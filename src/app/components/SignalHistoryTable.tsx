"use client";

import { cn } from "@/lib/utils";

export interface SignalHistoryItem {
  id: string;
  patternId: number;
  patternName: string;
  dimension: string;
  confidence: string;
  score: number;
  detectedAt: string;
  snapshot: {
    mcapUsd: number | null;
    priceUsd: number | null;
    priceAt1h: number | null;
    priceAt4h: number | null;
    priceAt24h: number | null;
    outcomeScore: number | null;
  } | null;
}

function computeGain(snap: SignalHistoryItem["snapshot"]): number | null {
  if (!snap?.priceUsd) return null;
  const prices = [snap.priceAt1h, snap.priceAt4h, snap.priceAt24h].filter(
    (p): p is number => p !== null && p > 0,
  );
  if (prices.length === 0) return null;
  const best = Math.max(...prices);
  return ((best - snap.priceUsd) / snap.priceUsd) * 100;
}

function fmtMcap(v: number | null): string {
  if (!v) return "\u2014";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${(v / 1_000).toFixed(1)}K`;
}

export function SignalHistoryTable({ signals }: { signals: SignalHistoryItem[] }) {
  if (signals.length === 0) {
    return (
      <div className="ave-card flex items-center justify-center !p-5">
        <span className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          No signal history
        </span>
      </div>
    );
  }

  return (
    <div className="ave-card !p-4">
      <h3 className="section-header mb-3">Signal History</h3>

      {/* Header row */}
      <div className="mb-2 flex items-center gap-2 text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
        <span className="flex-1">Signal</span>
        <span className="w-16 text-center">MCap</span>
        <span className="w-10 text-center">Score</span>
        <span className="w-14 text-right">Outcome</span>
      </div>

      <div className="max-h-[400px] space-y-1.5 overflow-y-auto">
        {signals.map((sig) => {
          const dt = new Date(sig.detectedAt);
          const time = dt.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const date = dt.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          });
          const gain = computeGain(sig.snapshot);
          const isEntry = [1, 7, 11].includes(sig.patternId);
          const confColor =
            sig.confidence === "HIGH"
              ? "text-emerald-400"
              : sig.confidence === "MED"
                ? "text-yellow-400"
                : "text-white/50";

          return (
            <div
              key={sig.id}
              className="data-row flex items-center gap-2 border-b border-white/[0.04] px-1 py-1.5 last:border-0"
            >
              {/* Signal info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      isEntry ? "bg-[var(--ave-accent)]" : "bg-red-400",
                    )}
                  />
                  <span className="truncate text-[11px] font-medium text-white/90">
                    {sig.patternName}
                  </span>
                  <span className={cn("text-[9px] font-mono", confColor)}>
                    {sig.confidence}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[color:var(--muted-foreground)]">
                  {date} {time}
                </div>
              </div>

              {/* MCap */}
              <span className="w-16 text-center font-mono text-[10px] text-white/60">
                {fmtMcap(sig.snapshot?.mcapUsd ?? null)}
              </span>

              {/* Score */}
              <span className="w-10 text-center font-mono text-[11px] text-white/80">
                {sig.score}
              </span>

              {/* Outcome */}
              <span
                className={cn(
                  "w-14 text-right font-mono text-[10px]",
                  gain === null
                    ? "text-white/30"
                    : gain >= 0
                      ? "text-emerald-400"
                      : "text-red-400",
                )}
              >
                {gain !== null ? `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}%` : "\u2014"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
