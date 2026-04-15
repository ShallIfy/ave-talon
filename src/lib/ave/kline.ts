// Helpers for kline / OHLCV data — market cap computation, volume aggregation.

import type { KlineCandle } from "./internal";

export interface McapPoint {
  t: number;
  mcap_open: number;
  mcap_high: number;
  mcap_low: number;
  mcap_close: number;
  volume: number;
}

/**
 * Compute 4 market cap points from one OHLC candle.
 * MCap = total_supply × price (exact formula from ave.ai frontend).
 */
export function computeMcap(
  totalSupply: number,
  candle: KlineCandle,
): McapPoint {
  return {
    t: candle.t,
    mcap_open: totalSupply * (candle.o ?? 0),
    mcap_high: totalSupply * (candle.h ?? 0),
    mcap_low: totalSupply * (candle.l ?? 0),
    mcap_close: totalSupply * (candle.c ?? 0),
    volume: candle.vol ?? 0,
  };
}

export function computeMcapSeries(
  totalSupply: number,
  candles: KlineCandle[],
): McapPoint[] {
  return candles.map((c) => computeMcap(totalSupply, c));
}

/**
 * Average volume per candle over the last N candles.
 * Used as denominator for "volume vs 1h avg" signal dimension.
 */
export function averageVolume(candles: KlineCandle[], lookback = 60): number {
  if (candles.length === 0) return 0;
  const window = candles.slice(-lookback);
  const total = window.reduce((sum, c) => sum + (c.vol ?? 0), 0);
  return total / window.length;
}

/**
 * Latest close price from candle series.
 */
export function latestPrice(candles: KlineCandle[]): number {
  if (candles.length === 0) return 0;
  return candles[candles.length - 1]?.c ?? 0;
}

/**
 * Price change % between first and last candle in the series.
 */
export function priceChangePct(candles: KlineCandle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0]?.c ?? 0;
  const last = candles[candles.length - 1]?.c ?? 0;
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}
