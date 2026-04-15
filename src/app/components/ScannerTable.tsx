"use client";

// Pump.fun / Moonshot scanner — styled to match SignalFeed.
// Fetches from /api/scan?source=... with auto-refresh, sortable columns, summary strip.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Source = "graduated" | "new";
type SortField = "rank" | "price" | "mcap" | "change" | "vol" | "holders" | "risk";
type SortDir = "asc" | "desc";

interface PumpToken {
  target_token?: string;
  token0_address?: string;
  token1_address?: string;
  token0_symbol?: string;
  token1_symbol?: string;
  token0_name?: string;
  token1_name?: string;
  token0_logo_url?: string;
  token1_logo_url?: string;
  symbol_en?: string;
  name_en?: string;
  market_cap?: number | string;
  current_price_usd?: number | string;
  price_change?: number | string;
  volume_u_24h?: number | string;
  holders?: number | string;
  progress?: number | string;
  risk_score?: number | string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const LOGO_CDN = "https://www.iconaves.com/";

function resolveLogo(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${LOGO_CDN}${raw.replace(/^\/+/, "")}`;
}

function fmt(n: unknown, digits = 1): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(digits)}B`;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(digits)}K`;
  return v.toFixed(digits);
}

function fmtPrice(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  if (v < 1) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

function pct(n: unknown): { label: string; up: boolean } {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return { label: "—", up: true };
  return { label: `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, up: v >= 0 };
}

function resolveToken(tk: PumpToken) {
  const mint = tk.target_token ?? tk.token1_address ?? tk.token0_address ?? "";
  const isToken0 = mint === tk.token0_address;
  const symbol = isToken0
    ? (tk.token0_symbol ?? tk.symbol_en ?? tk.token1_symbol ?? "???")
    : (tk.token1_symbol ?? tk.symbol_en ?? tk.token0_symbol ?? "???");
  const name = isToken0
    ? (tk.token0_name ?? tk.name_en ?? tk.token1_name ?? mint.slice(0, 8))
    : (tk.token1_name ?? tk.name_en ?? tk.token0_name ?? mint.slice(0, 8));
  const logo = resolveLogo(
    isToken0
      ? (tk.token0_logo_url ?? tk.token1_logo_url)
      : (tk.token1_logo_url ?? tk.token0_logo_url),
  );
  return { mint, symbol, name, logo };
}

