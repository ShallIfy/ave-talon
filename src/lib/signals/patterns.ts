// 10-pattern matcher for the signal matrix.
// Port of `classify_signal` from aveai/signals.py.

import type { SignalInput, SignalDimensions } from "./dimensions";
import { computeDimensions } from "./dimensions";

export type Confidence = "HIGH" | "MED" | "LOW" | "NONE";
export type Action =
  | "ENTRY"
  | "EXIT"
  | "WAIT"
  | "CAUTION"
  | "DANGER"
  | "NO_SIGNAL";

export interface SignalResult {
  number: number;       // 1..10
  name: string;
  confidence: Confidence;
  action: Action;

  // dimensions (same as SignalDimensions)
  holderGrowthPct: number;
  top10RatioDelta: number;
  above10UsdDelta: number;
  volumeVsAvg: number;
  priceChangePct: number;

  // context
  holdersCount: number;
  holdersAbove10Usd: number;
  top10Ratio: number;
  priceUsd: number;
  mcap: number;
  volume1hAvg: number;
}

/**
 * Signal Matrix — Optimized via grid search (optimize-thresholds.ts).
 *
 * Key finding: whale distribution (t10) and price momentum (pc) are the
 * strongest predictors. Holder growth and real-money count are secondary.
 * Volume threshold was lowered from 2x to 0.75x based on backtest data
 * showing 60% win rate vs 50% with old thresholds.
 *
 *   #1  Strong Entry     — top10 distributing -1.5%, vol 0.75x, price +10%
 *   #11 Early Entry      — accumulation phase, vol 0.8-1.5x, whale dist, pc flat
 *   #2  Wait             — holders +10%, top10 -1%, >$10 +5, vol <0.5x, price flat
 *   #3  FOMO Pump        — holders +50%, top10 flat, >$10 <+5, vol 5x, price +20%
 *   #4  Shakeout         — holders -2~-10%, top10 flat, >$10 +5, vol 1-2x, price -5~-15%
 *   #5  Exit Whale Stay  — holders -10%, top10 +2%, >$10 -10, vol 3x, price -20%
 *   #6  Full Dump        — holders -10%, top10 -2%, >$10 -10, vol 3x, price -20%
 *   #7  Sneak Entry      — holders flat, top10 -2%, >$10 +10, vol 0.5-2x, price flat
 *   #8  Divergence       — holders +10%, top10 -2%, >$10 +10, vol 2x, price -5%
 *   #9  No Signal        — everything flat
 *   #10 Pump & Whale Load— holders +50%, top10 +3%, >$10 +20, vol 5x, price +30%
 *
 * Order matters: most specific first.
 */
