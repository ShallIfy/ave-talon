"use client";

// Dashboard top KPI strip — 5 cells: Win Rate, Active Entries, Entry Performance,
// Scanner, Agent Status.

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

const ENTRY_PATTERNS = [1, 7, 11];
type Period = "24h" | "7d";

interface PatternWR {
  patternId: number;
  name: string;
  total: number;
  wins: number;
  wr: number;
}

interface StatsData {
  period: string;
  overall: { total: number; wins: number; wr: number };
  byPattern: PatternWR[];
  hourly: number[];
}

interface LiveSignalRow {
  mint: string;
  symbol: string | null;
  patternId: number;
  patternName: string;
  score: number;
  detectedAt: number;
}

interface OrchestratorStatus {
  running: boolean;
  cycles: {
    total: number;
    lastAt: number;
    lastDurationMs: number;
    nextAt: number;
    inflight: boolean;
  };
  totals: {
    tokensScanned: number;
    signalsDetected: number;
    signalsPersisted: number;
    dedupSkipped: number;
    errors: number;
  };
}

interface PulseState {
  stats: StatsData | null;
  orch: OrchestratorStatus | null;
  entries: LiveSignalRow[];
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyStatus(
  orch: OrchestratorStatus | null,
): "scanning" | "monitoring" | "offline" {
  if (!orch || !orch.running) return "offline";
  if (orch.cycles.inflight) return "scanning";
  return "monitoring";
}

function wrColor(wr: number) {
  if (wr >= 60) return "var(--ave-accent-bright)";
  if (wr >= 40) return "rgba(250,204,21,0.85)";
  return "rgba(248,113,113,0.85)";
}

function wrBg(wr: number) {
  if (wr >= 60) return "rgba(124,58,237,0.12)";
  if (wr >= 40) return "rgba(250,204,21,0.08)";
  return "rgba(248,113,113,0.08)";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PeriodToggle({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[3px] border border-white/[0.06]">
      {(["24h", "7d"] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-2 py-[2px] font-mono text-[8px] uppercase tracking-[0.12em] transition-all",
            value === p
              ? "bg-[var(--ave-accent)]/20 text-[var(--ave-accent-bright)]"
              : "text-white/20 hover:text-white/35",
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function CellLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="stat-label mb-2 select-none text-[9px] tracking-[0.18em]">
      {children}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[2px] bg-white/[0.04]",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PulseStrip() {
  const [period, setPeriod] = useState<Period>("24h");
  const [state, setState] = useState<PulseState>({
    stats: null,
    orch: null,
    entries: [],
    loading: true,
  });
  const [nowTick, setNowTick] = useState(Date.now());

  const load = useCallback(
    async (p: Period, cancel: { current: boolean }) => {
      try {
        const [statsRes, orchRes, liveRes] = await Promise.all([
          fetch(`/api/agent/stats?period=${p}`),
          fetch("/api/agent/orchestrator"),
          fetch("/api/agent/live-signals?limit=100&offset=0"),
        ]);
        const stats: StatsData = await statsRes.json();
        const orch: OrchestratorStatus = await orchRes.json();
        const live = await liveRes.json();
        const allSignals = (live.signals ?? []) as LiveSignalRow[];
        const entries = allSignals.filter((s) =>
          ENTRY_PATTERNS.includes(s.patternId),
        );
        if (!cancel.current) {
          setState({ stats, orch, entries, loading: false });
        }
      } catch {
        if (!cancel.current) setState((s) => ({ ...s, loading: false }));
      }
    },
    [],
  );

  useEffect(() => {
    const cancel = { current: false };
    load(period, cancel);
    const id = setInterval(() => load(period, cancel), 10_000);
    const tickId = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      cancel.current = true;
      clearInterval(id);
      clearInterval(tickId);
    };
  }, [period, load]);

  const { stats, orch, entries } = state;
  const status = classifyStatus(orch);

  const nextInMs = orch ? Math.max(0, orch.cycles.nextAt - nowTick) : 0;
  const nextLabel =
    !orch || !orch.running
      ? "off"
      : orch.cycles.inflight
        ? "scanning..."
        : nextInMs < 1000
          ? "soon"
          : `${Math.ceil(nextInMs / 60000)}m`;

  const entryPatterns = (stats?.byPattern ?? []).filter((p) =>
    [1, 7, 11].includes(p.patternId),
  );

  return (
    <div className="grid grid-cols-2 gap-px sm:grid-cols-5">
      {/* ── Cell 1: Win Rate ── */}
      <div className="stat-card flex flex-col">
        <div className="flex items-center justify-between">
          <CellLabel>Win Rate</CellLabel>
          <PeriodToggle value={period} onChange={setPeriod} />
        </div>
        {state.loading ? (
          <Skeleton className="mt-1 h-8 w-24" />
        ) : (
          <>
            <span
              className="stat-value-xl tabular-nums"
              style={{
                color:
                  stats && stats.overall.total > 0
                    ? wrColor(stats.overall.wr)
                    : "rgba(255,255,255,0.2)",
              }}
            >
              {stats && stats.overall.total > 0
                ? `${Math.round(stats.overall.wr * 10) / 10}%`
                : "—"}
            </span>
            <span className="mt-1.5 font-mono text-[10px] tabular-nums text-white/25">
              {stats && stats.overall.total > 0
                ? `${stats.overall.wins}W  /  ${stats.overall.total}`
                : "awaiting data"}
            </span>
          </>
        )}
      </div>

      {/* ── Cell 2: Active Entries ── */}
      <div className="stat-card flex flex-col">
        <CellLabel>Active Entries</CellLabel>
        {state.loading ? (
          <Skeleton className="mt-1 h-8 w-10" />
        ) : (
          <span
            className={cn(
              "stat-value-xl tabular-nums",
              entries.length > 0
                ? "text-[var(--ave-accent-bright)]"
                : "text-white/20",
            )}
          >
            {entries.length}
          </span>
        )}
      </div>

      {/* ── Cell 3: Entry Performance ── */}
      <div className="stat-card flex flex-col">
        <CellLabel>Entry Performance</CellLabel>
        {state.loading ? (
          <Skeleton className="mt-1 h-12 w-full" />
        ) : entryPatterns.length === 0 ? (
          <span className="mt-1 font-mono text-[10px] text-white/20">
            no data yet
          </span>
        ) : (
          <div className="flex flex-col gap-[7px]">
            {entryPatterns.map((p) => {
              const color = wrColor(p.wr);
              return (
                <div key={p.patternId} className="flex items-center gap-2">
                  <span className="w-[42px] shrink-0 font-mono text-[9px] font-medium tracking-wide text-white/35">
                    {p.name.replace(" Entry", "")}
                  </span>
                  <div className="relative h-[5px] flex-1 overflow-hidden bg-white/[0.04]">
                    <div
                      className="absolute inset-y-0 left-0 transition-all duration-500"
                      style={{
                        width: `${Math.min(100, p.wr)}%`,
                        background: wrBg(p.wr),
                        boxShadow: `inset 0 0 0 1px ${color}`,
                      }}
                    />
                  </div>
                  <span
                    className="w-[30px] shrink-0 text-right font-mono text-[9px] tabular-nums font-medium"
                    style={{ color }}
                  >
                    {p.total > 0 ? `${Math.round(p.wr)}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Cell 4: Scanner ── */}
      <div className="stat-card flex flex-col">
        <CellLabel>Scanner</CellLabel>
        {state.loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-[18px] font-medium tabular-nums leading-none",
                  orch?.cycles.inflight
                    ? "text-[var(--ave-accent-bright)]"
                    : "text-white/90",
                )}
              >
                {orch ? `#${orch.cycles.total}` : "—"}
              </span>
              {orch && (
                <span className="font-mono text-[10px] text-white/25">
                  {nextLabel}
                </span>
              )}
            </div>
            {orch && (
              <span className="mt-1.5 font-mono text-[10px] tabular-nums text-white/25">
                {orch.totals.tokensScanned.toLocaleString()} scanned
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Cell 5: Agent Status ── */}
      <div className="stat-card flex flex-col">
        <CellLabel>Status</CellLabel>
        {state.loading ? (
          <Skeleton className="mt-1 h-8 w-20" />
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              {status === "scanning" && (
                <span className="absolute inset-0 animate-ping rounded-full bg-[var(--ave-accent-bright)] opacity-50" />
              )}
              <span
                className={cn(
                  "relative h-2.5 w-2.5 rounded-full",
                  status === "scanning"
                    ? "bg-[var(--ave-accent-bright)] shadow-[0_0_8px_var(--ave-accent)]"
                    : status === "monitoring"
                      ? "bg-[var(--ave-accent)] shadow-[0_0_6px_var(--ave-accent-dim)]"
                      : "bg-red-400/50",
                )}
              />
            </span>
            <span
              className={cn(
                "font-mono text-[13px] font-medium uppercase tracking-[0.14em]",
                status === "offline" ? "text-white/30" : "text-white/80",
              )}
            >
              {status === "scanning"
                ? "Scanning"
                : status === "monitoring"
                  ? "Active"
                  : "Offline"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
