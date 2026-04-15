"use client";

// TokenTimeline — per-token phase story rendered under the main detail card.
// Each phase is a collapsed row showing: state indicator + label + duration +
// key deltas. Click to expand the raw samples table. The NOW phase (final,
// still-active phase) is auto-expanded and highlighted.

import { useState } from "react";
import type {
  PhaseStateLabel,
  PhaseSummary,
  TokenTimeline,
} from "@/lib/signals/timeline";
import { cn } from "@/lib/utils";

export interface TokenTimelineMeta {
  intervalUsed: string; // "1m" | "5m" | "1h" | "4h"
  lookbackUsed: number;
  ageHours: number | null;
}

interface Props {
  timeline: TokenTimeline | null;
  meta?: TokenTimelineMeta | null;
}

export function TokenTimeline({ timeline, meta }: Props) {
  // NOW phase auto-expanded by default, everything else collapsed.
  const nowId = timeline?.phases.at(-1)?.id;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(nowId ? [nowId] : []),
  );

  if (!timeline || timeline.phases.length === 0) {
    return (
      <div className="ave-card !p-4">
        <h3 className="section-header mb-3">Phase Timeline</h3>
        <div className="py-6 text-center text-[11px] text-[color:var(--muted-foreground)]">
          Not enough holder samples yet. Ave needs ~2 minutes of history.
        </div>
      </div>
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const durationH = (timeline.windowDurationMs / 3600000).toFixed(1);

  return (
    <div className="ave-card !p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="section-header">Phase Timeline</h3>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
          {timeline.phases.length} phase{timeline.phases.length === 1 ? "" : "s"}
          {" · "}
          {durationH}h window
          {" · "}
          {timeline.sampleCount}
          {timeline.downsampled ? `/${timeline.rawSampleCount}` : ""} samples
        </div>
      </div>

      <div className="divide-y divide-[color:var(--card-border)] border border-[color:var(--card-border)]">
        {timeline.phases.map((phase) => (
          <PhaseRow
            key={phase.id}
            phase={phase}
            isExpanded={expanded.has(phase.id)}
            onToggle={() => toggle(phase.id)}
          />
        ))}
      </div>

      <div className="mt-2 font-mono text-[10px] text-[color:var(--muted-foreground)]">
        {meta
          ? `Sampling ${meta.intervalUsed} × lookback ${meta.lookbackUsed} (${effectiveDeltaLabel(meta)} effective Δ${meta.ageHours != null ? ` · token ${formatAge(meta.ageHours)} old` : ""}). Pattern tag = most-common matrix match across the phase.`
          : "State derived from 5-sample holder slope. Pattern tag = most-common matrix match across the phase."}
      </div>
    </div>
  );
}

function PhaseRow({
  phase,
  isExpanded,
  onToggle,
}: {
  phase: PhaseSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const stateTheme = STATE_THEME[phase.state];
  const durationMin = phase.durationMs / 60000;
  const durationLabel =
    durationMin >= 60
      ? `${(durationMin / 60).toFixed(1)}h`
      : `${durationMin.toFixed(0)}m`;

  return (
    <div
      className={cn(
        "transition-colors",
        phase.isCurrent && "bg-[rgba(124,58,237,0.05)]",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.02]"
      >
        {/* State bar */}
        <div
          className={cn(
            "h-8 w-1 shrink-0 rounded-sm",
            stateTheme.bar,
          )}
        />

        {/* Chevron */}
        <span
          className={cn(
            "w-3 shrink-0 font-mono text-[10px] text-white/40 transition-transform",
            isExpanded && "rotate-90",
          )}
        >
          ▶
        </span>

        {/* Label + state tag */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-wider",
                stateTheme.text,
              )}
            >
              {phase.state}
            </span>
            <span className="truncate text-[13px] font-medium text-white">
              {phase.label}
            </span>
            {phase.isCurrent && (
              <span className="rounded-sm border border-[rgba(124,58,237,0.5)] bg-[rgba(124,58,237,0.15)] px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-[var(--ave-accent-bright)]">
                NOW
              </span>
            )}
            {phase.patternId !== 9 && (
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider",
                  confidenceTheme(phase.confidence),
                )}
                title={phase.patternName}
              >
                #{phase.patternId}
              </span>
            )}
            {(phase.capturedSignals?.length ?? 0) > 0 && (
              <span
                className="rounded-sm border border-[rgba(20,241,149,0.4)] bg-[rgba(20,241,149,0.1)] px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-emerald-300"
                title={`${phase.capturedSignals.length} captured by orchestrator`}
              >
                ★ {phase.capturedSignals.length}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--muted-foreground)]">
            {fmtTime(phase.startTs)} → {fmtTime(phase.endTs)}
            {"  ·  "}
            {durationLabel}
            {"  ·  "}
            {phase.sampleCount} pt
          </div>
        </div>

        {/* Delta summary — right-aligned, 4 key metrics */}
        <div className="hidden shrink-0 gap-4 font-mono text-[10px] md:flex">
          <Metric label="HLD" value={fmtPct(phase.holdersDeltaPct)} />
          <Metric label=">$10" value={fmtInt(phase.above10Delta)} />
          <Metric label="MCAP" value={fmtMcap(phase.mcapEnd)} />
          <Metric label="Δ" value={fmtPct(phase.mcapDeltaPct)} />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-[color:var(--card-border)] bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-wider text-white/60">
              {phase.sampleCount} sample{phase.sampleCount === 1 ? "" : "s"}
            </div>
            <div className="font-mono text-[10px] text-[color:var(--muted-foreground)]">
              {phase.reasoning}
            </div>
          </div>
          {(phase.capturedSignals?.length ?? 0) > 0 && (
            <div className="mb-3 space-y-1 border border-[rgba(20,241,149,0.25)] bg-[rgba(20,241,149,0.04)] p-2">
              <div className="font-mono text-[9px] uppercase tracking-wider text-emerald-300/80">
                Captured by orchestrator ({phase.capturedSignals.length})
              </div>
              {phase.capturedSignals.slice(0, 5).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 font-mono text-[10px] text-white/80"
                >
                  <span className="text-emerald-400">★</span>
                  <span className="text-white/50">{fmtTime(s.detectedAt)}</span>
                  <span className="font-medium">
                    #{s.patternId} {s.patternName}
                  </span>
                  <span
                    className={cn(
                      "rounded-sm border px-1 py-[1px] text-[8px] uppercase tracking-wider",
                      confidenceTheme(s.confidence),
                    )}
                  >
                    {s.confidence}
                  </span>
                  <span className="text-white/40">
                    score {s.score.toFixed(0)}
                  </span>
                </div>
              ))}
              {phase.capturedSignals.length > 5 && (
                <div className="font-mono text-[9px] text-white/40">
                  + {phase.capturedSignals.length - 5} more…
                </div>
              )}
            </div>
          )}
          <SampleTable samples={phase.samples} />
        </div>
      )}
    </div>
  );
}