export function classifySignal(data: SignalInput): SignalResult {
  const d: SignalDimensions = computeDimensions(data);
  const hg = d.holderGrowthPct;
  const t10 = d.top10RatioDelta;
  const a10 = d.above10UsdDelta;
  const vol = d.volumeVsAvg;
  const pc = d.priceChangePct;

  const make = (
    number: number,
    name: string,
    confidence: Confidence,
    action: Action,
  ): SignalResult => ({
    number,
    name,
    confidence,
    action,
    holderGrowthPct: hg,
    top10RatioDelta: t10,
    above10UsdDelta: a10,
    volumeVsAvg: vol,
    priceChangePct: pc,
    holdersCount: data.holdersCount,
    holdersAbove10Usd: data.holdersAbove10Usd,
    top10Ratio: data.top10Ratio,
    priceUsd: data.priceUsd,
    mcap: data.mcap,
    volume1hAvg: data.volume1hAvg,
  });

  // #10: Pump & whale load — extreme growth + whale accumulating + huge volume
  if (hg > 50 && t10 > 3 && a10 > 20 && vol > 5 && pc > 30) {
    return make(10, "Pump & Whale Load", "HIGH", "CAUTION");
  }

  // #6: Danger — full dump, everyone exiting including whales
  if (hg < -10 && t10 < -2 && a10 < -10 && vol > 3 && pc < -20) {
    return make(6, "Full Dump", "HIGH", "DANGER");
  }

  // #5: Exit — holders fleeing but whales staying (top10 increasing)
  if (hg < -10 && t10 > 2 && a10 < -10 && vol > 3 && pc < -20) {
    return make(5, "Whale Stay Exit", "HIGH", "EXIT");
  }

  // #3: FOMO Pump — massive holder spike but >$10 holders NOT growing proportionally
  if (hg > 50 && vol > 5 && pc > 20) {
    const holderDelta = data.holdersCount - data.prevHoldersCount;
    if (holderDelta > 0 && a10 < holderDelta * 0.05) {
      return make(3, "FOMO Pump", "MED", "CAUTION");
    }
  }

  // #1: Strong Entry — whale distribution + price momentum + some volume
  // Optimized via grid search: t10 and pc are the binding constraints.
  // Old: hg>20, t10<-1, a10>10, vol>2, pc>10 (50% WR, EV=15.9)
  // New: hg>10, t10<-1.5, a10>3, vol>0.75, pc>10 (60% WR, EV=107.7)
  if (hg > 10 && t10 < -1.5 && a10 > 3 && vol > 0.75 && pc > 10) {
    return make(1, "Strong Entry", "HIGH", "ENTRY");
  }

  // #11: Early Entry — accumulation phase before volume spike
  // Bridges the gap between Wait (vol<0.5) and Strong Entry (vol>0.75).
  // Catches tokens with whale distribution + real money in quiet vol range.
  // Backtest: 24 signals, 58% WR, EV=140.8
  if (hg > 8 && t10 < -0.5 && a10 > 5 && vol >= 0.8 && vol <= 1.5 && pc > 0) {
    return make(11, "Early Entry", "MED", "ENTRY");
  }

  // #2: Wait — holders growing but no volume confirmation
  if (hg > 10 && t10 < -1 && a10 > 5 && vol < 0.5) {
    return make(2, "Wait (No Volume)", "LOW", "WAIT");
  }

  // #8: Divergence — holders bullish but price dropping
  if (hg > 10 && t10 < -2 && a10 > 10 && vol > 2 && pc < -5) {
    return make(8, "Divergence", "MED", "WAIT");
  }

  // #7: Sneak Entry — quiet accumulation by real money
  if (
    Math.abs(hg) <= 5 &&
    t10 < -2 &&
    a10 > 10 &&
    vol >= 0.5 &&
    vol <= 2 &&
    Math.abs(pc) <= 10
  ) {
    return make(7, "Sneak Entry", "MED", "ENTRY");
  }

  // #4: Shakeout — dust exiting but real money staying
  if (
    hg >= -10 &&
    hg <= -2 &&
    Math.abs(t10) <= 1 &&
    a10 > 5 &&
    vol >= 1 &&
    vol <= 2 &&
    pc >= -15 &&
    pc <= -5
  ) {
    return make(4, "Shakeout", "MED", "WAIT");
  }

  // #9: No Signal
  return make(9, "No Signal", "NONE", "NO_SIGNAL");
}

/**
 * Build a human-readable reasoning string from a signal's 5 dimensions.
 */
export function buildReasoning(sig: SignalResult): string {
  const parts: string[] = [];
  const { holderGrowthPct: hg, top10RatioDelta: t10, above10UsdDelta: a10,
    volumeVsAvg: vol, priceChangePct: pc } = sig;

  // holder growth
  if (hg > 50) parts.push(`holders SPIKE +${hg.toFixed(0)}%`);
  else if (hg > 20) parts.push(`holders up +${hg.toFixed(0)}%`);
  else if (hg < -10) parts.push(`holders DUMP ${hg.toFixed(0)}%`);
  else if (hg < -2) parts.push(`holders down ${hg.toFixed(0)}%`);

  // top10 ratio
  if (t10 < -3) parts.push(`top10 distributing ${t10.toFixed(1)}% (bullish)`);
  else if (t10 < -1) parts.push(`top10 down ${t10.toFixed(1)}%`);
  else if (t10 > 3) parts.push(`top10 whale load +${t10.toFixed(1)}% (bearish)`);
  else if (t10 > 1) parts.push(`top10 up +${t10.toFixed(1)}%`);

  // >$10 holders
  if (a10 > 20) parts.push(`real money +${a10} wallets`);
  else if (a10 > 5) parts.push(`>$10 holders +${a10}`);
  else if (a10 < -10) parts.push(`real money exiting ${a10}`);

  // volume
  if (vol > 5) parts.push(`volume SPIKE ${vol.toFixed(1)}x avg`);
  else if (vol > 2) parts.push(`volume active ${vol.toFixed(1)}x avg`);
  else if (vol < 0.5) parts.push(`volume quiet ${vol.toFixed(1)}x avg`);

  // price
  if (pc > 20) parts.push(`price PUMP +${pc.toFixed(1)}%`);
  else if (pc > 5) parts.push(`price up +${pc.toFixed(1)}%`);
  else if (pc < -20) parts.push(`price CRASH ${pc.toFixed(1)}%`);
  else if (pc < -5) parts.push(`price down ${pc.toFixed(1)}%`);

  return parts.length > 0 ? parts.join(" | ") : "flat, no significant movement";
}
