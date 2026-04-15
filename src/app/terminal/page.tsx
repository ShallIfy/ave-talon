"use client";

// AI Research Feed — card-based activity stream showing the AI's analysis
// of detected tokens. Research cards with real Twitter data, cycle summaries,
// and live orchestrator status. Read-only observer mode.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useTerminalLines,
  type TerminalKind,
  type TerminalLine,
} from "@/app/components/AgentLog";
import { cn } from "@/lib/utils";

// ── Types for research card meta ────────────────────────────────────

interface TweetMeta {
  id: string;
  text: string;
  authorUsername: string;
  likes: number;
  createdAt: string;
}

interface ResearchMeta {
  type: "signal_research";
  mint: string;
  symbol: string | null;
  patternId: number;
  patternName: string;
  confidence: string;
  score: number;
  action: string;
  reasoning: string;
  priceUsd: number;
  mcapUsd: number;
  dimensions?: {
    holderGrowth: number;
    top10Concentration: number;
    realMoney: number;
    volume: number;
    price: number;
  };
  holderCount?: number | null;
  narrative: string;
  tweets: TweetMeta[];
  telegramSent: boolean;
}

function isResearchMeta(meta: unknown): meta is ResearchMeta {
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as Record<string, unknown>).type === "signal_research"
  );
}

// ── Cycle summary parsing ───────────────────────────────────────────

interface CycleSummary {
  cycleNum: string;
  scanned: string;
  signals: string;
  persisted: string;
  duration: string;
}

function parseCycleDone(text: string): CycleSummary | null {
  const m = text.match(
    /cycle done · (\d+) scanned · (\d+) signals? · (\d+) persisted · ([\d.]+s)/,
  );
  if (!m) return null;
  return {
    cycleNum: "",
    scanned: m[1],
    signals: m[2],
    persisted: m[3],
    duration: m[4],
  };
}

function parseCycleStart(text: string): string | null {
  const m = text.match(/scan cycle #(\d+)/);
  return m ? m[1] : null;
}

// ── Filter config ───────────────────────────────────────────────────

type FilterKey = "all" | "research" | "cycles" | "raw";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "research", label: "Research" },
  { key: "cycles", label: "Cycles" },
  { key: "raw", label: "Raw Log" },
];

// ── Helpers ─────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}

function fmtPrice(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  if (v < 1) return `$${v.toPrecision(3)}`;
  return `$${v.toFixed(2)}`;
}

function fmtMcap(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtDim(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

const ACTION_STYLES: Record<
  string,
  { dot: string; border: string; label: string; bg: string }
> = {
  ENTRY: {
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
    border: "border-l-emerald-500/60",
    label: "text-emerald-400",
    bg: "bg-emerald-500/[0.04]",
  },
  EXIT: {
    dot: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]",
    border: "border-l-red-500/60",
    label: "text-red-400",
    bg: "bg-red-500/[0.04]",
  },
  CAUTION: {
    dot: "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]",
    border: "border-l-yellow-500/60",
    label: "text-yellow-400",
    bg: "bg-yellow-500/[0.04]",
  },
  DANGER: {
    dot: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]",
    border: "border-l-red-600/60",
    label: "text-red-500",
    bg: "bg-red-500/[0.04]",
  },
  WAIT: {
    dot: "bg-white/30",
    border: "border-l-white/20",
    label: "text-white/50",
    bg: "bg-white/[0.01]",
  },
};

const DEFAULT_STYLE = ACTION_STYLES.WAIT;

// ── Stats computation ───────────────────────────────────────────────

interface FeedStats {
  scanned: number;
  signals: number;
  tweets: number;
  telegram: number;
}

function computeStats(lines: TerminalLine[]): FeedStats {
  let scanned = 0;
  let signals = 0;
  let tweets = 0;
  let telegram = 0;
  for (const l of lines) {
    if (l.kind === "observe") scanned++;
    else if (l.kind === "research" || l.kind === "decide") signals++;
    else if (l.kind === "twitter") tweets++;
    else if (l.kind === "telegram") telegram++;
  }
  return { scanned, signals, tweets, telegram };
}

// ── Tweet embed component ───────────────────────────────────────────

