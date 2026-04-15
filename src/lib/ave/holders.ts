// Helpers for holder time-series — extracting deltas, identifying growth windows.

import type { HolderRatioPoint } from "./internal";

/**
 * Filter out pre-launch sentinel points (all fields = -1) that Ave returns
 * for early windows before a pump.fun token has real holders, AND normalize
 * the topN_ratio fields from 0-1 fractions to 0-100 percentages so the rest
 * of the codebase can use them directly in signal thresholds.
 */
export function cleanHolderSeries(
  series: HolderRatioPoint[],
): HolderRatioPoint[] {
  return series
    .filter(
      (p) =>
        (p.holders_count ?? -1) >= 0 &&
        (p.HoldersAbove10Usd ?? -1) >= 0 &&
        (p.top10_ratio ?? -1) >= 0,
    )
    .map((p) => ({
      ...p,
      top10_ratio: (p.top10_ratio ?? 0) * 100,
      top50_ratio: (p.top50_ratio ?? 0) * 100,
      top100_ratio: (p.top100_ratio ?? 0) * 100,
    }));
}

export interface HolderDeltaSummary {
  window: number; // number of samples in the comparison
  firstAt: number;
  lastAt: number;
  holdersCountStart: number;
  holdersCountEnd: number;
  holderGrowthPct: number;
  top10RatioStart: number;
  top10RatioEnd: number;
  top10RatioDelta: number;
  holdersAbove10Start: number;
  holdersAbove10End: number;
  holdersAbove10Delta: number;
}

/**
 * Compute delta between the oldest and newest point in a holder ratio series.
 * Returns null if series is too short.
 */
export function summarizeHolderDeltas(
  series: HolderRatioPoint[],
): HolderDeltaSummary | null {
  if (series.length < 2) return null;

  const first = series[0];
  const last = series[series.length - 1];

  const holdersStart = first.holders_count ?? 0;
  const holdersEnd = last.holders_count ?? 0;
  const holderGrowthPct =
    holdersStart > 0 ? ((holdersEnd - holdersStart) / holdersStart) * 100 : 0;

  return {
    window: series.length,
    firstAt: first.time ?? 0,
    lastAt: last.time ?? 0,
    holdersCountStart: holdersStart,
    holdersCountEnd: holdersEnd,
    holderGrowthPct: Number(holderGrowthPct.toFixed(2)),
    top10RatioStart: first.top10_ratio ?? 0,
    top10RatioEnd: last.top10_ratio ?? 0,
    top10RatioDelta: Number(
      ((last.top10_ratio ?? 0) - (first.top10_ratio ?? 0)).toFixed(2),
    ),
    holdersAbove10Start: first.HoldersAbove10Usd ?? 0,
    holdersAbove10End: last.HoldersAbove10Usd ?? 0,
    holdersAbove10Delta:
      (last.HoldersAbove10Usd ?? 0) - (first.HoldersAbove10Usd ?? 0),
  };
}

/**
 * Get the "current" and "previous" point from a series for signal detection.
 * Uses the last point as current and one N-back as previous.
 */
export function pickCurrPrev(
  series: HolderRatioPoint[],
  lookback = 1,
): { curr: HolderRatioPoint; prev: HolderRatioPoint } | null {
  if (series.length < 2) return null;
  const curr = series[series.length - 1];
  const prevIdx = Math.max(0, series.length - 1 - lookback);
  const prev = series[prevIdx];
  return { curr, prev };
}
