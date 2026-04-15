// Phase Timeline — collapse holder time series into classified phases.
//
// Input: AveSnapshot (with holderSeries + klines).
// Output: TokenTimeline = Phase[] where consecutive samples sharing the
// same "state" (UP / FLAT / DOWN derived from local 5-sample holder delta)
// are grouped into a single phase row with delta summary + raw samples
// for drill-down.
//
// Why state-based grouping (not matrix patternId)?
//   The 10-pattern matrix has strict magnitude thresholds designed for
//   per-scan-cycle detection. Applied to a dense 1-minute series, most
//   windows fall through to #9 "No Signal" because nothing moves fast
//   enough. Phase storytelling needs slope changes (growth → plateau →
//   bleed) which are naturally captured by the sign of local deltas.
//
// Classification uses lookback=5 (matches detectSignalFromSnapshot). The
// matrix pattern IS still recorded per phase as a secondary context tag
// (most-common pattern across the phase's samples).

import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { HolderRatioPoint, KlineCandle } from "@/lib/ave/internal";
import { classifySignal, type SignalResult } from "./patterns";
import type { SignalInput } from "./dimensions";

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface PhaseSample {
  time: number; // unix seconds
  holders: number;
  above10: number; // >$10 holder count
  top10Ratio: number; // percentage
  priceUsd: number;
  mcapUsd: number; // totalSupply * priceUsd (== FDV for pump.fun tokens)
}

export type DominantDim =
  | "holderGrowth"
  | "top10"
  | "realMoney"
  | "volume"
  | "price";

export type PhaseStateLabel = "UP" | "FLAT" | "DOWN";

// A signal that was captured by the orchestrator at the moment it fired,
// persisted to DB, and now re-attached to the phase it belongs in. Source
// of truth for "did this token ever hit this pattern?" — way more reliable
// than live re-classification against a stale holder window.
export interface CapturedSignal {
  id: string;
  detectedAt: number; // unix seconds
  patternId: number;
  patternName: string;
  confidence: "HIGH" | "MED" | "LOW" | "NONE";
  score: number;
  source: string; // orchestrator | manual | chat
  cycleId: string | null;
}

export interface PhaseSummary {
  id: string;
  state: PhaseStateLabel; // derived from local holder slope
  patternId: number; // 1..10 — most-common matrix pattern across samples
  patternName: string;
  confidence: "HIGH" | "MED" | "LOW" | "NONE";
  action: string;
  // Real orchestrator captures that land inside this phase's time window.
  // If any captured signals exist, they take precedence over live re-
  // classification for the phase's representative badge.
  capturedSignals: CapturedSignal[];

  // Time range
  startTs: number;
  endTs: number;
  durationMs: number;

  // Samples
  sampleCount: number;
  samples: PhaseSample[]; // raw samples inside the phase (for expand)

  // Aggregate deltas (start vs end)
  holdersStart: number;
  holdersEnd: number;
  holdersDeltaPct: number;

  above10Start: number;
  above10End: number;
  above10Delta: number;

  top10Start: number;
  top10End: number;
  top10Delta: number;

  priceStart: number;
  priceEnd: number;
  priceDeltaPct: number;

  mcapStart: number;
  mcapEnd: number;
  mcapDeltaPct: number;

  // Interpretation
  dominantDim: DominantDim;
  label: string; // short phase label, e.g. "Launch", "Bleed", "Plateau"
  reasoning: string; // one-line summary

  isCurrent: boolean; // true for the final (most recent) phase
}