function SampleTable({ samples }: { samples: PhaseSummary["samples"] }) {
  return (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full font-mono text-[10px]">
        <thead className="sticky top-0 bg-black/80">
          <tr className="text-left text-white/50">
            <th className="px-2 py-1 font-medium">Time</th>
            <th className="px-2 py-1 text-right font-medium">Holders</th>
            <th className="px-2 py-1 text-right font-medium">&gt;$10</th>
            <th className="px-2 py-1 text-right font-medium">Top10%</th>
            <th className="px-2 py-1 text-right font-medium">MCap</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s, i) => {
            const prev = i > 0 ? samples[i - 1] : null;
            const holdersDelta = prev ? s.holders - prev.holders : 0;
            const above10Delta = prev ? s.above10 - prev.above10 : 0;
            return (
              <tr
                key={s.time}
                className="border-t border-white/[0.04] text-white/80"
              >
                <td className="px-2 py-1 text-white/60">{fmtTime(s.time)}</td>
                <td className="px-2 py-1 text-right">
                  {s.holders}
                  {prev && holdersDelta !== 0 && (
                    <span
                      className={cn(
                        "ml-1 text-[9px]",
                        holdersDelta > 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {holdersDelta > 0 ? "+" : ""}
                      {holdersDelta}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right">
                  {s.above10}
                  {prev && above10Delta !== 0 && (
                    <span
                      className={cn(
                        "ml-1 text-[9px]",
                        above10Delta > 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {above10Delta > 0 ? "+" : ""}
                      {above10Delta}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right">
                  {s.top10Ratio.toFixed(1)}
                </td>
                <td className="px-2 py-1 text-right">{fmtMcap(s.mcapUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const tone = value.startsWith("+")
    ? "text-emerald-400"
    : value.startsWith("-")
      ? "text-red-400"
      : "text-white/70";
  return (
    <div className="flex flex-col items-end">
      <span className="text-[9px] uppercase tracking-wider text-white/40">
        {label}
      </span>
      <span className={cn("tabular-nums", tone)}>{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const STATE_THEME: Record<
  PhaseStateLabel,
  { bar: string; text: string }
> = {
  UP: {
    bar: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]",
    text: "text-emerald-400",
  },
  FLAT: {
    bar: "bg-white/40",
    text: "text-white/60",
  },
  DOWN: {
    bar: "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]",
    text: "text-red-400",
  },
};

function confidenceTheme(c: string): string {
  switch (c) {
    case "HIGH":
      return "border-emerald-400/50 bg-emerald-400/10 text-emerald-300";
    case "MED":
      return "border-amber-400/50 bg-amber-400/10 text-amber-300";
    case "LOW":
      return "border-slate-400/40 bg-slate-400/5 text-slate-300";
    default:
      return "border-white/15 bg-white/5 text-white/60";
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtPct(v: number): string {
  if (!isFinite(v) || v === 0) return "0%";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(v >= 100 || v <= -100 ? 0 : 1)}%`;
}

function fmtInt(v: number): string {
  if (v === 0) return "0";
  return v > 0 ? `+${v}` : String(v);
}

function fmtMcap(m: number): string {
  if (!m || !isFinite(m)) return "—";
  if (m >= 1e9) return `$${(m / 1e9).toFixed(2)}B`;
  if (m >= 1e6) return `$${(m / 1e6).toFixed(2)}M`;
  if (m >= 1e3) return `$${(m / 1e3).toFixed(1)}K`;
  return `$${m.toFixed(0)}`;
}

function effectiveDeltaLabel(meta: TokenTimelineMeta): string {
  // Convert the holder interval string to minutes, then multiply by lookback.
  const intervalMin = parseIntervalMinutes(meta.intervalUsed);
  const total = intervalMin * meta.lookbackUsed;
  if (total >= 60) return `${(total / 60).toFixed(total % 60 === 0 ? 0 : 1)}h`;
  return `${total}m`;
}

function parseIntervalMinutes(interval: string): number {
  if (interval.endsWith("h")) return parseInt(interval, 10) * 60;
  if (interval.endsWith("m")) return parseInt(interval, 10);
  return 1;
}

function formatAge(ageHours: number): string {
  if (ageHours < 1) return `${(ageHours * 60).toFixed(0)}m`;
  if (ageHours < 24) return `${ageHours.toFixed(1)}h`;
  return `${(ageHours / 24).toFixed(1)}d`;
}
