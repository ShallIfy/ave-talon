// Main entry point: detect a signal from an AveSnapshot.
//
// Glues together:
//   - Holder ratio series (dims 1-3)
//   - Kline / mcap (dims 4-5)
// into a SignalInput and runs the pattern classifier.

import type { AveSnapshot } from "../ave/snapshot";
import type { SignalInput } from "./dimensions";
import { classifySignal, buildReasoning, type SignalResult } from "./patterns";
import { scoreSignal, scoreDimensions } from "./scoring";

export interface DetectedSignal {
  signal: SignalResult;
  score: number;               // 0..100 numeric
  reasoning: string;           // human-readable
  dimensionsNormalized: ReturnType<typeof scoreDimensions>;
  dimension: string;           // primary dimension that dominated (for DB)
}

const DIMENSION_NAMES = [
  "holder_growth",
  "top10_delta",
  "holders_gt10",
  "volume",
  "price",
] as const;

/**
 * Infer the dominant dimension for a signal (used when persisting to DB).
 * Picks the dimension with the largest absolute normalized contribution.
 */
function pickPrimaryDimension(sig: SignalResult): string {
  const d = scoreDimensions(sig);
  const pairs: Array<[string, number]> = [
    [DIMENSION_NAMES[0], Math.abs(d.holderGrowth)],
    [DIMENSION_NAMES[1], Math.abs(d.top10Concentration)],
    [DIMENSION_NAMES[2], Math.abs(d.realMoney)],
    [DIMENSION_NAMES[3], Math.abs(d.volume)],
    [DIMENSION_NAMES[4], Math.abs(d.price)],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][0];
}

/**
 * Detect signal from a snapshot. Returns #9 "No Signal" if data is insufficient.
 *
 * @param snapshot Pre-built AveSnapshot (holder series + klines)
 * @param lookback Index lookback for "previous" holder point. Default 5 samples.
 */
export function detectSignalFromSnapshot(
  snapshot: AveSnapshot,
  lookback = 5,
): DetectedSignal {
  const series = snapshot.holderSeries;
  const klines = snapshot.klines;

  // Not enough data — return no-signal result.
  if (series.length < 2 || klines.length < 2) {
    const sig = classifySignal(emptyInput(snapshot));
    return {
      signal: sig,
      score: scoreSignal(sig),
      reasoning: "insufficient data (need ≥2 holder samples + ≥2 candles)",
      dimensionsNormalized: scoreDimensions(sig),
      dimension: "holder_growth",
    };
  }

  // Pick curr / prev holder points
  const curr = series[series.length - 1];
  const prevIdx = Math.max(0, series.length - 1 - lookback);
  const prev = series[prevIdx];

  const latestCandle = klines[klines.length - 1];
  const prevCandle = klines[Math.max(0, klines.length - 2)];

  const input: SignalInput = {
    holdersCount: curr.holders_count ?? 0,
    holdersAbove10Usd: curr.HoldersAbove10Usd ?? 0,
    top10Ratio: curr.top10_ratio ?? 0,
    priceUsd: latestCandle.c ?? 0,
    volume: latestCandle.vol ?? 0,
    volume1hAvg: snapshot.volume1hAvg,
    mcap:
      snapshot.totalSupply && latestCandle.c
        ? snapshot.totalSupply * latestCandle.c
        : 0,

    prevHoldersCount: prev.holders_count ?? 0,
    prevHoldersAbove10Usd: prev.HoldersAbove10Usd ?? 0,
    prevTop10Ratio: prev.top10_ratio ?? 0,
    prevPriceUsd: prevCandle.c ?? 0,

    tokenAddress: snapshot.token,
    symbol: snapshot.symbol ?? undefined,
    chain: snapshot.chain,
  };

  const sig = classifySignal(input);
  return {
    signal: sig,
    score: scoreSignal(sig),
    reasoning: buildReasoning(sig),
    dimensionsNormalized: scoreDimensions(sig),
    dimension: pickPrimaryDimension(sig),
  };
}

function emptyInput(snapshot: AveSnapshot): SignalInput {
  return {
    holdersCount: 0,
    holdersAbove10Usd: 0,
    top10Ratio: 0,
    priceUsd: snapshot.latestPriceUsd,
    volume: 0,
    volume1hAvg: 0,
    mcap: 0,
    prevHoldersCount: 0,
    prevHoldersAbove10Usd: 0,
    prevTop10Ratio: 0,
    prevPriceUsd: 0,
    tokenAddress: snapshot.token,
    symbol: snapshot.symbol ?? undefined,
    chain: snapshot.chain,
  };
}

/**
 * Backtest: classify every consecutive pair in a holder series against the
 * matching kline window. Returns one DetectedSignal per sample (except the first).
 *
 * Useful for: `/signals` history, scoring individual tokens over time,
 * demoing the matrix on historical snapshots.
 */
export function backtestSnapshotSeries(
  holderSeries: AveSnapshot["holderSeries"],
  klines: AveSnapshot["klines"],
  totalSupply: number,
  tokenAddress: string,
  symbol?: string,
  chain = "solana",
  intervalMinutes = 5,
): DetectedSignal[] {
  if (holderSeries.length < 2 || klines.length < 2) return [];

  // Align klines by time to each holder sample (closest-before lookup).
  const alignedCandles = holderSeries.map((h) => {
    const t = h.time;
    let best = klines[0];
    for (const c of klines) {
      if (c.t <= t) best = c;
      else break;
    }
    return best;
  });

  const lookback = Math.max(1, Math.floor(60 / intervalMinutes));
  const results: DetectedSignal[] = [];

  for (let i = 1; i < holderSeries.length; i++) {
    const curr = holderSeries[i];
    const prev = holderSeries[i - 1];
    const currCandle = alignedCandles[i];
    const prevCandle = alignedCandles[i - 1];

    // Rolling volume average over last `lookback` candles
    const window = alignedCandles.slice(Math.max(0, i - lookback), i);
    const avgVol =
      window.length > 0
        ? window.reduce((s, c) => s + (c.vol ?? 0), 0) / window.length
        : 0;

    const input: SignalInput = {
      holdersCount: curr.holders_count ?? 0,
      holdersAbove10Usd: curr.HoldersAbove10Usd ?? 0,
      top10Ratio: curr.top10_ratio ?? 0,
      priceUsd: currCandle?.c ?? 0,
      volume: currCandle?.vol ?? 0,
      volume1hAvg: avgVol,
      mcap: totalSupply * (currCandle?.c ?? 0),

      prevHoldersCount: prev.holders_count ?? 0,
      prevHoldersAbove10Usd: prev.HoldersAbove10Usd ?? 0,
      prevTop10Ratio: prev.top10_ratio ?? 0,
      prevPriceUsd: prevCandle?.c ?? 0,

      tokenAddress,
      symbol,
      chain,
    };

    const sig = classifySignal(input);
    results.push({
      signal: sig,
      score: scoreSignal(sig),
      reasoning: buildReasoning(sig),
      dimensionsNormalized: scoreDimensions(sig),
      dimension: pickPrimaryDimension(sig),
    });
  }

  return results;
}
