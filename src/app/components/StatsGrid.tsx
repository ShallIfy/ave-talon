"use client";

import { useState } from "react";
import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { SignalHistoryItem } from "./SignalHistoryTable";
import { cn } from "@/lib/utils";
import { HolderDeltaChart } from "./HolderDeltaChart";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "\u2014";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(digits)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(digits)}K`;
  return n.toFixed(digits);
}

/** Tiny SVG sparkline — no labels, just the line + fill. */
function MiniSparkline({
  data,
  width = 120,
  height = 28,
  invert = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  /** If true, "down" is the good direction (e.g. top10 concentration decreasing). */
  invert?: boolean;
}) {
  const pts = data.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const step = width / (pts.length - 1);
  const toY = (v: number) => height - ((v - min) / range) * (height - 4) - 2;

  let line = "";
  pts.forEach((v, i) => {
    const x = i * step;
    const y = toY(v);
    line += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const trend = pts[pts.length - 1] - pts[0];
  const isUp = invert ? trend <= 0 : trend >= 0;
  const stroke = isUp ? "#a777c2" : "#ef4444";
  const fill = isUp ? "rgba(124,58,237,0.15)" : "rgba(239,68,68,0.15)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={area} fill={fill} />
      <path d={line} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function StatsGrid({
  snapshot,
  signals = [],
}: {
  snapshot: AveSnapshot;
  signals?: SignalHistoryItem[];
}) {
  const d = snapshot.holderDelta;
  const mcap =
    snapshot.totalSupply && snapshot.latestPriceUsd
      ? snapshot.totalSupply * snapshot.latestPriceUsd
      : null;

  // PNL: entry → now vs entry → ATH
  const firstEntry = signals
    .filter((s) => s.patternId !== 9 && s.snapshot?.priceUsd)
    .at(-1); // oldest = last in desc-sorted array
  const entryPrice = firstEntry?.snapshot?.priceUsd ?? null;
  const entryMcap = firstEntry?.snapshot?.mcapUsd ?? null;
  const currentPrice = snapshot.latestPriceUsd;
  const athMcap =
    (snapshot.risk?.rawDev?.all_time_high as number | undefined) ?? null;
  // Derive ATH price from ATH mcap + total supply
  const athPrice =
    athMcap && snapshot.totalSupply ? athMcap / snapshot.totalSupply : null;

  const pnlNow =
    entryPrice && currentPrice
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : null;
  const pnlAth =
    entryPrice && athPrice
      ? ((athPrice - entryPrice) / entryPrice) * 100
      : null;

  const [pnlMode, setPnlMode] = useState<"holding" | "ath">("ath");

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* Holders */}
      <div className="stat-card">
        <div className="stat-label">Holders</div>
        <div className="mt-1 font-mono text-lg font-semibold text-white tabular-nums">
          {fmt(snapshot.holderSeries.at(-1)?.holders_count ?? null, 0)}
        </div>
        <div className="mt-1">
          <HolderDeltaChart series={snapshot.holderSeries} width={120} height={28} />
        </div>
      </div>

      {/* Growth */}
      <div className="stat-card">
        <div className="stat-label">Growth</div>
        <div
          className={cn(
            "mt-1 font-mono text-lg font-semibold tabular-nums",
            d && d.holderGrowthPct >= 0 ? "text-emerald-400" : "text-red-400",
          )}
        >
          {d ? `${d.holderGrowthPct >= 0 ? "+" : ""}${d.holderGrowthPct.toFixed(1)}%` : "\u2014"}
        </div>
        <div className="mt-0.5 text-[10px] text-[color:var(--muted-foreground)]">
          {d ? `${d.holdersCountEnd - d.holdersCountStart >= 0 ? "+" : ""}${d.holdersCountEnd - d.holdersCountStart} holders` : ""}
        </div>
      </div>

      {/* Top10 */}
      <div className="stat-card">
        <div className="stat-label">Top 10</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono text-lg font-semibold text-white tabular-nums">
            {snapshot.holderSeries.at(-1)?.top10_ratio?.toFixed(1) ?? "\u2014"}%
          </span>
          {d && (
            <span
              className={cn(
                "font-mono text-[10px] tabular-nums",
                d.top10RatioDelta <= 0 ? "text-emerald-400" : "text-red-400",
              )}
            >
              {d.top10RatioDelta <= 0 ? "" : "+"}{d.top10RatioDelta.toFixed(2)}pp
            </span>
          )}
        </div>
        <div className="mt-1">
          <MiniSparkline
            data={snapshot.holderSeries.map((p) => p.top10_ratio ?? 0)}
            invert
          />
        </div>
      </div>

      {/* >$10 Holders */}
      <div className="stat-card">
        <div className="stat-label">&gt;$10 Wallets</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono text-lg font-semibold text-white tabular-nums">
            {d ? fmt(d.holdersAbove10End, 0) : "\u2014"}
          </span>
          {d && (
            <span
              className={cn(
                "font-mono text-[10px] tabular-nums",
                d.holdersAbove10Delta >= 0 ? "text-emerald-400" : "text-red-400",
              )}
            >
              {d.holdersAbove10Delta >= 0 ? "+" : ""}{d.holdersAbove10Delta}
            </span>
          )}
        </div>
        <div className="mt-1">
          <MiniSparkline
            data={snapshot.holderSeries.map((p) => p.HoldersAbove10Usd ?? 0)}
          />
        </div>
      </div>

      {/* MCap */}
      <div className="stat-card">
        <div className="stat-label">Market Cap</div>
        <div className="mt-1 font-mono text-lg font-semibold text-white tabular-nums">
          ${fmt(mcap)}
        </div>
        <div className="mt-0.5 text-[10px] text-[color:var(--muted-foreground)]">
          supply {fmt(snapshot.totalSupply, 1)}
        </div>
      </div>

      {/* PNL — premium card with mode toggle */}
      {(() => {
        const pnl = pnlMode === "holding" ? pnlNow : pnlAth;
        const targetMcap = pnlMode === "holding" ? mcap : athMcap;
        const pnlColor =
          pnl === null ? "text-white/25" : pnl >= 0 ? "text-emerald-400" : "text-red-400";
        const pnlBg =
          pnl === null ? "" : pnl >= 0 ? "bg-emerald-400/[0.04]" : "bg-red-400/[0.04]";
        const multiplier =
          entryPrice && (pnlMode === "holding" ? currentPrice : athPrice)
            ? (pnlMode === "holding" ? currentPrice : athPrice)! / entryPrice
            : null;

        return (
          <div className={cn("stat-card relative overflow-hidden", pnlBg)}>
            {/* Subtle accent line top */}
            {pnl !== null && (
              <div
                className={cn(
                  "absolute inset-x-0 top-0 h-[2px]",
                  pnl >= 0 ? "bg-emerald-400/40" : "bg-red-400/40",
                )}
              />
            )}

            {/* Header row: label + toggle */}
            <div className="flex items-center justify-between">
              <span className="stat-label">
                {pnlMode === "ath" ? "Peak Profit" : "Unrealized PNL"}
              </span>
              {firstEntry && (
                <div className="flex gap-px rounded-sm bg-white/[0.04] p-px">
                  {(["ath", "holding"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPnlMode(mode)}
                      className={cn(
                        "px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.12em] transition-all",
                        pnlMode === mode
                          ? "bg-[var(--ave-accent)]/25 text-[var(--ave-accent-bright)]"
                          : "text-white/20 hover:text-white/50",
                      )}
                    >
                      {mode === "ath" ? "ATH" : "Hold"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Main PNL value */}
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={cn("font-mono text-lg font-bold tabular-nums leading-none", pnlColor)}>
                {pnl !== null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"}
              </span>
              {multiplier !== null && multiplier >= 1.01 && (
                <span className={cn("font-mono text-[9px] font-semibold tabular-nums", pnlColor)}>
                  {multiplier.toFixed(1)}x
                </span>
              )}
            </div>

            {/* MCap journey */}
            {firstEntry ? (
              <div className="mt-1.5 flex items-center gap-1 font-mono text-[9px] tabular-nums text-white/30">
                <span>${fmt(entryMcap)}</span>
                <span className={cn("text-[8px]", pnlColor)}>→</span>
                <span className="text-white/50">
                  {pnlMode === "ath" ? "ATH " : ""}${fmt(targetMcap)}
                </span>
              </div>
            ) : (
              <div className="mt-1.5 text-[9px] text-white/20">no entry signal</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
