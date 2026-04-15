// 5-dimension computation for the signal matrix.
// Port of `compute_deltas` from aveai/signals.py.

export interface SignalInput {
  // Current values
  holdersCount: number;
  holdersAbove10Usd: number;
  top10Ratio: number;   // percentage, e.g. 12.5
  priceUsd: number;
  volume: number;       // volume in current candle/period
  volume1hAvg: number;  // average volume per candle over last 1h
  mcap: number;

  // Previous values (prior poll / prior candle)
  prevHoldersCount: number;
  prevHoldersAbove10Usd: number;
  prevTop10Ratio: number;
  prevPriceUsd: number;

  // Metadata
  tokenAddress?: string;
  symbol?: string;
  chain?: string;
}

export interface SignalDimensions {
  holderGrowthPct: number;
  top10RatioDelta: number;
  above10UsdDelta: number;
  volumeVsAvg: number;
  priceChangePct: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute the 5 signal dimensions from raw data.
 */
export function computeDimensions(data: SignalInput): SignalDimensions {
  // Dim 1: holder growth %
  const holderGrowthPct =
    data.prevHoldersCount > 0
      ? ((data.holdersCount - data.prevHoldersCount) / data.prevHoldersCount) * 100
      : 0;

  // Dim 2: top10 ratio delta (percentage points)
  const top10RatioDelta = data.top10Ratio - data.prevTop10Ratio;

  // Dim 3: >$10 holders delta (absolute)
  const above10UsdDelta = data.holdersAbove10Usd - data.prevHoldersAbove10Usd;

  // Dim 4: volume vs 1h avg
  const volumeVsAvg =
    data.volume1hAvg > 0 ? data.volume / data.volume1hAvg : 1.0;

  // Dim 5: price change %
  const priceChangePct =
    data.prevPriceUsd > 0
      ? ((data.priceUsd - data.prevPriceUsd) / data.prevPriceUsd) * 100
      : 0;

  return {
    holderGrowthPct: round2(holderGrowthPct),
    top10RatioDelta: round2(top10RatioDelta),
    above10UsdDelta,
    volumeVsAvg: round2(volumeVsAvg),
    priceChangePct: round2(priceChangePct),
  };
}
