"use client";

// Ranked momentum feed — reads live from the orchestrator's in-memory cycle
// history via /api/agent/live-signals (zero DB round-trips).
//
// Fixed-height scrollable list. Fetches all signals at once (server caps at
// 100 deduped per mint). Polls every 4s. No pagination — just scroll.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveLogo } from "@/lib/utils/token-logo";

interface LiveSignalRow {
  mint: string;
  symbol: string | null;
  patternId: number;
  patternName: string;
  confidence: string;
  score: number;
  dedup: boolean;
  detectedAt: number;
  dimension: string;
  dimensionsNormalized: {
    holderGrowth: number;
    top10Concentration: number;
    realMoney: number;
    volume: number;
    price: number;
  };
  discoverySource: string;
  cycleId: string;
  logoUrl: string | null;
  action: string;
  reasoning: string;
  priceUsd: number;
  mcapUsd: number;
}

interface LiveSignalsPage {
  signals: LiveSignalRow[];
  total: number;
  lastCycleAt: number;
  orchestratorRunning: boolean;
}

const ACTION_BADGE: Record<string, { text: string; cls: string }> = {
  ENTRY:     { text: "ENTRY",   cls: "bg-[rgba(20,241,149,0.12)] text-[var(--ave-accent-bright)] border-[rgba(20,241,149,0.3)]" },
  EXIT:      { text: "EXIT",    cls: "bg-[rgba(248,113,113,0.12)] text-red-400 border-red-400/30" },
  WAIT:      { text: "WAIT",    cls: "bg-[rgba(255,255,255,0.04)] text-white/40 border-white/15" },
  CAUTION:   { text: "CAUTION", cls: "bg-[rgba(250,204,21,0.1)] text-yellow-400/80 border-yellow-400/25" },
  DANGER:    { text: "DANGER",  cls: "bg-[rgba(239,68,68,0.12)] text-red-500 border-red-500/30" },
  NO_SIGNAL: { text: "—",       cls: "bg-transparent text-white/20 border-white/10" },
};

const DIM_META: Record<string, { label: string; tip: string }> = {
  holderGrowth:       { label: "HLD", tip: "Holder growth (green = rising)" },
  top10Concentration: { label: "WHL", tip: "Whale distribution (green = distributing)" },
  realMoney:          { label: "R$",  tip: "Real money >$10 (green = inflow)" },
  volume:             { label: "VOL", tip: "Volume vs average" },
  price:              { label: "PX",  tip: "Price change" },
};

function scoreLabel(score: number): string {
  if (score >= 85) return "VERY STRONG";
  if (score >= 70) return "STRONG";
  if (score >= 55) return "MODERATE";
  if (score >= 35) return "WEAK";
  return "—";
}

