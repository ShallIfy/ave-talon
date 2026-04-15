"use client";

// Full token deep-dive card: identity, price/mcap, holder delta summary,
// risk score, latest signal. Receives already-fetched snapshot + signal.

import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { DetectedSignal } from "@/lib/signals/detector";
import { cn } from "@/lib/utils";
import { solscanToken } from "@/lib/solana/config";
import { HolderDeltaChart } from "./HolderDeltaChart";
import { ConfidenceGauge } from "./ConfidenceGauge";

const AVE_CDN = "https://www.iconaves.com/";

function resolveLogo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${AVE_CDN}${raw.replace(/^\/+/, "")}`;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(digits)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(digits)}K`;
  return n.toFixed(digits);
}

function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "—";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

export function TokenDetailCard({
  snapshot,
  signal,
  onProposeTrade,
  className,
}: {
  snapshot: AveSnapshot;
  signal: DetectedSignal | null;
  onProposeTrade?: () => void;
  className?: string;
}) {
  const mcap =
    snapshot.totalSupply && snapshot.latestPriceUsd
      ? snapshot.totalSupply * snapshot.latestPriceUsd
      : null;
  const priceUp = snapshot.priceChangePct >= 0;
  const risk = snapshot.risk?.riskScore ?? null;
  const riskColor =
    risk === null
      ? "text-[color:var(--muted-foreground)]"
      : risk >= 70
        ? "text-red-400"
        : risk >= 40
          ? "text-yellow-400"
          : "text-[color:var(--ave-teal)]";

  return (
    <div className={cn("ave-card-premium animate-in space-y-5", className)}>
      {/* Header */}
      <div className="flex items-start gap-4">
        {(() => {
          const logo = resolveLogo(snapshot.logoUrl);
          return logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={snapshot.symbol ?? "token"}
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-full border border-[color:var(--card-border)] bg-black/40"
              referrerPolicy="no-referrer"
            />
          ) : null;
        })()}
        {!snapshot.logoUrl && (
          <div className="h-12 w-12 shrink-0 border border-[var(--card-border)] bg-[rgba(124,58,237,0.12)] flex items-center justify-center font-mono text-sm font-semibold text-white">
            {(snapshot.symbol ?? "??").slice(0, 2)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-xl font-bold tracking-tight text-white">
              {snapshot.symbol ?? "UNKNOWN"}
            </h2>
            <span className="truncate text-xs text-[color:var(--muted-foreground)]">
              {snapshot.name ?? ""}
            </span>
          </div>
          <a
            href={solscanToken(snapshot.token)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate font-mono text-[11px] text-[color:var(--muted-foreground)] hover:text-[color:var(--ave-teal)]"
          >
            {snapshot.token.slice(0, 8)}…{snapshot.token.slice(-6)} ↗
          </a>
        </div>
        {signal && signal.signal.number !== 9 && (
          <div className="shrink-0">
            <span className="badge badge-purple">#{signal.signal.number}</span>
          </div>
        )}
      </div>

      {/* Price strip */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="stat-label">Price</div>
          <div className="mt-0.5 font-mono text-base font-semibold text-white">
            {formatPrice(snapshot.latestPriceUsd)}
          </div>
          <div
            className={cn(
              "text-xs font-medium",
              priceUp ? "text-[color:var(--ave-teal)]" : "text-red-400",
            )}
          >
            {priceUp ? "+" : ""}
            {snapshot.priceChangePct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="stat-label">MCap</div>
          <div className="mt-0.5 font-mono text-base font-semibold text-white">
            ${formatNumber(mcap, 2)}
          </div>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            supply {formatNumber(snapshot.totalSupply, 1)}
          </div>
        </div>
        <div>
          <div className="stat-label">Vol 1h avg</div>
          <div className="mt-0.5 font-mono text-base font-semibold text-white">
            ${formatNumber(snapshot.volume1hAvg, 1)}
          </div>
          <div className={cn("text-xs font-medium", riskColor)}>
            risk {risk ?? "—"}
          </div>
        </div>
      </div>

      {/* Holder series */}
      <div className="space-y-1">
        <div className="stat-label">Holders (series)</div>
        <div className="pb-5 pt-1">
          <HolderDeltaChart series={snapshot.holderSeries} width={280} height={50} />
        </div>
        {snapshot.holderDelta && (() => {
          const d = snapshot.holderDelta;
          const holderCountDelta = d.holdersCountEnd - d.holdersCountStart;
          return (
            <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
              <Stat
                label="Δ holders"
                value={`${holderCountDelta >= 0 ? "+" : ""}${holderCountDelta} (${d.holderGrowthPct.toFixed(1)}%)`}
                up={holderCountDelta >= 0}
              />
              <Stat
                label="top10 Δ"
                value={`${(d.top10RatioDelta * 100).toFixed(2)}pp`}
                up={d.top10RatioDelta <= 0}
              />
              <Stat
                label=">$10 Δ"
                value={`${d.holdersAbove10Delta >= 0 ? "+" : ""}${d.holdersAbove10Delta}`}
                up={d.holdersAbove10Delta >= 0}
              />
            </div>
          );
        })()}
      </div>

      {/* Signal gauge */}
      {signal && (
        <div className="border border-[var(--card-border)] bg-[rgba(124,58,237,0.04)] p-4">
          <ConfidenceGauge
            score={signal.score}
            label={`Signal #${signal.signal.number} · ${signal.signal.name}`}
          />
          <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
            {signal.reasoning}
          </p>
        </div>
      )}

      {/* Action button */}
      {onProposeTrade && signal?.signal.action !== "DANGER" && signal?.signal.action !== "EXIT" && (
        <button
          type="button"
          onClick={onProposeTrade}
          className="btn-glow w-full"
        >
          Propose trade via Jupiter
        </button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  up,
}: {
  label: string;
  value: string;
  up: boolean;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--card-border)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-sm font-semibold",
          up ? "text-[color:var(--ave-teal)]" : "text-red-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}
