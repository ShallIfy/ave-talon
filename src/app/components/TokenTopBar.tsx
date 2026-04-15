"use client";

import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { DetectedSignal } from "@/lib/signals/detector";
import { solscanToken } from "@/lib/solana/config";
import { cn } from "@/lib/utils";

const AVE_CDN = "https://www.iconaves.com/";

function resolveLogo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${AVE_CDN}${raw.replace(/^\/+/, "")}`;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "\u2014";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(digits)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(digits)}K`;
  return n.toFixed(digits);
}

function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "\u2014";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

export function TokenTopBar({
  snapshot,
  signal,
  inWatchlist,
  addingWatch,
  onToggleWatchlist,
  onReDetect,
  onProposeTrade,
}: {
  snapshot: AveSnapshot;
  signal: DetectedSignal | null;
  inWatchlist: boolean;
  addingWatch: boolean;
  onToggleWatchlist: () => void;
  onReDetect: () => void;
  onProposeTrade: () => void;
}) {
  const mcap =
    snapshot.totalSupply && snapshot.latestPriceUsd
      ? snapshot.totalSupply * snapshot.latestPriceUsd
      : null;
  const priceUp = snapshot.priceChangePct >= 0;
  const risk = snapshot.risk?.riskScore ?? null;
  const logo = resolveLogo(snapshot.logoUrl);

  const klines = snapshot.klines;
  const high24 = klines.length > 0 ? Math.max(...klines.map((k) => k.h)) : null;
  const low24 = klines.length > 0 ? Math.min(...klines.map((k) => k.l)) : null;

  return (
    <div className="ave-card !p-3 animate-in">
      {/* Row 1: Identity + Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Logo + Symbol */}
        <div className="flex items-center gap-2.5">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={snapshot.symbol ?? "token"}
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-full border border-[color:var(--card-border)] bg-black/40"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--card-border)] bg-[rgba(124,58,237,0.12)] font-mono text-xs font-semibold text-white">
              {(snapshot.symbol ?? "??").slice(0, 2)}
            </div>
          )}
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold text-white">
                {snapshot.symbol ?? "UNKNOWN"}
              </span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">
                {snapshot.name ?? ""}
              </span>
              {signal && signal.signal.number !== 9 && (
                <span className="badge badge-purple ml-1 text-[9px]">
                  #{signal.signal.number}
                </span>
              )}
            </div>
            <a
              href={solscanToken(snapshot.token)}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-mono text-[10px] text-[color:var(--muted-foreground)] hover:text-[var(--ave-accent-bright)]"
            >
              {snapshot.token.slice(0, 6)}…{snapshot.token.slice(-4)} ↗
            </a>
          </div>
        </div>

        {/* Price */}
        <div className="ml-auto flex items-baseline gap-2 sm:ml-4">
          <span className="font-mono text-xl font-bold text-white">
            {fmtPrice(snapshot.latestPriceUsd)}
          </span>
          {snapshot.latestPriceUsd > 0 && (
            <span
              className={cn(
                "font-mono text-sm font-semibold",
                priceUp ? "text-emerald-400" : "text-red-400",
              )}
            >
              {priceUp ? "+" : ""}
              {snapshot.priceChangePct.toFixed(2)}%
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1.5">
          <button
            onClick={onToggleWatchlist}
            disabled={addingWatch}
            className={cn(
              "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition",
              inWatchlist
                ? "border-[rgba(124,58,237,0.4)] bg-[rgba(124,58,237,0.1)] text-[var(--ave-accent-bright)]"
                : "border-[var(--card-border)] text-white/60 hover:border-[rgba(124,58,237,0.4)] hover:text-white",
              addingWatch && "opacity-60",
            )}
          >
            {inWatchlist ? "\u2605" : "\u2606"}
          </button>
          <button
            onClick={onReDetect}
            className="border border-[color:var(--card-border)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white/60 transition hover:border-[rgba(124,58,237,0.4)] hover:text-white"
          >
            Re-detect
          </button>
          {signal && signal.signal.action === "ENTRY" && (
            <button onClick={onProposeTrade} className="btn-glow !py-1 !text-[10px]">
              Trade
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Stats strip */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--card-border)] pt-2.5">
        <KV label="MCap" value={`$${fmt(mcap)}`} />
        <KV label="Vol 1h" value={`$${fmt(snapshot.volume1hAvg, 1)}`} />
        <KV label="High" value={high24 !== null ? fmtPrice(high24) : "\u2014"} />
        <KV label="Low" value={low24 !== null ? fmtPrice(low24) : "\u2014"} />
        <KV
          label="Risk"
          value={risk !== null ? String(risk) : "\u2014"}
          color={
            risk === null
              ? undefined
              : risk >= 70
                ? "text-red-400"
                : risk >= 40
                  ? "text-yellow-400"
                  : "text-emerald-400"
          }
        />
        {snapshot.tokenAgeHours !== null && (
          <KV label="Age" value={`${snapshot.tokenAgeHours.toFixed(1)}h`} />
        )}
        <KV label="Holders" value={fmt(snapshot.holderSeries.at(-1)?.holders_count ?? null, 0)} />
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </span>
      <span className={cn("font-mono text-[11px] font-medium text-white/90", color)}>
        {value}
      </span>
    </div>
  );
}
