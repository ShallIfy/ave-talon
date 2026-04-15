"use client";

// Signal feed — table-style with confidence gauge, MCap, outcome tracking.
// Pulls from /api/signals with auto-polling.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveLogo } from "@/lib/utils/token-logo";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SignalSnapshot {
  mcapUsd: number | null;
  priceUsd: number | null;
  priceAt1h: number | null;
  priceAt4h: number | null;
  priceAt24h: number | null;
  outcomeScore: number | null;
}

interface SignalRow {
  id: string;
  tokenMint: string;
  patternId: number;
  patternName: string;
  dimension: string;
  confidence: string;
  score: number;
  detectedAt: string;
  token?: {
    symbol: string | null;
    name: string | null;
    logoUrl: string | null;
    riskScore: number | null;
  } | null;
  snapshot?: SignalSnapshot | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const ACTION_MAP: Record<number, { label: string; color: string; bg: string }> = {
  1:  { label: "ENTRY",   color: "text-emerald-400", bg: "bg-emerald-400" },
  7:  { label: "ENTRY",   color: "text-emerald-400", bg: "bg-emerald-400" },
  11: { label: "ENTRY",   color: "text-emerald-400", bg: "bg-emerald-400" },
  3:  { label: "CAUTION", color: "text-yellow-400",  bg: "bg-yellow-400" },
  10: { label: "CAUTION", color: "text-yellow-400",  bg: "bg-yellow-400" },
  4:  { label: "WAIT",    color: "text-white/40",    bg: "bg-white/40" },
  2:  { label: "WAIT",    color: "text-white/40",    bg: "bg-white/40" },
  8:  { label: "WAIT",    color: "text-white/40",    bg: "bg-white/40" },
  5:  { label: "EXIT",    color: "text-red-400",     bg: "bg-red-400" },
  6:  { label: "DANGER",  color: "text-red-500",     bg: "bg-red-500" },
  9:  { label: "NONE",    color: "text-white/20",    bg: "bg-white/20" },
};

const CONF_STYLE: Record<string, { color: string; track: string }> = {
  HIGH:   { color: "text-emerald-400", track: "bg-emerald-400" },
  MED:    { color: "text-yellow-400",  track: "bg-yellow-400" },
  MEDIUM: { color: "text-yellow-400",  track: "bg-yellow-400" },
  LOW:    { color: "text-white/40",    track: "bg-white/30" },
  NONE:   { color: "text-white/20",    track: "bg-white/10" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtMcap(v: number | null): string {
  if (!v || !Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function bestOutcome(snap: SignalSnapshot | null | undefined): number | null {
  if (!snap?.priceUsd) return null;
  const prices = [snap.priceAt1h, snap.priceAt4h, snap.priceAt24h].filter(
    (p): p is number => p !== null && p > 0,
  );
  if (prices.length === 0) return null;
  const best = Math.max(...prices);
  return ((best - snap.priceUsd) / snap.priceUsd) * 100;
}

/* ------------------------------------------------------------------ */
/*  Summary strip                                                      */
/* ------------------------------------------------------------------ */

function SummaryStrip({ rows }: { rows: SignalRow[] }) {
  const stats = useMemo(() => {
    const total = rows.length;
    const high = rows.filter((r) => r.confidence === "HIGH").length;
    const med = rows.filter((r) => r.confidence === "MED" || r.confidence === "MEDIUM").length;
    const entries = rows.filter((r) => [1, 7, 11].includes(r.patternId)).length;
    const dangers = rows.filter((r) => [5, 6].includes(r.patternId)).length;
    const avgScore = total > 0 ? Math.round(rows.reduce((a, r) => a + r.score, 0) / total) : 0;
    return { total, high, med, entries, dangers, avgScore };
  }, [rows]);

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {[
        { label: "Total", value: String(stats.total), color: "text-white" },
        { label: "High Conf", value: String(stats.high), color: "text-emerald-400" },
        { label: "Medium", value: String(stats.med), color: "text-yellow-400" },
        { label: "Entries", value: String(stats.entries), color: "text-emerald-400" },
        { label: "Exit/Danger", value: String(stats.dangers), color: "text-red-400" },
        { label: "Avg Score", value: String(stats.avgScore), color: "text-[var(--ave-accent-bright)]" },
      ].map((s) => (
        <div key={s.label} className="border border-[var(--card-border)] bg-white/[0.01] px-3 py-2">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/25">
            {s.label}
          </div>
          <div className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", s.color)}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Score bar                                                          */
/* ------------------------------------------------------------------ */

function ScoreBar({ score, confidence }: { score: number; confidence: string }) {
  const style = CONF_STYLE[confidence] ?? CONF_STYLE.NONE;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-[3px] w-10 bg-white/[0.06]">
        <div
          className={cn("h-full transition-all duration-500", style.track)}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className={cn("font-mono text-[10px] font-bold tabular-nums", style.color)}>
        {score}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function SignalFeed({
  limit = 20,
  minConfidence,
  className,
  pollMs = 20_000,
}: {
  limit?: number;
  minConfidence?: "LOW" | "MED" | "HIGH";
  className?: string;
  pollMs?: number;
}) {
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (minConfidence) qs.set("minConfidence", minConfidence);
        const res = await fetch(`/api/signals?${qs}`);
        const data = await res.json();
        if (!cancel) {
          setRows(data.signals ?? []);
          setLastRefresh(Date.now());
        }
      } catch {
        // ignore
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, pollMs);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [limit, minConfidence, pollMs]);

  if (loading && rows.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn("ave-card flex flex-col items-center justify-center py-16", className)}>
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/20">
          No signals detected
        </div>
        <div className="mt-1 font-mono text-[9px] text-white/10">
          Signals appear when the orchestrator detects patterns
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary */}
      <SummaryStrip rows={rows} />

      {/* Table */}
      <div className="ave-card overflow-hidden !p-0">
        {/* Column headers */}
        <div className="flex items-center gap-3 border-b border-[var(--card-border)] bg-white/[0.015] px-4 py-2">
          <div className="w-8 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20">#</div>
          <div className="min-w-0 flex-1 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20">Token</div>
          <div className="hidden w-24 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20 sm:block">Action</div>
          <div className="hidden w-36 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20 md:block">Pattern</div>
          <div className="w-20 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20 text-right">Score</div>
          <div className="hidden w-20 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20 text-right lg:block">MCap</div>
          <div className="hidden w-20 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20 text-right lg:block">Outcome</div>
          <div className="w-12 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20 text-right">Time</div>
        </div>

        {/* Signal rows */}
        <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
          {rows.map((r, i) => {
            const action = ACTION_MAP[r.patternId] ?? ACTION_MAP[9];
            const outcome = bestOutcome(r.snapshot);
            const logo = resolveLogo(r.token?.logoUrl);

            return (
              <Link
                key={r.id}
                href={`/token/${r.tokenMint}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[rgba(124,58,237,0.04)]",
                  i < rows.length - 1 && "border-b border-white/[0.03]",
                  "animate-in",
                  i < 8 && `stagger-${Math.min(i + 1, 5)}`,
                )}
              >
                {/* Row number */}
                <div className="w-8 font-mono text-[10px] tabular-nums text-white/15">
                  {(i + 1).toString().padStart(2, "0")}
                </div>

                {/* Token identity */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {logo ? (
                    <img
                      src={logo}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 shrink-0 rounded-full border border-white/[0.06]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-[rgba(124,58,237,0.12)] font-mono text-[9px] font-bold text-white/40">
                      {(r.token?.symbol ?? r.tokenMint.slice(0, 2)).slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] font-semibold text-white">
                        {r.token?.symbol ?? r.tokenMint.slice(0, 6)}
                      </span>
                      {r.token?.name && (
                        <span className="hidden truncate font-mono text-[9px] text-white/20 xl:inline">
                          {r.token.name}
                        </span>
                      )}
                    </div>
                    {/* Dimension — mobile only */}
                    <div className="mt-0.5 truncate font-mono text-[9px] text-white/20 sm:hidden">
                      {r.dimension.replace(/_/g, " ")}
                    </div>
                  </div>
                </div>

                {/* Action badge */}
                <div className="hidden w-24 sm:block">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", action.bg)} />
                    <span className={cn("font-mono text-[9px] font-bold uppercase tracking-[0.1em]", action.color)}>
                      {action.label}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[8px] text-white/15">
                    {r.confidence}
                  </div>
                </div>

                {/* Pattern */}
                <div className="hidden w-36 md:block">
                  <div className="truncate font-mono text-[10px] text-white/60">
                    #{r.patternId} {r.patternName}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[8px] text-white/15">
                    {r.dimension.replace(/_/g, " ")}
                  </div>
                </div>

                {/* Score */}
                <div className="w-20 text-right">
                  <ScoreBar score={r.score} confidence={r.confidence} />
                </div>

                {/* MCap */}
                <div className="hidden w-20 text-right lg:block">
                  <span className="font-mono text-[10px] tabular-nums text-white/40">
                    {fmtMcap(r.snapshot?.mcapUsd ?? null)}
                  </span>
                </div>

                {/* Outcome */}
                <div className="hidden w-20 text-right lg:block">
                  {outcome !== null ? (
                    <span
                      className={cn(
                        "font-mono text-[10px] font-semibold tabular-nums",
                        outcome >= 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {outcome >= 0 ? "+" : ""}{outcome.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-white/15">—</span>
                  )}
                </div>

                {/* Time */}
                <div className="w-12 text-right">
                  <span className="font-mono text-[10px] tabular-nums text-white/25">
                    {relativeTime(r.detectedAt)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--card-border)] bg-white/[0.01] px-4 py-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-white/15">
            {rows.length} signals
          </span>
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ave-accent)] opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--ave-accent-bright)]" />
            </span>
            <span className="font-mono text-[8px] text-white/15">
              auto-refresh {pollMs / 1000}s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