function numVal(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/* ------------------------------------------------------------------ */
/*  Sortable header                                                    */
/* ------------------------------------------------------------------ */

function SortHeader({
  label,
  field,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  className?: string;
}) {
  const active = current === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={cn(
        "flex items-center gap-0.5 font-mono text-[8px] uppercase tracking-[0.12em] transition-colors",
        active ? "text-[var(--ave-accent-bright)]" : "text-white/20 hover:text-white/40",
        className,
      )}
    >
      {label}
      {active && <span className="text-[7px]">{dir === "desc" ? "▼" : "▲"}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Risk bar                                                           */
/* ------------------------------------------------------------------ */

function RiskBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-white/15">—</span>;
  const color = score >= 70 ? "bg-red-400" : score >= 40 ? "bg-yellow-400" : "bg-emerald-400";
  const text = score >= 70 ? "text-red-400" : score >= 40 ? "text-yellow-400" : "text-emerald-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-[3px] w-8 bg-white/[0.06]">
        <div className={cn("h-full transition-all duration-500", color)} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className={cn("font-mono text-[10px] font-bold tabular-nums", text)}>{score}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary strip                                                      */
/* ------------------------------------------------------------------ */

function SummaryStrip({ tokens }: { tokens: PumpToken[] }) {
  const stats = useMemo(() => {
    const mcaps = tokens.map((t) => numVal(t.market_cap)).filter((v) => v > 0);
    const risks = tokens.map((t) => numVal(t.risk_score)).filter((v) => v > 0);
    const changes = tokens.map((t) => numVal(t.price_change)).filter(Number.isFinite);
    const holders = tokens.map((t) => numVal(t.holders)).filter((v) => v > 0);
    return {
      count: tokens.length,
      avgMcap: mcaps.length ? mcaps.reduce((a, b) => a + b, 0) / mcaps.length : 0,
      avgRisk: risks.length ? Math.round(risks.reduce((a, b) => a + b, 0) / risks.length) : 0,
      topGainer: changes.length ? Math.max(...changes) : 0,
      totalHolders: holders.reduce((a, b) => a + b, 0),
      avgHolders: holders.length ? Math.round(holders.reduce((a, b) => a + b, 0) / holders.length) : 0,
    };
  }, [tokens]);

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {[
        { label: "Tokens", value: String(stats.count), color: "text-white" },
        { label: "Avg MCap", value: `$${fmt(stats.avgMcap)}`, color: "text-white" },
        { label: "Avg Risk", value: String(stats.avgRisk), color: stats.avgRisk >= 70 ? "text-red-400" : stats.avgRisk >= 40 ? "text-yellow-400" : "text-emerald-400" },
        { label: "Top Gainer", value: `${stats.topGainer >= 0 ? "+" : ""}${stats.topGainer.toFixed(1)}%`, color: stats.topGainer >= 0 ? "text-emerald-400" : "text-red-400" },
        { label: "Total Holders", value: fmt(stats.totalHolders, 0), color: "text-white" },
        { label: "Avg Holders", value: fmt(stats.avgHolders, 0), color: "text-white/60" },
      ].map((s) => (
        <div key={s.label} className="border border-[var(--card-border)] bg-white/[0.01] px-3 py-2">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/25">{s.label}</div>
          <div className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", s.color)}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

const POLL_MS = 30_000;
const PAGE_SIZE = 10;

export function ScannerTable({ initialSource = "graduated" }: { initialSource?: Source }) {
  const [source, setSource] = useState<Source>(initialSource);
  const [tokens, setTokens] = useState<PumpToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastRefreshed, setLastRefreshed] = useState(Date.now());

  /* ---- Fetch ---- */

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/scan?source=${source}&limit=30`);
      const data = await res.json();
      if (data.error) { setError(data.error); setTokens([]); }
      else { setTokens(data.tokens ?? []); }
      setLastRefreshed(Date.now());
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((p) => p + PAGE_SIZE); },
      { root, rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, sortField, sortDir, source, visibleCount]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [source, sortField, sortDir]);

  /* ---- Sort ---- */

  function handleSort(field: SortField) {
    if (field === sortField) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  const sortedTokens = useMemo(() => {
    if (sortField === "rank") return tokens;
    const arr = [...tokens];
    const mul = sortDir === "desc" ? -1 : 1;
    const key: Record<Exclude<SortField, "rank">, (t: PumpToken) => number> = {
      price: (t) => numVal(t.current_price_usd),
      mcap: (t) => numVal(t.market_cap),
      change: (t) => numVal(t.price_change),
      vol: (t) => numVal(t.volume_u_24h),
      holders: (t) => numVal(t.holders),
      risk: (t) => numVal(t.risk_score),
    };
    arr.sort((a, b) => mul * (key[sortField](a) - key[sortField](b)));
    return arr;
  }, [tokens, sortField, sortDir]);

  /* ---- Render ---- */

  if (loading && tokens.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="ave-card border-red-400/20 bg-red-400/5 p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {tokens.length > 0 && <SummaryStrip tokens={tokens} />}

      {/* Table card */}
      <div className="ave-card overflow-hidden !p-0">
        {/* Tab bar + sort reset */}
        <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-white/[0.015] px-4">
          <div className="flex gap-px p-0.5">
            {(["graduated", "new"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setSource(tab); setSortField("rank"); }}
                className={cn(
                  "px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-all",
                  source === tab
                    ? "bg-[var(--ave-accent)]/20 text-[var(--ave-accent-bright)]"
                    : "text-white/20 hover:text-white/50",
                )}
              >
                {tab}
              </button>
            ))}
          </div>
          {sortField !== "rank" && (
            <button
              onClick={() => { setSortField("rank"); setSortDir("desc"); }}
              className="font-mono text-[8px] uppercase tracking-wider text-white/20 hover:text-white/40"
            >
              reset sort
            </button>
          )}
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-3 border-b border-[var(--card-border)] bg-white/[0.015] px-4 py-2">
          <div className="w-8 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20">#</div>
          <div className="min-w-0 flex-1 font-mono text-[8px] uppercase tracking-[0.12em] text-white/20">Token</div>
          <SortHeader label="Price" field="price" current={sortField} dir={sortDir} onSort={handleSort} className="hidden w-20 justify-end sm:flex" />
          <SortHeader label="MCap" field="mcap" current={sortField} dir={sortDir} onSort={handleSort} className="w-20 justify-end" />
          <SortHeader label="24h" field="change" current={sortField} dir={sortDir} onSort={handleSort} className="w-16 justify-end" />
          <SortHeader label="Vol" field="vol" current={sortField} dir={sortDir} onSort={handleSort} className="hidden w-20 justify-end md:flex" />
          <SortHeader label="Holders" field="holders" current={sortField} dir={sortDir} onSort={handleSort} className="hidden w-16 justify-end lg:flex" />
          <SortHeader label="Risk" field="risk" current={sortField} dir={sortDir} onSort={handleSort} className="w-20 justify-end" />
        </div>

        {/* Rows */}
        {tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="font-mono text-[10px] uppercase tracking-widest text-white/20">No tokens found</div>
          </div>
        ) : (
          <div ref={scrollRef} className="max-h-[calc(100vh-380px)] overflow-y-auto">
            {sortedTokens.slice(0, visibleCount).map((tk, i) => {
              const { mint, symbol, name, logo } = resolveToken(tk);
              if (!mint) return null;
              const ch24h = pct(tk.price_change);
              const risk = Number(tk.risk_score);
              const riskVal = Number.isFinite(risk) ? Math.round(risk) : null;
              const holdersVal = numVal(tk.holders);

              return (
                <Link
                  key={mint}
                  href={`/token/${mint}`}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[rgba(124,58,237,0.04)]",
                    i < sortedTokens.slice(0, visibleCount).length - 1 && "border-b border-white/[0.03]",
                    "animate-in",
                    i < 8 && `stagger-${Math.min(i + 1, 5)}`,
                  )}
                >
                  {/* # */}
                  <div className="w-8 font-mono text-[10px] tabular-nums text-white/15">
                    {(i + 1).toString().padStart(2, "0")}
                  </div>

                  {/* Token */}
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
                        {symbol.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] font-semibold text-white">
                        {symbol}
                      </div>
                      <div className="truncate font-mono text-[9px] text-white/20">
                        {name}
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="hidden w-20 text-right sm:block">
                    <span className="font-mono text-[10px] tabular-nums text-white/50">
                      {fmtPrice(tk.current_price_usd)}
                    </span>
                  </div>

                  {/* MCap */}
                  <div className="w-20 text-right">
                    <span className="font-mono text-[10px] font-semibold tabular-nums text-white/70">
                      ${fmt(tk.market_cap)}
                    </span>
                  </div>

                  {/* 24h */}
                  <div className="w-16 text-right">
                    <span className={cn(
                      "font-mono text-[10px] font-semibold tabular-nums",
                      ch24h.up ? "text-emerald-400" : "text-red-400",
                    )}>
                      {ch24h.label}
                    </span>
                  </div>

                  {/* Vol */}
                  <div className="hidden w-20 text-right md:block">
                    <span className="font-mono text-[10px] tabular-nums text-white/30">
                      ${fmt(tk.volume_u_24h)}
                    </span>
                  </div>

                  {/* Holders */}
                  <div className="hidden w-16 text-right lg:block">
                    <span className="font-mono text-[10px] tabular-nums text-white/40">
                      {holdersVal > 0 ? fmt(holdersVal, 0) : "—"}
                    </span>
                  </div>

                  {/* Risk */}
                  <div className="w-20 flex justify-end">
                    <RiskBar score={riskVal} />
                  </div>
                </Link>
              );
            })}

            {/* Sentinel for lazy load */}
            {visibleCount < sortedTokens.length && (
              <div ref={sentinelRef} className="flex items-center justify-center py-4">
                <span className="font-mono text-[9px] text-white/15">
                  {visibleCount} / {sortedTokens.length} · scroll for more
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--card-border)] bg-white/[0.01] px-4 py-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-white/15">
            {tokens.length} tokens
          </span>
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ave-accent)] opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--ave-accent-bright)]" />
            </span>
            <span className="font-mono text-[8px] text-white/15">
              auto-refresh {POLL_MS / 1000}s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
