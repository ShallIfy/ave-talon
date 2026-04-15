"use client";

// Persistent right rail — agent identity, vitals, live signal, watchlist,
// activity feed. Shown on xl+ only. Premium terminal aesthetic.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/utils";
import { resolveLogo } from "@/lib/utils/token-logo";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalSnippet {
  id: string;
  tokenMint: string;
  patternId: number;
  patternName: string;
  confidence: string;
  score: number;
  detectedAt: string;
  meta?: {
    signal?: { action?: string };
    reasoning?: string;
  } | null;
  token?: { symbol: string | null; logoUrl: string | null } | null;
  snapshot?: {
    mcapUsd: number | null;
    priceUsd?: number | null;
    priceAt1h?: number | null;
    priceAt4h?: number | null;
    priceAt24h?: number | null;
    outcomeScore?: number | null;
  } | null;
}

interface EntrySignal extends SignalSnippet {
  gain: number | null; // best ATH % gain
}

interface WatchlistSnippet {
  tokenMint: string;
  token?: {
    symbol: string | null;
    riskScore: number | null;
    logoUrl: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_STYLE: Record<string, { dot: string; label: string }> = {
  ENTRY: {
    dot: "bg-[var(--ave-accent-bright)] shadow-[0_0_6px_var(--ave-accent)]",
    label: "text-[var(--ave-accent-bright)]",
  },
  EXIT: { dot: "bg-red-400", label: "text-red-400" },
  DANGER: { dot: "bg-red-500", label: "text-red-400" },
  CAUTION: { dot: "bg-yellow-400/80", label: "text-yellow-400/80" },
  WAIT: { dot: "bg-white/20", label: "text-white/40" },
};

function shortTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtMcap(v: number | null | undefined): string | null {
  if (!v || v <= 0) return null;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function computeGain(snap: SignalSnippet["snapshot"]): number | null {
  if (!snap || !snap.priceUsd || snap.priceUsd <= 0) return null;
  const ath = Math.max(
    snap.priceAt1h ?? 0,
    snap.priceAt4h ?? 0,
    snap.priceAt24h ?? 0,
  );
  if (ath <= 0) return null;
  return ((ath - snap.priceUsd) / snap.priceUsd) * 100;
}

function fmtGain(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1000) return `+${(v / 1000).toFixed(1)}K%`;
  return `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
}

function scoreLabel(score: number): string {
  if (score >= 85) return "VERY STRONG";
  if (score >= 70) return "STRONG";
  if (score >= 55) return "MODERATE";
  if (score >= 35) return "WEAK";
  return "—";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  meta,
  className,
  children,
}: {
  title: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("px-4 py-3", className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
          {title}
        </h3>
        {meta && (
          <span className="font-mono text-[10px] tabular-nums tracking-[0.1em] text-white/25">
            {meta}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function TokenAvatar({
  logoUrl,
  symbol,
  size = 20,
}: {
  logoUrl?: string | null;
  symbol?: string | null;
  size?: number;
}) {
  const logo = resolveLogo(logoUrl);
  const px = `${size}px`;
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-white/[0.06]"
        style={{ width: px, height: px }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[var(--ave-accent)]/[0.1] font-mono text-[8px] font-semibold text-white/50"
      style={{ width: px, height: px }}
    >
      {(symbol ?? "??").slice(0, 2)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AgentRail() {
  const [signals, setSignals] = useState<SignalSnippet[]>([]);
  const [watch, setWatch] = useState<WatchlistSnippet[]>([]);
  const [todayEntries, setTodayEntries] = useState<EntrySignal[]>([]);
  const [pulse, setPulse] = useState(false);
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const wlUrl = owner
          ? `/api/watchlist?owner=${encodeURIComponent(owner)}`
          : null;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [sigRes, entryRes, wlRes] = await Promise.all([
          fetch("/api/signals?limit=4"),
          fetch(
            `/api/signals?limit=50&patterns=1,7,11&since=${todayStart.toISOString()}`,
          ),
          wlUrl ? fetch(wlUrl).catch(() => null) : Promise.resolve(null),
        ]);
        const sigJson = await sigRes.json();
        const entryJson = await entryRes.json();
        const wlJson = wlRes ? await wlRes.json() : { items: [] };
        if (cancel) return;

        setSignals(sigJson.signals ?? []);
        setWatch((wlJson?.items ?? []).slice(0, 5));

        const entries: EntrySignal[] = ((entryJson.signals ?? []) as SignalSnippet[]).map(
          (s) => ({ ...s, gain: computeGain(s.snapshot) }),
        );
        setTodayEntries(entries);
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(() => {
      load();
      setPulse(true);
      setTimeout(() => setPulse(false), 400);
    }, 15_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [owner]);

  const latestSignal = signals[0];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header: Agent Identity ── */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full transition-all duration-300",
              pulse
                ? "scale-125 bg-[var(--ave-accent-bright)] shadow-[0_0_8px_var(--ave-accent)]"
                : "bg-[var(--ave-accent)] shadow-[0_0_4px_var(--ave-accent-dim)]",
            )}
          />
          <span className="font-mono text-[12px] font-medium tracking-[0.12em] text-white/80">
            talon_agent
          </span>
        </div>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ave-accent-bright)]/70">
          online
        </span>
      </div>

      {/* Thin accent line below header */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--ave-accent)]/20 to-transparent" />

      {/* ── Today ── */}
      <Section title="Today">
        {(() => {
          const topGainer = todayEntries.reduce<EntrySignal | null>(
            (best, e) =>
              e.gain !== null && (best === null || (e.gain ?? 0) > (best.gain ?? 0))
                ? e
                : best,
            null,
          );
          const avgScore =
            todayEntries.length > 0
              ? Math.round(
                  todayEntries.reduce((sum, e) => sum + e.score, 0) /
                    todayEntries.length,
                )
              : 0;
          return (
            <div className="grid grid-cols-3 gap-1.5">
              {/* Box 1: Entries */}
              <div className="border border-white/[0.05] bg-white/[0.01] px-2.5 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">
                  Entries
                </div>
                <div className="mt-1 font-mono text-[16px] font-medium tabular-nums leading-none text-white/80">
                  {todayEntries.length}
                </div>
              </div>

              {/* Box 2: Top Gain */}
              <div className="border border-white/[0.05] bg-white/[0.01] px-2.5 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">
                  Top Gain
                </div>
                {topGainer ? (
                  <Link
                    href={`/token/${topGainer.tokenMint}`}
                    className="mt-1 flex items-center gap-1.5"
                  >
                    <TokenAvatar
                      logoUrl={topGainer.token?.logoUrl}
                      symbol={topGainer.token?.symbol ?? topGainer.tokenMint.slice(0, 2)}
                      size={16}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[10px] font-medium uppercase leading-none text-white/70">
                        {topGainer.token?.symbol ?? topGainer.tokenMint.slice(0, 4)}
                      </div>
                      <div
                        className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums leading-none"
                        style={{
                          color:
                            topGainer.gain !== null && topGainer.gain >= 0
                              ? "var(--ave-accent-bright)"
                              : "rgba(248,113,113,0.85)",
                        }}
                      >
                        {fmtGain(topGainer.gain)}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="mt-1 font-mono text-[12px] tabular-nums text-white/20">
                    —
                  </div>
                )}
              </div>

              {/* Box 3: Avg Score */}
              <div className="border border-white/[0.05] bg-white/[0.01] px-2.5 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">
                  Avg Score
                </div>
                <div
                  className={cn(
                    "mt-1 font-mono text-[16px] font-medium tabular-nums leading-none",
                    avgScore >= 70
                      ? "text-[var(--ave-accent-bright)]"
                      : avgScore >= 50
                        ? "text-white/80"
                        : "text-white/40",
                  )}
                >
                  {todayEntries.length > 0 ? avgScore : "—"}
                </div>
              </div>
            </div>
          );
        })()}
      </Section>

      <div className="h-px bg-white/[0.04]" />

      {/* ── Latest Signal ── */}
      <Section
        title="Latest Signal"
        meta={latestSignal ? shortTime(latestSignal.detectedAt) : "—"}
      >
        {latestSignal ? (
          <Link
            href={`/token/${latestSignal.tokenMint}`}
            className="group block border border-white/[0.06] bg-[var(--ave-accent)]/[0.03] px-3 py-2.5 transition-all hover:border-[var(--ave-accent)]/30 hover:bg-[var(--ave-accent)]/[0.05]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <TokenAvatar
                  logoUrl={latestSignal.token?.logoUrl}
                  symbol={latestSignal.token?.symbol ?? latestSignal.tokenMint.slice(0, 2)}
                />
                <span className="truncate font-mono text-[12px] font-medium uppercase tracking-[0.04em] text-white/90">
                  {latestSignal.token?.symbol ??
                    latestSignal.tokenMint.slice(0, 4)}
                </span>
              </div>
              <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--ave-accent-bright)]">
                {Math.round(latestSignal.score)}
              </span>
            </div>
            <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-white/30">
              {latestSignal.patternName}
            </div>
          </Link>
        ) : (
          <div className="border border-white/[0.05] px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/20">
            awaiting signal...
          </div>
        )}
      </Section>

      <div className="h-px bg-white/[0.04]" />

      {/* ── Watchlist ── */}
      <Section title="Watchlist" meta={watch.length > 0 ? `${watch.length}` : undefined}>
        {watch.length === 0 ? (
          <div className="font-mono text-[10px] tracking-[0.08em] text-white/20">
            empty &middot;{" "}
            <Link
              href="/scanner"
              className="text-[var(--ave-accent-bright)]/60 transition-colors hover:text-[var(--ave-accent-bright)]"
            >
              scan tokens
            </Link>
          </div>
        ) : (
          <ul className="space-y-px">
            {watch.map((w) => (
              <li key={w.tokenMint}>
                <Link
                  href={`/token/${w.tokenMint}`}
                  className="flex items-center justify-between px-1.5 py-1.5 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <TokenAvatar
                      logoUrl={w.token?.logoUrl}
                      symbol={w.token?.symbol ?? w.tokenMint.slice(0, 2)}
                      size={18}
                    />
                    <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-white/70">
                      {w.token?.symbol ?? w.tokenMint.slice(0, 6)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "font-mono text-[10px] tabular-nums",
                      w.token?.riskScore != null && w.token.riskScore >= 70
                        ? "text-red-400/80"
                        : "text-white/25",
                    )}
                  >
                    {w.token?.riskScore ?? "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="h-px bg-white/[0.04]" />

      {/* ── Activity Feed ── */}
      <Section title="Recent Activity" meta={`${signals.length}`} className="min-h-0 flex-1 overflow-hidden">
        {signals.length === 0 ? (
          <div className="font-mono text-[10px] tracking-[0.08em] text-white/20">
            idle
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 overflow-y-auto">
            {signals.map((sig) => {
              const action = sig.meta?.signal?.action ?? "WAIT";
              const style = ACTION_STYLE[action] ?? ACTION_STYLE.WAIT;
              const symbol =
                sig.token?.symbol ?? sig.tokenMint.slice(0, 4);
              const mcap = fmtMcap(sig.snapshot?.mcapUsd);
              return (
                <Link
                  key={sig.id}
                  href={`/token/${sig.tokenMint}`}
                  className="group flex items-center gap-2.5 rounded-[2px] px-1.5 py-1.5 transition-colors hover:bg-white/[0.02]"
                >
                  <TokenAvatar
                    logoUrl={sig.token?.logoUrl}
                    symbol={sig.token?.symbol ?? sig.tokenMint.slice(0, 2)}
                    size={22}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-1">
                      <div className="flex items-baseline gap-1 truncate">
                        {action !== "WAIT" && action !== "NO_SIGNAL" && (
                          <span
                            className={cn(
                              "font-mono text-[10px] font-semibold uppercase tracking-[0.04em]",
                              style.label,
                            )}
                          >
                            {action}
                          </span>
                        )}
                        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-white/60">
                          {symbol}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/20">
                        {shortTime(sig.detectedAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {mcap && (
                        <>
                          <span className="font-mono text-[9px] tabular-nums text-white/35">
                            {mcap}
                          </span>
                          <span className="text-[9px] text-white/10">·</span>
                        </>
                      )}
                      <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-white/20">
                        {scoreLabel(sig.score)}
                      </span>
                      <span className="text-[9px] text-white/10">·</span>
                      <span className="font-mono text-[9px] tabular-nums text-white/20">
                        {Math.round(sig.score)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      {/* Spacer */}
      <div className="flex-1" />

      {/* ── Footer ── */}
      <div className="border-t border-white/[0.04] px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/15">
            AVE TALON
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/10">
            observer mode
          </span>
        </div>
      </div>
    </div>
  );
}