function TweetEmbed({ tweet }: { tweet: TweetMeta }) {
  const tweetUrl = `https://x.com/${tweet.authorUsername}/status/${tweet.id}`;
  const avatarUrl = `https://unavatar.io/twitter/${tweet.authorUsername}`;
  return (
    <a
      href={tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group/tweet flex gap-3 border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 transition-all hover:border-sky-500/30 hover:bg-sky-500/[0.03]"
    >
      {/* Avatar */}
      <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt={`@${tweet.authorUsername}`}
          className="h-7 w-7 rounded-full bg-white/[0.06] object-cover"
          loading="lazy"
          onError={(e) => {
            // Fallback to X logo if avatar fails
            (e.target as HTMLImageElement).style.display = "none";
            (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
          }}
        />
        <svg
          viewBox="0 0 24 24"
          className="hidden h-3.5 w-3.5 fill-white/20"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-sky-400 transition-colors group-hover/tweet:text-sky-300">
            @{tweet.authorUsername}
          </span>
          {tweet.createdAt && (
            <span className="font-mono text-[9px] text-white/20">
              {tweet.createdAt}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white/15">
              <path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.45-4.55-.334-6.07C3.898 5.6 5.658 4.86 7.56 5.37c1.243.333 2.322 1.064 3.253 1.998a.75.75 0 0 0 1.074-.015c.885-.906 1.937-1.626 3.16-1.964 1.906-.529 3.676.197 4.813 1.758 1.123 1.542 1.023 3.593-.335 6.093l-.641-.358z" />
            </svg>
            <span className="font-mono text-[9px] tabular-nums text-white/25">
              {tweet.likes}
            </span>
          </div>
        </div>
        <p className="mt-1 font-mono text-[10px] leading-[1.6] text-white/55 transition-colors group-hover/tweet:text-white/70">
          {tweet.text.length > 200
            ? `${tweet.text.slice(0, 200)}...`
            : tweet.text}
        </p>
      </div>
    </a>
  );
}

// ── Signal Research Card ────────────────────────────────────────────

function ResearchCard({
  line,
  isNew,
}: {
  line: TerminalLine;
  isNew: boolean;
}) {
  const meta = line.meta as unknown as ResearchMeta;
  const [expanded, setExpanded] = useState(false);
  const style = ACTION_STYLES[meta.action] ?? DEFAULT_STYLE;

  return (
    <div
      className={cn(
        "border border-l-[3px] border-[var(--card-border)] transition-all",
        style.border,
        style.bg,
        isNew && "animate-[feedSlideIn_0.4s_ease-out]",
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
        {/* Action dot + label */}
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0", style.dot)} />
          <span
            className={cn(
              "font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
              style.label,
            )}
          >
            {meta.action}
          </span>
        </div>

        {/* Token symbol */}
        <span className="font-mono text-[13px] font-semibold tracking-tight text-white">
          ${meta.symbol ?? meta.mint.slice(0, 6)}
        </span>

        {/* Pattern info */}
        <span className="font-mono text-[9px] text-white/30">
          #{meta.patternId} {meta.patternName}
        </span>

        {/* Confidence badge */}
        <span
          className={cn(
            "ml-auto hidden font-mono text-[8px] font-bold uppercase tracking-[0.12em] sm:inline-block",
            meta.confidence === "HIGH"
              ? "text-emerald-400/80"
              : meta.confidence === "MEDIUM"
                ? "text-yellow-400/80"
                : "text-white/30",
          )}
        >
          {meta.confidence}
        </span>

        {/* Score */}
        <span className="font-mono text-[11px] font-semibold tabular-nums text-white/70">
          {meta.score.toFixed(1)}
        </span>

        {/* Time */}
        <span className="font-mono text-[9px] tabular-nums text-white/20">
          {formatTs(line.ts)}
        </span>
      </div>

      {/* Narrative section — combines signal reasoning + AI narrative */}
      <div className="px-4 pb-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-[var(--ave-accent-bright)]">
            AI Analysis
          </span>
          <div className="h-px flex-1 bg-white/[0.04]" />
        </div>

        {/* Signal reasoning — why it triggered */}
        {meta.reasoning && (
          <p className="mb-2 font-mono text-[10px] leading-[1.6] text-white/40">
            {meta.reasoning}
          </p>
        )}

        {/* Twitter narrative — what CT is saying */}
        {meta.narrative && (
          <p className="font-mono text-[11px] leading-[1.7] text-white/65">
            {meta.narrative}
          </p>
        )}
      </div>

      {/* Twitter research section */}
      {meta.tweets?.length > 0 && (
        <div className="px-4 pb-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-sky-400/80">
              Twitter Research
            </span>
            <span className="font-mono text-[8px] tabular-nums text-white/20">
              {meta.tweets.length} tweets
            </span>
            <div className="h-px flex-1 bg-white/[0.04]" />
          </div>
          <div className="flex flex-col gap-1">
            {meta.tweets.slice(0, 3).map((t) => (
              <TweetEmbed key={t.id} tweet={t} />
            ))}
            {meta.tweets.length > 3 && (
              <span className="mt-1 font-mono text-[9px] text-white/20">
                +{meta.tweets.length - 3} more tweets
              </span>
            )}
          </div>
        </div>
      )}

      {/* Signal breakdown (collapsible) */}
      <div className="border-t border-white/[0.04] px-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 py-2 text-left transition-colors hover:bg-white/[0.01]"
        >
          <svg
            viewBox="0 0 12 12"
            className={cn(
              "h-2.5 w-2.5 fill-white/25 transition-transform",
              expanded && "rotate-90",
            )}
          >
            <path d="M4 2l4 4-4 4" />
          </svg>
          <span className="font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-white/30">
            Signal Breakdown
          </span>

          {/* Price + MCap inline */}
          <span className="ml-auto font-mono text-[9px] tabular-nums text-white/25">
            {fmtPrice(meta.priceUsd)} / {fmtMcap(meta.mcapUsd)}
          </span>
        </button>

        {expanded && meta.dimensions && (
          <div className="pb-3">
            <div className="grid grid-cols-5 gap-px">
              {(
                [
                  ["HLD", meta.dimensions.holderGrowth],
                  ["TOP10", meta.dimensions.top10Concentration],
                  ["R$", meta.dimensions.realMoney],
                  ["VOL", meta.dimensions.volume],
                  ["PX", meta.dimensions.price],
                ] as const
              ).map(([label, val]) => (
                <div
                  key={label}
                  className="flex flex-col items-center border border-white/[0.04] bg-white/[0.01] py-2"
                >
                  <span
                    className={cn(
                      "font-mono text-[11px] font-semibold tabular-nums",
                      val > 0 ? "text-emerald-400/80" : val < 0 ? "text-red-400/80" : "text-white/30",
                    )}
                  >
                    {fmtDim(val)}
                  </span>
                  <span className="mt-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.14em] text-white/20">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {/* Reasoning text */}
            <p className="mt-2 font-mono text-[9px] leading-[1.6] text-white/30">
              {meta.reasoning}
            </p>

            {meta.holderCount && (
              <span className="mt-1 inline-block font-mono text-[9px] text-white/20">
                Holders: {meta.holderCount.toLocaleString("en-US")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 border-t border-white/[0.04] px-4 py-2">
        {/* Telegram status */}
        <div className="flex items-center gap-1.5">
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "h-3 w-3",
              meta.telegramSent ? "fill-blue-400/60" : "fill-white/15",
            )}
          >
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
          <span
            className={cn(
              "font-mono text-[8px] uppercase tracking-[0.1em]",
              meta.telegramSent ? "text-blue-400/60" : "text-white/20",
            )}
          >
            {meta.telegramSent ? "Sent to @AAG_Labs" : "Not sent"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* View on AVE link */}
          <a
            href={`/token/${meta.mint}`}
            className="font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--ave-accent-bright)] opacity-60 transition-opacity hover:opacity-100"
          >
            View on AVE
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Cycle Summary Card ──────────────────────────────────────────────

function CycleCard({
  line,
  cycleNum,
}: {
  line: TerminalLine;
  cycleNum: string | null;
}) {
  const summary = parseCycleDone(line.text);
  if (!summary) return null;

  return (
    <div className="flex items-center gap-3 border border-white/[0.04] bg-white/[0.008] px-4 py-2.5">
      {/* Cycle indicator */}
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 bg-white/15" />
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white/25">
          Cycle {cycleNum ?? "?"}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 font-mono text-[9px] tabular-nums text-white/20">
        <span>{summary.scanned} scanned</span>
        <span className="text-white/8">|</span>
        <span
          className={cn(
            Number(summary.signals) > 0 ? "text-emerald-400/60" : "",
          )}
        >
          {summary.signals} signal{summary.signals !== "1" ? "s" : ""}
        </span>
        <span className="text-white/8">|</span>
        <span>{summary.persisted} persisted</span>
      </div>

      {/* Duration + time */}
      <div className="ml-auto flex items-center gap-3 font-mono text-[9px] text-white/15">
        <span className="tabular-nums">{summary.duration}</span>
        <span className="tabular-nums">{formatTs(line.ts)}</span>
      </div>
    </div>
  );
}

// ── Raw log line (for Raw tab) ──────────────────────────────────────

const RAW_KIND_COLOR: Record<TerminalKind, string> = {
  system: "text-[var(--ave-accent-bright)]",
  info: "text-white/30",
  observe: "text-blue-300/60",
  decide: "text-[var(--ave-accent-bright)]",
  act: "text-[var(--ave-accent-bright)]",
  "tx-pending": "text-yellow-300/60",
  "tx-success": "text-emerald-400/60",
  "tx-failed": "text-red-400/60",
  warning: "text-yellow-400/60",
  error: "text-red-400/60",
  signal: "text-emerald-400/60",
  twitter: "text-sky-400/60",
  telegram: "text-blue-400/60",
  research: "text-[var(--ave-accent-bright)]",
};

function RawLine({ line }: { line: TerminalLine }) {
  return (
    <div className="flex items-start gap-2 px-3 py-[3px] font-mono text-[9px] leading-[1.7] hover:bg-white/[0.01]">
      <span className="shrink-0 tabular-nums text-white/12">
        {formatTs(line.ts)}
      </span>
      <span
        className={cn(
          "shrink-0 font-bold uppercase",
          RAW_KIND_COLOR[line.kind],
        )}
      >
        {line.kind.slice(0, 4).padEnd(4)}
      </span>
      <span className="min-w-0 flex-1 break-words text-white/30">
        {line.text}
      </span>
    </div>
  );
}

// ── Status bar ──────────────────────────────────────────────────────

function StatusBar({ stats }: { stats: FeedStats }) {
  const [statusData, setStatusData] = useState<{
    running: boolean;
    nextAt: number;
    inflight: boolean;
  } | null>(null);

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/agent/orchestrator", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setStatusData({
          running: data.running ?? false,
          nextAt: data.cycles?.nextAt ?? 0,
          inflight: data.cycles?.inflight ?? false,
        });
      } catch {
        // ignore
      }
    }
    fetchStatus();
    const id = setInterval(fetchStatus, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // Tick countdown every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const countdown = useMemo(() => {
    if (!statusData?.nextAt) return null;
    const diff = Math.max(0, statusData.nextAt - now);
    const m = Math.floor(diff / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [statusData?.nextAt, now]);

  return (
    <div className="flex items-center justify-between border-t border-[var(--card-border)] bg-[#08080a] px-4 py-2.5">
      <div className="flex items-center gap-4">
        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5",
              statusData?.running
                ? statusData.inflight
                  ? "animate-pulse bg-yellow-400"
                  : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                : "bg-white/15",
            )}
          />
          <span className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-white/35">
            {statusData?.running
              ? statusData.inflight
                ? "Scanning"
                : "Live"
              : "Offline"}
          </span>
        </div>

        {/* Next cycle */}
        {countdown && !statusData?.inflight && (
          <span className="font-mono text-[8px] tabular-nums text-white/18">
            Next scan {countdown}
          </span>
        )}
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-4 font-mono text-[8px] tabular-nums text-white/18">
        <span>{stats.scanned} scanned</span>
        <span>{stats.signals} signals</span>
        <span>{stats.tweets} tweets</span>
        <span>{stats.telegram} tg</span>
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: FilterKey }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="relative mb-6 flex h-16 w-16 items-center justify-center border border-white/[0.06]">
        <div className="absolute inset-0 bg-[var(--ave-accent)]/[0.03]" />
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 fill-none stroke-white/15 stroke-[1.5]"
        >
          {filter === "research" ? (
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          ) : filter === "cycles" ? (
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          ) : (
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          )}
        </svg>
      </div>

      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/20">
        {filter === "all"
          ? "Waiting for activity"
          : filter === "research"
            ? "No research yet"
            : filter === "cycles"
              ? "No scan cycles yet"
              : "No raw events yet"}
      </p>
      <p className="mt-2 max-w-[280px] text-center font-mono text-[9px] leading-[1.6] text-white/12">
        The AI agent scans pump.fun tokens every 3 minutes. Research cards
        appear when ENTRY signals are detected.
      </p>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────

export default function TerminalPage() {
  const lines = useTerminalLines();
  const [filter, setFilter] = useState<FilterKey>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevCountRef = useRef(0);

  const stats = useMemo(() => computeStats(lines), [lines]);

  // Track cycle numbers for cycle cards
  const cycleNumbers = useMemo(() => {
    const map = new Map<string, string>();
    let currentCycleNum = "";
    for (const l of lines) {
      if (l.kind === "system") {
        const num = parseCycleStart(l.text);
        if (num) currentCycleNum = num;
        if (l.text.includes("cycle done")) {
          map.set(l.id, currentCycleNum);
        }
      }
    }
    return map;
  }, [lines]);

  // Build feed items based on filter
  const feedItems = useMemo(() => {
    if (filter === "raw") return lines;
    if (filter === "research") {
      return lines.filter((l) => l.kind === "research");
    }
    if (filter === "cycles") {
      return lines.filter(
        (l) => l.kind === "system" && l.text.includes("cycle done"),
      );
    }
    // "all" — show research cards + cycle summaries
    return lines.filter(
      (l) =>
        l.kind === "research" ||
        (l.kind === "system" && l.text.includes("cycle done")),
    );
  }, [lines, filter]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCountRef.current = feedItems.length;
  }, [feedItems, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-48px)] w-full max-w-[1200px] flex-col px-4 py-5 sm:px-6 lg:h-dvh">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.2em] text-white">
            Research Feed
          </h1>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">
            AI-powered token analysis
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="pulse-dot" />
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--ave-accent-bright)]">
            Live
          </span>
        </div>
      </div>

      {/* ── Stats strip ───────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-4 gap-px">
        {(
          [
            ["Scanned", stats.scanned, "bg-white/20"],
            ["Signals", stats.signals, "bg-emerald-400/60"],
            ["Tweets", stats.tweets, "bg-sky-400/60"],
            ["Telegram", stats.telegram, "bg-blue-400/60"],
          ] as const
        ).map(([label, value, accent]) => (
          <div
            key={label}
            className="relative flex flex-col items-center justify-center border border-white/[0.05] bg-white/[0.01] px-4 py-2.5"
          >
            <div
              className={cn("absolute top-0 right-0 left-0 h-px", accent)}
            />
            <span className="font-mono text-[18px] font-semibold tabular-nums tracking-tight text-white">
              {value}
            </span>
            <span className="mt-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.2em] text-white/25">
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Filter tabs ───────────────────────────────────────── */}
      <div className="mb-3 flex items-center gap-px border-b border-white/[0.04] pb-0">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "relative px-4 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-all",
              filter === f.key
                ? "text-white"
                : "text-white/20 hover:text-white/40",
            )}
          >
            {f.label}
            {filter === f.key && (
              <span className="absolute right-0 bottom-0 left-0 h-[2px] bg-[var(--ave-accent)]" />
            )}
          </button>
        ))}

        {/* Scroll to bottom */}
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
            className="ml-auto px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--ave-accent-bright)] transition-colors hover:text-white"
          >
            Scroll to latest
          </button>
        )}
      </div>

      {/* ── Feed ──────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col border border-[var(--card-border)] bg-[#0a0a0d]">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-none min-h-0 flex-1 overflow-y-auto"
        >
          {feedItems.length === 0 ? (
            <EmptyState filter={filter} />
          ) : filter === "raw" ? (
            /* Raw log view */
            <div className="py-1">
              {feedItems.map((line) => (
                <RawLine key={line.id} line={line} />
              ))}
            </div>
          ) : (
            /* Card view */
            <div className="flex flex-col gap-2 p-3">
              {feedItems.map((line, i) => {
                if (
                  line.kind === "research" &&
                  isResearchMeta(line.meta)
                ) {
                  return (
                    <ResearchCard
                      key={line.id}
                      line={line}
                      isNew={i >= prevCountRef.current - 1}
                    />
                  );
                }
                if (
                  line.kind === "system" &&
                  line.text.includes("cycle done")
                ) {
                  return (
                    <CycleCard
                      key={line.id}
                      line={line}
                      cycleNum={cycleNumbers.get(line.id) ?? null}
                    />
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>

        {/* Status bar */}
        <StatusBar stats={stats} />
      </div>
    </main>
  );
}
