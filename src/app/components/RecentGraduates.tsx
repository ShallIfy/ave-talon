"use client";

// RecentGraduates — dashboard preview of latest pump.fun / moonshot graduates.
// Compact 5-row strip with symbol, mcap, 24h change, risk. Click → /token/[mint].

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveLogo } from "@/lib/utils/token-logo";

interface ScanToken {
  target_token?: string;
  token0_address?: string;
  token1_address?: string;
  token0_symbol?: string;
  token1_symbol?: string;
  token0_name?: string;
  token1_name?: string;
  market_cap?: number;
  price_change?: number;
  volume_u_24h?: number;
  holders?: number;
  risk_score?: number;
  holders_top10_ratio?: number;
  created_at?: string;
  token0_logo_url?: string;
  token1_logo_url?: string;
}

interface Row {
  mint: string;
  symbol: string;
  mcap: number;
  change: number;
  volume: number;
  risk: number;
  logo: string | null;
}

function formatMcap(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

export function RecentGraduates() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const res = await fetch("/api/scan?source=graduated&limit=10");
        const data = await res.json();
        const tokens = (data.tokens ?? []) as ScanToken[];
        const mapped: Row[] = tokens
          .map((t): Row | null => {
            const mint = t.target_token ?? t.token1_address ?? t.token0_address;
            if (!mint) return null;
            // target_token can be either token0 or token1 — pick the matching side
            const isToken0 = mint === t.token0_address;
            const symbol = isToken0
              ? (t.token0_symbol ?? t.token1_symbol ?? mint.slice(0, 4))
              : (t.token1_symbol ?? t.token0_symbol ?? mint.slice(0, 4));
            const logo = isToken0
              ? (t.token0_logo_url ?? t.token1_logo_url)
              : (t.token1_logo_url ?? t.token0_logo_url);
            // Skip if resolved symbol is SOL (wrapped SOL side picked by mistake)
            if (symbol === "SOL" || symbol === "WSOL") return null;
            return {
              mint,
              symbol,
              mcap: t.market_cap ?? 0,
              change: t.price_change ?? 0,
              volume: t.volume_u_24h ?? 0,
              risk: t.risk_score ?? 0,
              logo: resolveLogo(logo),
            };
          })
          .filter((r): r is Row => r !== null)
          .slice(0, 5);
        if (!cancel) setRows(mapped);
      } catch {
        // noop
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="ave-card-premium flex h-full flex-col !p-4">
      <div className="flex items-baseline justify-between border-b border-[var(--card-border)] pb-2">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/90">
          Recent Graduates
        </h2>
        <Link
          href="/scanner"
          className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)] hover:text-[var(--ave-accent-bright)]"
        >
          View All →
        </Link>
      </div>

      {loading && rows.length === 0 ? (
        <div className="mt-2 space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 skeleton" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-6 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          No graduated tokens found
        </div>
      ) : (
        <ul className="mt-1 divide-y divide-[var(--card-border)] border-t border-[var(--card-border)]">
          {rows.map((r) => {
            const up = r.change >= 0;
            return (
              <li key={r.mint}>
                <Link
                  href={`/token/${r.mint}`}
                  className="grid grid-cols-[22px_minmax(0,1fr)_56px_50px_36px_46px] items-center gap-2 px-1 py-2 transition-colors hover:bg-white/[0.015]"
                >
                  {r.logo ? (
                    <img
                      src={r.logo}
                      alt=""
                      width={22}
                      height={22}
                      className="h-[22px] w-[22px] shrink-0 rounded-full border border-[color:var(--card-border)]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] bg-[rgba(124,58,237,0.15)] font-mono text-[8px] font-medium text-white/60">
                      {r.symbol.slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-white">
                      {r.symbol}
                    </div>
                    <div className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-white/25">
                      {r.mint.slice(0, 6)}…{r.mint.slice(-4)}
                    </div>
                  </div>
                  <div className="text-right font-mono text-[11px] text-white/80">
                    ${formatMcap(r.mcap)}
                  </div>
                  <div
                    className={cn(
                      "text-right font-mono text-[10px]",
                      up ? "text-[var(--ave-accent-bright)]" : "text-red-400/80",
                    )}
                  >
                    {up ? "+" : ""}
                    {r.change.toFixed(1)}%
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <span className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      r.risk >= 70 ? "bg-red-400" : r.risk >= 40 ? "bg-yellow-400" : "bg-white/30",
                    )} />
                    <span className={cn(
                      "font-mono text-[9px] tracking-[0.1em]",
                      r.risk >= 70 ? "text-red-400/80" : r.risk >= 40 ? "text-yellow-400/80" : "text-white/30",
                    )}>
                      {r.risk}
                    </span>
                  </div>
                  <div className="text-right">
                    {r.change > 20 ? (
                      <span className="font-mono text-[7px] uppercase tracking-[0.08em] text-[var(--ave-accent-bright)] border border-[rgba(20,241,149,0.3)] px-1 py-0.5">
                        pump
                      </span>
                    ) : r.change < -50 ? (
                      <span className="font-mono text-[7px] uppercase tracking-[0.08em] text-red-400 border border-red-400/30 px-1 py-0.5">
                        dump
                      </span>
                    ) : null}
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
