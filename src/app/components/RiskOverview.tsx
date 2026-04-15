"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WalletInfo {
  address: string;
  balanceUsd: number | null;
  pnl: number | null;
  sol: number | null;
}

interface CategoryResult {
  rate: number | null;
  count: number;
  wallets: WalletInfo[];
}

interface RiskData {
  categories: Record<string, CategoryResult>;
  dev: { address: string | null };
  migrated: boolean;
  totalAnalyzed: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CATEGORIES: Array<{
  key: string;
  label: string;
  desc: string;
  icon: string;
}> = [
  { key: "insider", label: "Insider", desc: "Mouse warehouse wallets", icon: "I" },
  { key: "phishing", label: "Phishing", desc: "Flagged scam addresses", icon: "P" },
  { key: "cabal", label: "Cabal", desc: "Coordinated group wallets", icon: "C" },
  { key: "bundle", label: "Bundle", desc: "Bundled transactions", icon: "B" },
];

function riskLevel(rate: number | null): {
  label: string;
  color: string;
  bg: string;
  barColor: string;
} {
  if (rate === null)
    return { label: "N/A", color: "text-white/30", bg: "bg-white/5", barColor: "bg-white/10" };
  // rate from Ave API is already a percentage (e.g. 7.8 = 7.8%)
  const pct = rate;
  if (pct > 50)
    return { label: "HIGH", color: "text-red-400", bg: "bg-red-400/8", barColor: "bg-red-400" };
  if (pct > 20)
    return { label: "MED", color: "text-yellow-400", bg: "bg-yellow-400/8", barColor: "bg-yellow-400" };
  return { label: "LOW", color: "text-[color:var(--ave-teal)]", bg: "bg-[var(--ave-teal)]/8", barColor: "bg-[var(--ave-teal)]" };
}

function fmtPct(rate: number | null): string {
  if (rate === null) return "—";
  // rate is already a percentage from Ave API
  return `${rate.toFixed(1)}%`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}


/* ------------------------------------------------------------------ */
/*  Category card                                                      */
/* ------------------------------------------------------------------ */

function CategoryCard({
  cfg,
  cat,
  expanded,
  onToggle,
}: {
  cfg: (typeof CATEGORIES)[number];
  cat: CategoryResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const level = riskLevel(cat.rate);
  const hasWallets = cat.count > 0;
  const barWidth = cat.rate !== null ? Math.min(cat.rate, 100) : 0;

  return (
    <div
      className={cn(
        "border border-[var(--card-border)] transition-colors",
        expanded && "border-[rgba(124,58,237,0.3)]",
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={hasWallets ? onToggle : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 transition-colors",
          hasWallets ? "cursor-pointer hover:bg-white/[0.02]" : "cursor-default",
        )}
      >
        {/* Icon */}
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center border font-mono text-[10px] font-bold",
            level.bg,
            level.color,
            "border-current/20",
          )}
        >
          {cfg.icon}
        </div>

        {/* Info */}
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-white/90">{cfg.label}</span>
            {hasWallets && (
              <span className="font-mono text-[9px] text-[color:var(--muted-foreground)]">
                {expanded ? "\u25B4" : "\u25BE"} {cat.count} wallet{cat.count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div className="mt-1 flex items-center gap-2">
            <div className="h-[3px] flex-1 bg-white/[0.04]">
              <div
                className={cn("h-full transition-all duration-500", level.barColor)}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className={cn("font-mono text-[10px] tabular-nums", level.color)}>
              {fmtPct(cat.rate)}
            </span>
          </div>
        </div>

        {/* Badge */}
        <span
          className={cn(
            "shrink-0 border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest",
            level.color,
            level.bg,
            "border-current/20",
          )}
        >
          {level.label}
        </span>
      </button>

      {/* Expanded wallet list */}
      {expanded && cat.wallets.length > 0 && (
        <div className="border-t border-[var(--card-border)] bg-[rgba(124,58,237,0.02)]">
          <div className="px-3 py-1.5">
            <div className="flex items-center gap-3 text-[8px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
              <span className="flex-1">Address</span>
              <span className="w-16 text-right">Balance</span>
              <span className="w-14 text-right">PnL</span>
              <span className="w-12 text-right">SOL</span>
            </div>
          </div>
          {cat.wallets.map((w, i) => (
            <div
              key={w.address}
              className={cn(
                "flex items-center gap-3 px-3 py-1.5 text-[10px] transition-colors hover:bg-white/[0.02]",
                i < cat.wallets.length - 1 && "border-b border-[rgba(255,255,255,0.02)]",
              )}
            >
              <a
                href={`https://solscan.io/account/${w.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 font-mono text-[var(--ave-accent-bright)] transition-colors hover:text-white"
              >
                {truncAddr(w.address)}
              </a>
              <span className="w-16 text-right font-mono text-white/50">
                {fmtUsd(w.balanceUsd)}
              </span>
              <span
                className={cn(
                  "w-14 text-right font-mono tabular-nums",
                  w.pnl !== null && Number.isFinite(w.pnl)
                    ? w.pnl >= 0
                      ? "text-[color:var(--ave-teal)]"
                      : "text-red-400"
                    : "text-white/30",
                )}
              >
                {w.pnl !== null && Number.isFinite(w.pnl)
                  ? `${w.pnl >= 0 ? "+" : ""}${w.pnl.toFixed(1)}%`
                  : "—"}
              </span>
              <span className="w-12 text-right font-mono text-white/40">
                {w.sol !== null && Number.isFinite(w.sol) ? w.sol.toFixed(3) : "—"}
              </span>
            </div>
          ))}
          {cat.count > cat.wallets.length && (
            <div className="border-t border-[rgba(255,255,255,0.02)] px-3 py-1.5 text-[9px] text-[color:var(--muted-foreground)]">
              +{cat.count - cat.wallets.length} more wallets
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export function RiskOverview({ mint }: { mint: string }) {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/token/${encodeURIComponent(mint)}/risk`);
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(cat: string) {
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  if (loading) {
    return (
      <div className="ave-card flex h-full flex-col !p-4">
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Risk Overview
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ave-card flex h-full flex-col items-center justify-center !p-4">
        <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Risk data unavailable
        </div>
      </div>
    );
  }

  return (
    <div className="ave-card flex h-full flex-col !p-4">
      {/* Header */}
      <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        Risk Breakdown
      </div>

      {/* Category cards — scrollable, fixed card height */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-1.5">
          {CATEGORIES.map((cfg) => {
            const cat = data.categories[cfg.key];
            if (!cat) return null;
            return (
              <CategoryCard
                key={cfg.key}
                cfg={cfg}
                cat={cat}
                expanded={!!expanded[cfg.key]}
                onToggle={() => toggle(cfg.key)}
              />
            );
          })}
        </div>
      </div>

      {/* Footer: Dev + Migrated */}
      <div className="mt-3 flex items-center gap-3 border-t border-[var(--card-border)] pt-3 text-[10px]">
        {data.dev.address ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[color:var(--muted-foreground)]">Dev</span>
            <a
              href={`https://solscan.io/account/${data.dev.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[var(--ave-accent-bright)] transition-colors hover:text-white"
            >
              {truncAddr(data.dev.address)}
            </a>
          </div>
        ) : (
          <span className="text-[color:var(--muted-foreground)]">Dev unknown</span>
        )}
        <span className="text-white/10">|</span>
        <span className="text-[color:var(--muted-foreground)]">
          {data.migrated ? "Migrated" : "Not migrated"}
        </span>
      </div>
    </div>
  );
}