function formatMcap(v: number): string {
  if (!v || v <= 0) return "";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPrice(v: number): string {
  if (!v || v <= 0) return "";
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  if (v < 1) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(2)}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function DimBar({ value, tooltip }: { value: number; tooltip: string }) {
  const mag = Math.min(1, Math.abs(value));
  const up = value >= 0;
  const width = `${Math.max(8, mag * 100)}%`;
  return (
    <div
      className="relative h-[4px] w-full overflow-hidden bg-white/5"
      title={tooltip}
    >
      <div
        className={cn(
          "absolute top-0 h-full",
          up ? "bg-[var(--ave-accent)]" : "bg-red-400/70",
        )}
        style={{ width, left: up ? 0 : "auto", right: up ? "auto" : 0 }}
      />
    </div>
  );
}

export function MomentumFeed({
  className,
  pollMs = 4_000,
}: {
  className?: string;
  pollMs?: number;
}) {
  const [rows, setRows] = useState<LiveSignalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [lastCycleAt, setLastCycleAt] = useState(0);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent: boolean) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch(
        "/api/agent/live-signals?limit=100&offset=0",
        { cache: "no-store" },
      );
      const data = (await res.json()) as LiveSignalsPage;
      setRows(data.signals ?? []);
      setTotal(data.total ?? 0);
      setLastCycleAt(data.lastCycleAt ?? 0);
      setRunning(Boolean(data.orchestratorRunning));
    } catch {
      // keep last snapshot on screen
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    void load(false);
    const id = setInterval(() => {
      if (!cancel) void load(true);
    }, pollMs);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [load, pollMs]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="flex items-baseline justify-between border-b border-[var(--card-border)] pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/90">
            Momentum Feed
          </h2>
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              running
                ? "bg-[var(--ave-accent-bright)] shadow-[0_0_6px_rgba(20,241,149,0.7)] animate-pulse"
                : "bg-white/20",
            )}
            title={running ? "orchestrator running · live" : "idle"}
          />
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {rows.length}/{total} tokens
          {lastCycleAt > 0 && (
            <> · last cycle {relativeTime(lastCycleAt)} ago</>
          )}
        </span>
      </div>

      {/* Body */}
      {loading && rows.length === 0 ? (
        <div className="mt-3 space-y-[1px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-[54px] w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center border border-[var(--card-border)] mt-3 px-4 py-10 text-center font-mono text-[11px] tracking-[0.06em] text-[color:var(--muted-foreground)]">
          {running
            ? "Scanning... No signals detected yet."
            : "Scanner offline. Waiting for next cycle."}
        </div>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 divide-y divide-[var(--card-border)] overflow-y-auto border border-[var(--card-border)]">
          {rows.map((r, i) => {
            const symbol = r.symbol ?? r.mint.slice(0, 4);
            const logo = resolveLogo(r.logoUrl);
            const d = r.dimensionsNormalized;
            const dims: [string, number][] = [
              ["holderGrowth", d?.holderGrowth ?? 0],
              ["top10Concentration", d?.top10Concentration ?? 0],
              ["realMoney", d?.realMoney ?? 0],
              ["volume", d?.volume ?? 0],
              ["price", d?.price ?? 0],
            ];
            const badge = ACTION_BADGE[r.action] ?? ACTION_BADGE.WAIT;
            const sLabel = scoreLabel(r.score);
            const price = formatPrice(r.priceUsd);
            const mcap = formatMcap(r.mcapUsd);
            return (
              <li
                key={r.mint}
                className={i === 0 ? "bg-[rgba(124,58,237,0.04)]" : ""}
              >
                <Link
                  href={`/token/${r.mint}`}
                  className="grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,0.8fr)_64px_40px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.015]"
                >
                  {/* logo */}
                  {logo ? (
                    <img
                      src={logo}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 shrink-0 rounded-full border border-[color:var(--card-border)]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] bg-[rgba(124,58,237,0.15)] font-mono text-[9px] font-medium text-white/60">
                      {symbol.slice(0, 2)}
                    </div>
                  )}

                  {/* symbol + action badge + reasoning */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "shrink-0 border px-1 py-px font-mono text-[7px] font-medium uppercase tracking-[0.06em]",
                          badge.cls,
                        )}
                      >
                        {r.patternName || badge.text}
                      </span>
                      <span className="truncate font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-white">
                        {symbol}
                      </span>
                      {price && (
                        <span className="hidden font-mono text-[9px] text-white/35 sm:inline">
                          {price}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[9px] tracking-[0.04em] text-white/45">
                      {r.reasoning ||
                        `${r.patternName} · ${r.dimension.replace(/_/g, " ")}`}
                    </div>
                  </div>

                  {/* dim bars */}
                  <div className="hidden min-w-0 flex-col gap-[3px] sm:flex">
                    {dims.map(([key, val]) => {
                      const meta = DIM_META[key] ?? { label: key, tip: key };
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-1.5"
                        >
                          <span className="font-mono text-[7px] uppercase tracking-[0.08em] text-white/25">
                            {meta.label}
                          </span>
                          <DimBar
                            value={val}
                            tooltip={`${meta.tip}: ${val >= 0 ? "+" : ""}${(val * 100).toFixed(0)}%`}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* score + label + mcap */}
                  <div className="text-right">
                    <div
                      className={cn(
                        "font-mono text-[14px] font-medium leading-none",
                        r.score >= 85
                          ? "text-[var(--ave-accent-bright)]"
                          : r.score >= 70
                            ? "text-[var(--ave-accent)]"
                            : r.score >= 55
                              ? "text-yellow-400/80"
                              : r.score >= 35
                                ? "text-white/50"
                                : "text-white/25",
                      )}
                    >
                      {Math.round(r.score)}
                    </div>
                    <div className="mt-0.5 font-mono text-[7px] uppercase tracking-[0.1em] text-white/30">
                      {sLabel}
                    </div>
                    {mcap && (
                      <div className="mt-0.5 font-mono text-[8px] text-white/25">
                        {mcap}
                      </div>
                    )}
                  </div>

                  {/* time */}
                  <div className="text-right font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">
                    {relativeTime(r.detectedAt)}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
