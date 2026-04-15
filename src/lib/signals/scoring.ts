// Confidence / score helpers for the signal engine.
// Maps SignalResult to a numeric 0..100 score + stable dimension weighting.

import type { SignalResult, Confidence } from "./patterns";

/**
 * Rough numeric score 0..100 for a signal. Used for ranking and UI gauges.
 *
 * Formula: base (from confidence) + bonuses for extreme dimension values.
 */
export function scoreSignal(sig: SignalResult): number {
  const base = confidenceToBase(sig.confidence);

  // Add directional bonus: good actions get extra, danger ones get penalized.
  let actionBonus = 0;
  switch (sig.action) {
    case "ENTRY":   actionBonus = 10; break;
    case "EXIT":    actionBonus = -10; break;
    case "DANGER":  actionBonus = -20; break;
    case "CAUTION": actionBonus = -5;  break;
    case "WAIT":    actionBonus = 0;   break;
    case "NO_SIGNAL": actionBonus = -15; break;
  }

  // Magnitude bonus: normalized contribution from each dimension.
  const magnitude =
    Math.min(Math.abs(sig.holderGrowthPct) / 50, 1) * 5 +
    Math.min(Math.abs(sig.top10RatioDelta) / 3, 1) * 5 +
    Math.min(Math.abs(sig.above10UsdDelta) / 20, 1) * 5 +
    Math.min(Math.abs(sig.volumeVsAvg - 1) / 5, 1) * 5 +
    Math.min(Math.abs(sig.priceChangePct) / 30, 1) * 5;

  const raw = base + actionBonus + magnitude;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function confidenceToBase(c: Confidence): number {
  switch (c) {
    case "HIGH": return 75;
    case "MED":  return 55;
    case "LOW":  return 35;
    case "NONE": return 15;
  }
}

/**
 * 5-dimension vector normalized to [-1, 1] for visualization (radar chart).
 */
export function scoreDimensions(sig: SignalResult): {
  holderGrowth: number;
  top10Concentration: number;  // NEGATED — positive means distribution (bullish)
  realMoney: number;
  volume: number;
  price: number;
} {
  return {
    holderGrowth: clamp(sig.holderGrowthPct / 50, -1, 1),
    top10Concentration: clamp(-sig.top10RatioDelta / 3, -1, 1),
    realMoney: clamp(sig.above10UsdDelta / 20, -1, 1),
    volume: clamp((sig.volumeVsAvg - 1) / 4, -1, 1),
    price: clamp(sig.priceChangePct / 30, -1, 1),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
