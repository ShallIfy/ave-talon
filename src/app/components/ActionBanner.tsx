"use client";

// ActionBanner — full-width alert showing the top actionable signal.
// Polls /api/agent/live-signals and picks the highest-scoring ENTRY or EXIT.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { resolveLogo } from "@/lib/utils/token-logo";

interface LiveSignalRow {
  mint: string;
  symbol: string | null;
  score: number;
  action: string;
  reasoning: string;
  priceUsd: number;
  mcapUsd: number;
  detectedAt: number;
  logoUrl: string | null;
}

interface LiveSignalsPage {
  signals: LiveSignalRow[];
  orchestratorRunning: boolean;
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
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const STYLES: Record<string, { border: string; badge: string; bg: string }> = {
  ENTRY: {
    border: "border-l-[var(--ave-accent-bright)]",
    badge: "bg-[rgba(20,241,149,0.15)] text-[var(--ave-accent-bright)] border-[rgba(20,241,149,0.3)]",
    bg: "bg-[rgba(20,241,149,0.03)]",
  },
  EXIT: {
    border: "border-l-red-400",
    badge: "bg-[rgba(248,113,113,0.15)] text-red-400 border-red-400/30",
    bg: "bg-[rgba(248,113,113,0.03)]",
  },
  DANGER: {
    border: "border-l-red-500",
    badge: "bg-[rgba(239,68,68,0.15)] text-red-500 border-red-500/30",
    bg: "bg-[rgba(239,68,68,0.03)]",
  },
};

export function ActionBanner() {
  const [top, setTop] = useState<LiveSignalRow | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/live-signals?limit=100&offset=0", {
        cache: "no-store",
      });
      const data = (await res.json()) as LiveSignalsPage;
      setRunning(Boolean(data.orchestratorRunning));
      const actionable = (data.signals ?? [])
        .filter(
          (s) =>
            s.action === "ENTRY" || s.action === "EXIT" || s.action === "DANGER",
        )
        .sort((a, b) => b.score - a.score);
      setTop(actionable[0] ?? null);
    } catch {
      // keep last state
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => clearInterval(id);
  }, [load]);

  if (!top) {
    return (
      <div className="ave-card-premium flex items-center gap-3 border-l-2 border-l-white/10 !px-5 !py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/40">
          {running
            ? "Scanning... No strong signals detected — market is flat"
            : "Scanner offline — waiting for next cycle"}
        </span>
      </div>
    );
  }

  const style = STYLES[top.action] ?? STYLES.ENTRY;
  const symbol = top.symbol ?? top.mint.slice(0, 6);
  const logo = resolveLogo(top.logoUrl);
  const price = formatPrice(top.priceUsd);
  const mcap = formatMcap(top.mcapUsd);

  return (
    <Link href={`/token/${top.mint}`}>
      <div
        className={cn(
          "ave-card-premium flex items-center gap-4 border-l-[3px] !px-5 !py-3 transition-colors hover:bg-white/[0.02]",
          style.border,
          style.bg,
        )}
      >
        {/* Action badge */}
        <span
          className={cn(
            "shrink-0 border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em]",
            style.badge,
          )}
        >
          {top.action}
        </span>

        {/* Logo + symbol */}
        <div className="flex items-center gap-2 min-w-0">
          {logo ? (
            <img
              src={logo}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 rounded-full border border-[color:var(--card-border)]"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] bg-[rgba(124,58,237,0.15)] font-mono text-[8px] font-medium text-white/60">
              {symbol.slice(0, 2)}
            </div>
          )}
          <span className="font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-white">
            {symbol}
          </span>
        </div>

        {/* Reasoning */}
        <p className="hidden min-w-0 flex-1 truncate font-mono text-[10px] tracking-[0.04em] text-white/60 sm:block">
          {top.reasoning}
        </p>

        {/* Score */}
        <div className="shrink-0 text-right">
          <div className="font-mono text-[16px] font-medium leading-none text-[var(--ave-accent-bright)]">
            {Math.round(top.score)}
          </div>
          <div className="mt-0.5 font-mono text-[7px] uppercase tracking-[0.12em] text-white/30">
            score
          </div>
        </div>

        {/* Price / mcap */}
        {(price || mcap) && (
          <div className="hidden shrink-0 text-right sm:block">
            {price && (
              <div className="font-mono text-[10px] text-white/70">{price}</div>
            )}
            {mcap && (
              <div className="font-mono text-[9px] text-white/35">{mcap}</div>
            )}
          </div>
        )}

        {/* Time */}
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">
          {relativeTime(top.detectedAt)}
        </span>
      </div>
    </Link>
  );
}