export interface TokenTimeline {
  phases: PhaseSummary[];
  rawSampleCount: number;
  sampleCount: number; // after optional downsample
  downsampled: boolean;
  windowStart: number; // unix seconds
  windowEnd: number;
  windowDurationMs: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const MAX_SAMPLES = 500;
const DEFAULT_LOOKBACK = 5; // samples back — matches detectSignalFromSnapshot

// ───────────────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────────────

export function buildPhaseTimeline(
  snapshot: AveSnapshot,
  capturedSignals: CapturedSignal[] = [],
  lookback: number = DEFAULT_LOOKBACK,
): TokenTimeline {
  const rawSeries = snapshot.holderSeries;
  const klines = snapshot.klines;
  const rawCount = rawSeries.length;

  if (rawCount < 2 || klines.length < 2) {
    return emptyTimeline(rawCount);
  }

  // 1. Downsample if over the cap.
  const series = downsample(rawSeries, MAX_SAMPLES);
  const downsampled = series.length < rawCount;

  // 2. Align each holder sample to the closest-before kline candle so we
  //    have a price at every holder tick.
  const alignedCandles = alignCandlesToSamples(series, klines);

  // 3. Classify every sample against series[i - lookback] (clamped at 0).
  const classifications = classifyEachSample(
    series,
    alignedCandles,
    snapshot.totalSupply ?? 0,
    snapshot.volume1hAvg,
    snapshot.token,
    snapshot.symbol ?? undefined,
    snapshot.chain,
    lookback,
  );

  // 4. Group consecutive same-pattern samples into phases.
  const phases = groupIntoPhases(
    series,
    alignedCandles,
    classifications,
    snapshot.totalSupply ?? 0,
  );

  // 5. Attach captured orchestrator signals to phases by time overlap.
  //    Captured signals are the source of truth — they represent actual
  //    historical matrix pattern firings that the orchestrator locked in
  //    at the moment they happened. Live re-classification may miss them
  //    because the holder window has since moved on.
  attachCapturedSignals(phases, capturedSignals);

  const windowStart = series[0].time;
  const windowEnd = series[series.length - 1].time;

  return {
    phases,
    rawSampleCount: rawCount,
    sampleCount: series.length,
    downsampled,
    windowStart,
    windowEnd,
    windowDurationMs: (windowEnd - windowStart) * 1000,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Downsample (nth-sampling, preserves last sample)
// ───────────────────────────────────────────────────────────────────────────

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  // Always include the final sample (NOW) even if nth-sampling skipped it.
  const last = arr[arr.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Kline alignment — nearest-before price per holder sample
// ───────────────────────────────────────────────────────────────────────────

function alignCandlesToSamples(
  series: HolderRatioPoint[],
  klines: KlineCandle[],
): KlineCandle[] {
  return series.map((h) => {
    let best = klines[0];
    for (const c of klines) {
      if (c.t <= h.time) best = c;
      else break;
    }
    return best;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Per-sample classification with 5-sample lookback
// ───────────────────────────────────────────────────────────────────────────

type PhaseState = PhaseStateLabel;

// State thresholds: tuned for 5-minute holder growth windows.
// UP    : ≥ +8% holder growth over 5 samples  → launching / accumulating
// DOWN  : ≤ -5% holder growth over 5 samples  → bleeding / distribution
// FLAT  : anything in between                 → plateau / consolidation
//
// Deliberately wider than detector thresholds so phase segmentation is
// stable (fewer tiny blips). Detector still classifies per cycle using the
// 10-pattern matrix — that's a separate concern.
const STATE_UP_PCT = 8;
const STATE_DOWN_PCT = -5;

interface SampleClassification {
  idx: number; // index in downsampled series
  result: SignalResult;
  state: PhaseState;
  hgPct: number; // holder growth % vs 5-sample lookback
}

function deriveState(hgPct: number): PhaseState {
  if (hgPct >= STATE_UP_PCT) return "UP";
  if (hgPct <= STATE_DOWN_PCT) return "DOWN";
  return "FLAT";
}

function classifyEachSample(
  series: HolderRatioPoint[],
  alignedCandles: KlineCandle[],
  totalSupply: number,
  volume1hAvg: number,
  tokenAddress: string,
  symbol: string | undefined,
  chain: string,
  lookback: number,
): SampleClassification[] {
  const out: SampleClassification[] = [];

  for (let i = 1; i < series.length; i++) {
    const curr = series[i];
    const prevIdx = Math.max(0, i - lookback);
    const prev = series[prevIdx];
    const currCandle = alignedCandles[i];
    const prevCandle = alignedCandles[prevIdx];

    const input: SignalInput = {
      holdersCount: curr.holders_count ?? 0,
      holdersAbove10Usd: curr.HoldersAbove10Usd ?? 0,
      top10Ratio: curr.top10_ratio ?? 0,
      priceUsd: currCandle?.c ?? 0,
      volume: currCandle?.vol ?? 0,
      volume1hAvg,
      mcap: totalSupply * (currCandle?.c ?? 0),

      prevHoldersCount: prev.holders_count ?? 0,
      prevHoldersAbove10Usd: prev.HoldersAbove10Usd ?? 0,
      prevTop10Ratio: prev.top10_ratio ?? 0,
      prevPriceUsd: prevCandle?.c ?? 0,

      tokenAddress,
      symbol,
      chain,
    };

    const prevH = prev.holders_count ?? 0;
    const currH = curr.holders_count ?? 0;
    const hgPct = prevH > 0 ? ((currH - prevH) / prevH) * 100 : 0;
    const state = deriveState(hgPct);

    out.push({
      idx: i,
      result: classifySignal(input),
      state,
      hgPct,
    });
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Group consecutive same-pattern classifications into phases
// ───────────────────────────────────────────────────────────────────────────

// Minimum samples per phase before smoothing pass runs. Phases shorter than
// this get absorbed into the previous phase (unless they're the first one).
// 5 samples = 5 min with 1m holder interval.
const MIN_PHASE_SAMPLES = 5;

interface RawPhase {
  state: PhaseState;
  startClassIdx: number; // index into classifications[]
  endClassIdx: number;
}

function groupIntoPhases(
  series: HolderRatioPoint[],
  alignedCandles: KlineCandle[],
  classifications: SampleClassification[],
  totalSupply: number,
): PhaseSummary[] {
  if (classifications.length === 0) return [];

  // 1. Segment by state (UP / FLAT / DOWN) — consecutive same-state samples.
  const raw: RawPhase[] = [];
  let cur: RawPhase = {
    state: classifications[0].state,
    startClassIdx: 0,
    endClassIdx: 0,
  };
  for (let i = 1; i < classifications.length; i++) {
    const c = classifications[i];
    if (c.state === cur.state) {
      cur.endClassIdx = i;
      continue;
    }
    raw.push(cur);
    cur = { state: c.state, startClassIdx: i, endClassIdx: i };
  }
  raw.push(cur);

  // 2. Smooth: absorb short phases into the previous one so we don't get
  //    fragmentation from one-sample blips. Keep first phase intact so the
  //    timeline always starts where it starts.
  const smoothed: RawPhase[] = [];
  for (const p of raw) {
    const length = p.endClassIdx - p.startClassIdx + 1;
    if (length < MIN_PHASE_SAMPLES && smoothed.length > 0) {
      // Extend the previous phase through this one's end (keeps previous
      // phase's state, effectively ignoring the short blip).
      smoothed[smoothed.length - 1].endClassIdx = p.endClassIdx;
      continue;
    }
    smoothed.push({ ...p });
  }

  // 3. Merge adjacent same-state phases. After smoothing, a FLAT → short-UP
  //    (absorbed) → FLAT sequence still leaves two FLAT phases split in the
  //    smoothed array. Collapse them here.
  const merged: RawPhase[] = [];
  for (const p of smoothed) {
    const prev = merged[merged.length - 1];
    if (prev && prev.state === p.state) {
      prev.endClassIdx = p.endClassIdx;
      continue;
    }
    merged.push({ ...p });
  }

  // 4. Build phase summaries.
  const phases: PhaseSummary[] = [];
  for (let i = 0; i < merged.length; i++) {
    const p = merged[i];
    const phaseClassifications = classifications.slice(
      p.startClassIdx,
      p.endClassIdx + 1,
    );
    const startSeriesIdx = Math.max(
      0,
      classifications[p.startClassIdx].idx - 1, // include the "from" sample
    );
    const endSeriesIdx = classifications[p.endClassIdx].idx;
    const isCurrent = i === merged.length - 1;

    phases.push(
      buildPhaseSummary(
        i,
        phaseClassifications,
        p.state,
        series,
        alignedCandles,
        totalSupply,
        startSeriesIdx,
        endSeriesIdx,
        isCurrent,
      ),
    );
  }

  return phases;
}

// Pick the representative matrix pattern for a phase's badge.
//
// Signal patterns (#1..#8, #10) are sparse inside a dense 1-minute series:
// a launch phase with 20 samples may only fire "Strong Entry" for 2-3 ticks
// at the actual moment of breakout. If we just picked the MOST-COMMON
// pattern, those short bursts get outvoted by the surrounding #9 "No
// Signal" samples and the phase badge shows nothing interesting.
//
// Instead: scan the phase for any non-#9 pattern that hits at least
// MIN_PATTERN_SAMPLES times, and rank them by (confidence, count). Only
// fall back to #9 if no meaningful pattern was detected anywhere in the
// phase.
const MIN_PATTERN_SAMPLES = 2;
const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 3,
  MED: 2,
  LOW: 1,
  NONE: 0,
};

function pickRepresentativePattern(
  phaseClassifications: SampleClassification[],
): SignalResult {
  const counts = new Map<
    number,
    { count: number; result: SignalResult }
  >();
  for (const c of phaseClassifications) {
    const existing = counts.get(c.result.number);
    if (existing) {
      existing.count++;
      // Keep the highest-confidence exemplar for this pattern number.
      if (
        CONFIDENCE_RANK[c.result.confidence] >
        CONFIDENCE_RANK[existing.result.confidence]
      ) {
        existing.result = c.result;
      }
    } else {
      counts.set(c.result.number, { count: 1, result: c.result });
    }
  }

  // Gather meaningful non-#9 patterns.
  const informative: Array<{ count: number; result: SignalResult }> = [];
  for (const entry of counts.values()) {
    if (entry.result.number === 9) continue;
    if (entry.count >= MIN_PATTERN_SAMPLES) informative.push(entry);
  }

  if (informative.length > 0) {
    // Rank by confidence desc, then count desc.
    informative.sort((a, b) => {
      const ca = CONFIDENCE_RANK[a.result.confidence] ?? 0;
      const cb = CONFIDENCE_RANK[b.result.confidence] ?? 0;
      if (cb !== ca) return cb - ca;
      return b.count - a.count;
    });
    return informative[0].result;
  }

  // Fall back to most-common (likely #9 No Signal).
  let best = phaseClassifications[0].result;
  let bestCount = 0;
  for (const { count, result } of counts.values()) {
    if (count > bestCount) {
      bestCount = count;
      best = result;
    }
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-phase summary builder
// ───────────────────────────────────────────────────────────────────────────

function buildPhaseSummary(
  phaseIdx: number,
  phaseClassifications: SampleClassification[],
  state: PhaseState,
  series: HolderRatioPoint[],
  alignedCandles: KlineCandle[],
  totalSupply: number,
  startIdx: number,
  endIdx: number,
  isCurrent: boolean,
): PhaseSummary {
  const rep = pickRepresentativePattern(phaseClassifications);
  const startSample = series[startIdx];
  const endSample = series[endIdx];

  const samples: PhaseSample[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const s = series[i];
    const c = alignedCandles[i];
    const priceUsd = c?.c ?? 0;
    samples.push({
      time: s.time,
      holders: s.holders_count ?? 0,
      above10: s.HoldersAbove10Usd ?? 0,
      top10Ratio: s.top10_ratio ?? 0,
      priceUsd,
      mcapUsd: priceUsd * totalSupply,
    });
  }

  const holdersStart = startSample.holders_count ?? 0;
  const holdersEnd = endSample.holders_count ?? 0;
  const holdersDeltaPct =
    holdersStart > 0
      ? ((holdersEnd - holdersStart) / holdersStart) * 100
      : 0;

  const above10Start = startSample.HoldersAbove10Usd ?? 0;
  const above10End = endSample.HoldersAbove10Usd ?? 0;
  const above10Delta = above10End - above10Start;

  const top10Start = startSample.top10_ratio ?? 0;
  const top10End = endSample.top10_ratio ?? 0;
  const top10Delta = top10End - top10Start;

  const priceStart = alignedCandles[startIdx]?.c ?? 0;
  const priceEnd = alignedCandles[endIdx]?.c ?? 0;
  const priceDeltaPct =
    priceStart > 0 ? ((priceEnd - priceStart) / priceStart) * 100 : 0;

  const mcapStart = priceStart * totalSupply;
  const mcapEnd = priceEnd * totalSupply;
  const mcapDeltaPct = priceDeltaPct; // same ratio since supply is constant

  const dominantDim = pickDominantDim(
    holdersDeltaPct,
    top10Delta,
    above10Delta,
    rep.volumeVsAvg,
    priceDeltaPct,
  );

  const label = inferPhaseLabel(
    state,
    rep.number,
    holdersDeltaPct,
    top10Delta,
    above10Delta,
    priceDeltaPct,
  );

  const reasoning = buildPhaseReasoning(
    holdersDeltaPct,
    above10Delta,
    top10Delta,
    priceDeltaPct,
  );

  return {
    id: `phase-${phaseIdx}`,
    state,
    patternId: rep.number,
    patternName: rep.name,
    confidence: rep.confidence,
    action: rep.action,

    startTs: startSample.time,
    endTs: endSample.time,
    durationMs: (endSample.time - startSample.time) * 1000,

    capturedSignals: [],

    sampleCount: samples.length,
    samples,

    holdersStart,
    holdersEnd,
    holdersDeltaPct,
    above10Start,
    above10End,
    above10Delta,
    top10Start,
    top10End,
    top10Delta,
    priceStart,
    priceEnd,
    priceDeltaPct,

    mcapStart,
    mcapEnd,
    mcapDeltaPct,

    dominantDim,
    label,
    reasoning,
    isCurrent,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Captured signal attachment
// ───────────────────────────────────────────────────────────────────────────

// Drop captured orchestrator signals into the phase whose time window they
// fall inside. When a phase has at least one captured signal, pick the best
// one (by confidence then recency) and promote it to the phase's representa-
// tive pattern — overriding whatever the live re-classification came up with.
// This guarantees that if the orchestrator ever caught "#1 Strong Entry" on
// this token, the timeline will always surface it on the matching phase.
function attachCapturedSignals(
  phases: PhaseSummary[],
  capturedSignals: CapturedSignal[],
): void {
  if (phases.length === 0 || capturedSignals.length === 0) return;

  // Sort phases by start so binary placement is trivial. They already are
  // in chronological order from groupIntoPhases, but defensive sort.
  const sorted = [...phases].sort((a, b) => a.startTs - b.startTs);

  for (const sig of capturedSignals) {
    const t = sig.detectedAt;
    // Find the phase whose [startTs, endTs] contains t.
    let target: PhaseSummary | null = null;
    for (const p of sorted) {
      if (t >= p.startTs && t <= p.endTs) {
        target = p;
        break;
      }
    }
    // Fallback: if the signal is slightly before the first phase or after
    // the last phase (clock skew, downsample), snap to the nearest phase.
    if (!target) {
      if (t < sorted[0].startTs) target = sorted[0];
      else target = sorted[sorted.length - 1];
    }
    target.capturedSignals.push(sig);
  }

  // For every phase with captured signals, upgrade the representative
  // pattern to the best capture.
  for (const p of phases) {
    if (p.capturedSignals.length === 0) continue;
    // Sort by confidence desc, then score desc, then most recent.
    const best = [...p.capturedSignals].sort((a, b) => {
      const ca = CONFIDENCE_RANK[a.confidence] ?? 0;
      const cb = CONFIDENCE_RANK[b.confidence] ?? 0;
      if (cb !== ca) return cb - ca;
      if (b.score !== a.score) return b.score - a.score;
      return b.detectedAt - a.detectedAt;
    })[0];

    p.patternId = best.patternId;
    p.patternName = best.patternName;
    p.confidence = best.confidence;

    // Upgrade the human label to the canonical matrix label when known.
    const canonical = CANONICAL_PATTERN_LABEL[best.patternId];
    if (canonical) p.label = canonical;
  }
}

const CANONICAL_PATTERN_LABEL: Record<number, string> = {
  1: "Strong Entry",
  2: "Wait (No Volume)",
  3: "FOMO Pump",
  4: "Shakeout",
  5: "Whale Stay Exit",
  6: "Full Dump",
  7: "Sneak Entry",
  8: "Divergence",
  10: "Pump & Whale Load",
  11: "Early Entry",
};

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function pickDominantDim(
  hgPct: number,
  t10Delta: number,
  a10Delta: number,
  volVsAvg: number,
  pcDelta: number,
): DominantDim {
  // Normalize each to a [0, 1]-ish magnitude using the same scales as scoring.ts.
  const mags: Array<[DominantDim, number]> = [
    ["holderGrowth", Math.min(Math.abs(hgPct) / 50, 1)],
    ["top10", Math.min(Math.abs(t10Delta) / 3, 1)],
    ["realMoney", Math.min(Math.abs(a10Delta) / 20, 1)],
    ["volume", Math.min(Math.abs(volVsAvg - 1) / 5, 1)],
    ["price", Math.min(Math.abs(pcDelta) / 30, 1)],
  ];
  mags.sort((a, b) => b[1] - a[1]);
  return mags[0][0];
}

function inferPhaseLabel(
  state: PhaseState,
  patternId: number,
  hgPct: number,
  t10Delta: number,
  a10Delta: number,
  pcDelta: number,
): string {
  // Named matrix patterns still override — if the representative pattern
  // actually hit one of the 8 classic patterns (or #10), use its canonical
  // label. Pattern #9 falls through to state-derived labels below.
  switch (patternId) {
    case 1:
      return "Strong Entry";
    case 2:
      return "Accumulation";
    case 3:
      return "FOMO Pump";
    case 4:
      return "Shakeout";
    case 5:
      return "Whale Stay Exit";
    case 6:
      return "Full Dump";
    case 7:
      return "Sneak Entry";
    case 8:
      return "Divergence";
    case 10:
      return "Pump & Whale Load";
    case 11:
      return "Early Entry";
  }

  // State-derived labels (patternId === 9 from the matrix).
  if (state === "UP") {
    if (hgPct > 100 && a10Delta > 10) return "Launch";
    if (hgPct > 30) return "Growth";
    if (a10Delta > 3 && pcDelta > 0) return "Accumulation";
    return "Slow Growth";
  }

  if (state === "DOWN") {
    if (hgPct < -15 && pcDelta < -20) return "Full Bleed";
    if (pcDelta < -10) return "Distribution";
    if (a10Delta < -5) return "Quiet Distribution";
    return "Bleed";
  }

  // FLAT state: each 5-min window is flat, but aggregate over the whole
  // phase may still drift significantly. Promote the label if the total
  // delta across the phase is meaningful.
  if (hgPct <= -15 || pcDelta <= -30) return "Full Bleed";
  if (hgPct <= -8) return "Slow Bleed";
  if (hgPct >= 8 && a10Delta > 3) return "Slow Accumulation";
  if (pcDelta <= -10) return "Distribution";
  if (pcDelta >= 10) return "Consolidation ↑";
  if (Math.abs(pcDelta) < 3 && Math.abs(hgPct) < 3 && Math.abs(t10Delta) < 1) {
    return "Plateau";
  }
  if (t10Delta >= 1.5) return "Whale Accumulating";
  if (t10Delta <= -1.5) return "Whale Distribution";
  if (pcDelta >= 3) return "Drifting Up";
  if (pcDelta <= -3) return "Drifting Down";
  return "Plateau";
}

function buildPhaseReasoning(
  hgPct: number,
  a10Delta: number,
  t10Delta: number,
  pcDelta: number,
): string {
  const parts: string[] = [];
  if (Math.abs(hgPct) >= 5) {
    parts.push(`holders ${hgPct >= 0 ? "+" : ""}${hgPct.toFixed(0)}%`);
  }
  if (a10Delta !== 0) {
    parts.push(`>$10 ${a10Delta >= 0 ? "+" : ""}${a10Delta}`);
  }
  if (Math.abs(t10Delta) >= 1) {
    parts.push(`top10 ${t10Delta >= 0 ? "+" : ""}${t10Delta.toFixed(1)}%`);
  }
  if (Math.abs(pcDelta) >= 5) {
    parts.push(`price ${pcDelta >= 0 ? "+" : ""}${pcDelta.toFixed(1)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : "steady, no significant movement";
}

function emptyTimeline(rawCount: number): TokenTimeline {
  return {
    phases: [],
    rawSampleCount: rawCount,
    sampleCount: rawCount,
    downsampled: false,
    windowStart: 0,
    windowEnd: 0,
    windowDurationMs: 0,
  };
}
