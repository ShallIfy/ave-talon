#!/usr/bin/env npx tsx
/**
 * Threshold optimizer for Strong Entry signal (#1).
 *
 * Phase 1: Build dataset from DB + Ave kline API (cached)
 * Phase 2: Grid search over threshold combinations
 * Phase 3: Report top configs + Early Entry analysis + sensitivity
 *
 * Usage:
 *   AVE_TOKEN="..." DATABASE_URL="..." npx tsx scripts/optimize-thresholds.ts
 *   npx tsx scripts/optimize-thresholds.ts --cached   # skip Phase 1, use cache
 */

import * as fs from "fs";
import { prisma } from "../src/lib/db/client";
import { getKlineByToken } from "../src/lib/ave/internal";

// ── Types ──────────────────────────────────────────────────────────

interface DatasetToken {
  tokenMint: string;
  symbol: string;
  detectedAt: string; // ISO
  entryPrice: number;
  // Raw 5 dimensions (from Signal.meta.signal — NOT clamped)
  hg: number; // holderGrowthPct
  t10: number; // top10RatioDelta
  a10: number; // above10UsdDelta
  vol: number; // volumeVsAvg
  pc: number; // priceChangePct
  // Outcome
  athPrice: number;
  athGainPct: number;
  currentPrice: number;
  currentGainPct: number;
  candlesAvailable: number;
}

interface CachedDataset {
  version: 1;
  generatedAt: string;
  tokens: DatasetToken[];
}

interface ThresholdConfig {
  hg: number;
  t10: number; // maximum (negative = distribution)
  a10: number;
  vol: number;
  pc: number;
}

interface EarlyEntryConfig {
  hg: number;
  t10: number;
  a10: number;
  volMin: number;
  volMax: number;
  pc: number;
}

interface ConfigResult {
  config: ThresholdConfig;
  signalCount: number;
  winCount: number;
  winRate: number;
  avgAthGain: number;
  medianAthGain: number;
  avgGainWinners: number;
  avgLossLosers: number;
  expectedValue: number;
  maxGain: number;
}

interface EarlyEntryResult {
  config: EarlyEntryConfig;
  signalCount: number;
  winCount: number;
  winRate: number;
  avgAthGain: number;
  medianAthGain: number;
  expectedValue: number;
}

// ── Constants ──────────────────────────────────────────────────────

const CACHE_PATH = "/tmp/signal-dataset.json";
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const CONCURRENCY = 3;
const USE_CACHED = process.argv.includes("--cached");

// Coarse grid
const COARSE_GRID = {
  hg: [10, 15, 20, 25],
  t10: [-0.5, -1.0, -1.5],
  a10: [3, 5, 7, 10],
  vol: [1.0, 1.5, 2.0, 2.5],
  pc: [3, 5, 8, 10],
};

// Early Entry grid (volume RANGE, not just min)
const EARLY_ENTRY_GRID = {
  hg: [8, 10, 15],
  t10: [-0.5, -1.0],
  a10: [3, 5],
  volMin: [0.5, 0.8],
  volMax: [1.5, 2.0],
  pc: [0, 3, 5],
};

// Current Strong Entry config for comparison
const CURRENT_CONFIG: ThresholdConfig = {
  hg: 20,
  t10: -1.0,
  a10: 10,
  vol: 2.0,
  pc: 10,
};

// ── Pattern cascade guards (higher-priority patterns) ──────────────

function wouldBeCaughtByHigherPattern(t: DatasetToken): boolean {
  // #10: Pump & Whale Load
  if (t.hg > 50 && t.t10 > 3 && t.a10 > 20 && t.vol > 5 && t.pc > 30)
    return true;
  // #6: Full Dump
  if (t.hg < -10 && t.t10 < -2 && t.a10 < -10 && t.vol > 3 && t.pc < -20)
    return true;
  // #5: Whale Stay Exit
  if (t.hg < -10 && t.t10 > 2 && t.a10 < -10 && t.vol > 3 && t.pc < -20)
    return true;
  // #3: FOMO Pump (conservative — just the 3 main thresholds)
  if (t.hg > 50 && t.vol > 5 && t.pc > 20) return true;
  return false;
}

function wouldBeStrongEntry(
  t: DatasetToken,
  cfg: ThresholdConfig,
): boolean {
  if (wouldBeCaughtByHigherPattern(t)) return false;
  return (
    t.hg > cfg.hg &&
    t.t10 < cfg.t10 &&
    t.a10 > cfg.a10 &&
    t.vol > cfg.vol &&
    t.pc > cfg.pc
  );
}

function wouldBeEarlyEntry(
  t: DatasetToken,
  cfg: EarlyEntryConfig,
): boolean {
  if (wouldBeCaughtByHigherPattern(t)) return false;
  return (
    t.hg > cfg.hg &&
    t.t10 < cfg.t10 &&
    t.a10 > cfg.a10 &&
    t.vol >= cfg.volMin &&
    t.vol <= cfg.volMax &&
    t.pc > cfg.pc
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function configKey(c: ThresholdConfig): string {
  return `hg>${c.hg}_t10<${c.t10}_a10>${c.a10}_vol>${c.vol}_pc>${c.pc}`;
}

function isCurrentConfig(c: ThresholdConfig): boolean {
  return (
    c.hg === CURRENT_CONFIG.hg &&
    c.t10 === CURRENT_CONFIG.t10 &&
    c.a10 === CURRENT_CONFIG.a10 &&
    c.vol === CURRENT_CONFIG.vol &&
    c.pc === CURRENT_CONFIG.pc
  );
}

// ── Phase 1: Build Dataset ─────────────────────────────────────────

async function buildDataset(): Promise<DatasetToken[]> {
  // Check cache
  if (USE_CACHED || fs.existsSync(CACHE_PATH)) {
    try {
      const stat = fs.statSync(CACHE_PATH);
      const age = Date.now() - stat.mtimeMs;
      if (USE_CACHED || age < CACHE_MAX_AGE_MS) {
        const cached: CachedDataset = JSON.parse(
          fs.readFileSync(CACHE_PATH, "utf-8"),
        );
        if (cached.version === 1 && cached.tokens.length > 0) {
          console.log(
            `Using cached dataset: ${cached.tokens.length} tokens (age: ${(age / 60_000).toFixed(0)}min)`,
          );
          return cached.tokens;
        }
      }
    } catch {
      // Cache invalid, rebuild
    }
  }

  console.log("Phase 1: Building dataset from DB + Ave API...\n");

  // Query ALL signals with snapshots
  const signals = await prisma.signal.findMany({
    where: {
      snapshot: { priceUsd: { gt: 0 } },
    },
    orderBy: { detectedAt: "asc" },
    include: { token: true, snapshot: true },
  });

  console.log(`Loaded ${signals.length} signals from DB`);

  // Deduplicate by tokenMint (keep earliest per token)
  const byToken = new Map<
    string,
    {
      tokenMint: string;
      symbol: string;
      detectedAt: Date;
      entryPrice: number;
      hg: number;
      t10: number;
      a10: number;
      vol: number;
      pc: number;
    }
  >();

  for (const s of signals) {
    if (byToken.has(s.tokenMint)) continue; // already have earliest
    const snap = s.snapshot;
    if (!snap || !snap.priceUsd || snap.priceUsd <= 0) continue;

    const meta = s.meta as Record<string, unknown> | null;
    const sig = (meta?.signal ?? {}) as Record<string, unknown>;

    const hg = Number(sig.holderGrowthPct ?? 0);
    const t10 = Number(sig.top10RatioDelta ?? 0);
    const a10 = Number(sig.above10UsdDelta ?? 0);
    const vol = Number(sig.volumeVsAvg ?? 1);
    const pc = Number(sig.priceChangePct ?? 0);

    byToken.set(s.tokenMint, {
      tokenMint: s.tokenMint,
      symbol: s.token?.symbol ?? s.tokenMint.slice(0, 8),
      detectedAt: s.detectedAt,
      entryPrice: snap.priceUsd,
      hg,
      t10,
      a10,
      vol,
      pc,
    });
  }

  console.log(`Deduped to ${byToken.size} unique tokens\n`);

  // Fetch ATH for each token
  const queue = [...byToken.values()];
  const results: DatasetToken[] = [];
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const tok = queue.shift();
      if (!tok) break;

      try {
        const now = Date.now();
        const detectionTs = tok.detectedAt.getTime();
        const minutesSince = Math.floor((now - detectionTs) / 60_000);

        // 15-min interval, 200 candles = ~50h coverage
        const klines = await getKlineByToken(
          tok.tokenMint,
          "solana",
          15,
          Math.min(minutesSince + 5, 200 * 15), // cap at API max
        );

        const detectionSec = Math.floor(detectionTs / 1000);
        const afterDetection = klines.filter((k) => k.t >= detectionSec);

        let athPrice = tok.entryPrice;
        let currentPrice = tok.entryPrice;

        if (afterDetection.length > 0) {
          for (const k of afterDetection) {
            if (k.h > athPrice) athPrice = k.h;
          }
          currentPrice = afterDetection[afterDetection.length - 1].c;
        }

        const athGainPct =
          ((athPrice - tok.entryPrice) / tok.entryPrice) * 100;
        const currentGainPct =
          ((currentPrice - tok.entryPrice) / tok.entryPrice) * 100;

        done++;
        results.push({
          tokenMint: tok.tokenMint,
          symbol: tok.symbol,
          detectedAt: tok.detectedAt.toISOString(),
          entryPrice: tok.entryPrice,
          hg: tok.hg,
          t10: tok.t10,
          a10: tok.a10,
          vol: tok.vol,
          pc: tok.pc,
          athPrice,
          athGainPct,
          currentPrice,
          currentGainPct,
          candlesAvailable: afterDetection.length,
        });

        if (done % 50 === 0 || done === byToken.size) {
          console.log(
            `[${done}/${byToken.size}] fetched ATH...`,
          );
        }
      } catch {
        done++;
        // Skip tokens with API errors
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\nDataset complete: ${results.length} tokens with ATH data`);

  // Cache
  const cached: CachedDataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    tokens: results,
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cached));
  console.log(`Cached to ${CACHE_PATH}\n`);

  return results;
}

// ── Phase 2: Grid Search ───────────────────────────────────────────

function evaluateConfig(
  tokens: DatasetToken[],
  config: ThresholdConfig,
): ConfigResult | null {
  const matched = tokens.filter((t) => wouldBeStrongEntry(t, config));
  if (matched.length < 5) return null;

  const wins = matched.filter((t) => t.athGainPct > 0);
  const losses = matched.filter((t) => t.athGainPct <= 0);
  const winRate = wins.length / matched.length;
  if (winRate < 0.5) return null;

  const allGains = matched.map((t) => t.athGainPct);
  const winGains = wins.map((t) => t.athGainPct);
  // Use currentGainPct for loss calc — athGainPct is always ~0 for losers by definition
  const lossCurrentGains = losses.map((t) => t.currentGainPct);

  const avgGainWinners =
    winGains.length > 0
      ? winGains.reduce((s, g) => s + g, 0) / winGains.length
      : 0;
  const avgLossLosers =
    lossCurrentGains.length > 0
      ? Math.abs(lossCurrentGains.reduce((s, g) => s + g, 0) / lossCurrentGains.length)
      : 0;

  // EV: expected gain per signal. Loss capped at 80% (realistic for memecoins)
  const expectedValue =
    winRate * avgGainWinners - (1 - winRate) * Math.min(avgLossLosers, 80);

  return {
    config,
    signalCount: matched.length,
    winCount: wins.length,
    winRate,
    avgAthGain: allGains.reduce((s, g) => s + g, 0) / allGains.length,
    medianAthGain: median(allGains),
    avgGainWinners,
    avgLossLosers,
    expectedValue,
    maxGain: Math.max(...allGains),
  };
}

function evaluateEarlyEntry(
  tokens: DatasetToken[],
  config: EarlyEntryConfig,
): EarlyEntryResult | null {
  const matched = tokens.filter((t) => wouldBeEarlyEntry(t, config));
  if (matched.length < 5) return null;

  const wins = matched.filter((t) => t.athGainPct > 0);
  const winRate = wins.length / matched.length;
  if (winRate < 0.5) return null;

  const allGains = matched.map((t) => t.athGainPct);
  const winGains = wins.map((t) => t.athGainPct);

  const avgGainWinners =
    winGains.length > 0
      ? winGains.reduce((s, g) => s + g, 0) / winGains.length
      : 0;
  // Use currentGainPct for realistic loss measurement
  const lossCurrentGains = matched
    .filter((t) => t.athGainPct <= 0)
    .map((t) => Math.abs(t.currentGainPct));
  const avgLoss =
    lossCurrentGains.length > 0
      ? lossCurrentGains.reduce((s, g) => s + g, 0) / lossCurrentGains.length
      : 0;

  const expectedValue =
    winRate * avgGainWinners - (1 - winRate) * Math.min(avgLoss, 80);

  return {
    config,
    signalCount: matched.length,
    winCount: wins.length,
    winRate,
    avgAthGain: allGains.reduce((s, g) => s + g, 0) / allGains.length,
    medianAthGain: median(allGains),
    expectedValue,
  };
}

function runCoarseGrid(tokens: DatasetToken[]): ConfigResult[] {
  console.log("Phase 2a: Coarse grid search...");
  const results: ConfigResult[] = [];
  let combos = 0;

  for (const hg of COARSE_GRID.hg) {
    for (const t10 of COARSE_GRID.t10) {
      for (const a10 of COARSE_GRID.a10) {
        for (const vol of COARSE_GRID.vol) {
          for (const pc of COARSE_GRID.pc) {
            combos++;
            const r = evaluateConfig(tokens, { hg, t10, a10, vol, pc });
            if (r) results.push(r);
          }
        }
      }
    }
  }

  // Always evaluate current config even if it doesn't pass filters
  const currentResult = evaluateConfigNoFilter(tokens, CURRENT_CONFIG);

  console.log(
    `  ${combos} combos tested, ${results.length} passed filters (count≥5, WR≥50%)`,
  );
  if (currentResult) {
    const found = results.find((r) => isCurrentConfig(r.config));
    if (!found) results.push(currentResult);
  }

  return results.sort((a, b) => b.expectedValue - a.expectedValue);
}

function evaluateConfigNoFilter(
  tokens: DatasetToken[],
  config: ThresholdConfig,
): ConfigResult | null {
  const matched = tokens.filter((t) => wouldBeStrongEntry(t, config));
  if (matched.length === 0) return null;

  const wins = matched.filter((t) => t.athGainPct > 0);
  const losses = matched.filter((t) => t.athGainPct <= 0);
  const winRate = wins.length / matched.length;
  const allGains = matched.map((t) => t.athGainPct);
  const winGains = wins.map((t) => t.athGainPct);
  const lossCurrentGains = losses.map((t) => t.currentGainPct);

  const avgGainWinners =
    winGains.length > 0
      ? winGains.reduce((s, g) => s + g, 0) / winGains.length
      : 0;
  const avgLossLosers =
    lossCurrentGains.length > 0
      ? Math.abs(lossCurrentGains.reduce((s, g) => s + g, 0) / lossCurrentGains.length)
      : 0;
  const expectedValue =
    winRate * avgGainWinners - (1 - winRate) * Math.min(avgLossLosers, 80);

  return {
    config,
    signalCount: matched.length,
    winCount: wins.length,
    winRate,
    avgAthGain: allGains.reduce((s, g) => s + g, 0) / allGains.length,
    medianAthGain: median(allGains),
    avgGainWinners,
    avgLossLosers,
    expectedValue,
    maxGain: allGains.length > 0 ? Math.max(...allGains) : 0,
  };
}

function runFineGrid(
  tokens: DatasetToken[],
  seeds: ConfigResult[],
): ConfigResult[] {
  console.log(`Phase 2b: Fine grid around top ${seeds.length} coarse results...`);
  const results = new Map<string, ConfigResult>();
  let combos = 0;

  for (const seed of seeds) {
    const c = seed.config;
    const hgRange = range(c.hg - 3, c.hg + 3, 1).filter((v) => v > 0);
    const t10Range = range(c.t10 - 0.3, c.t10 + 0.3, 0.1);
    const a10Range = range(c.a10 - 2, c.a10 + 2, 1).filter((v) => v >= 1);
    const volRange = range(c.vol - 0.5, c.vol + 0.5, 0.25).filter(
      (v) => v >= 0.5,
    );
    const pcRange = range(c.pc - 3, c.pc + 3, 1).filter((v) => v >= 0);

    for (const hg of hgRange) {
      for (const t10 of t10Range) {
        for (const a10 of a10Range) {
          for (const vol of volRange) {
            for (const pc of pcRange) {
              const key = `${hg}_${t10.toFixed(1)}_${a10}_${vol}_${pc}`;
              if (results.has(key)) continue;
              combos++;
              const r = evaluateConfig(tokens, { hg, t10: round1(t10), a10, vol, pc });
              if (r) results.set(key, r);
            }
          }
        }
      }
    }
  }

  console.log(
    `  ${combos} fine combos tested, ${results.size} passed filters`,
  );
  return [...results.values()].sort(
    (a, b) => b.expectedValue - a.expectedValue,
  );
}

function runEarlyEntryGrid(tokens: DatasetToken[]): EarlyEntryResult[] {
  console.log("Phase 2c: Early Entry pattern grid search...");
  const results: EarlyEntryResult[] = [];
  let combos = 0;

  for (const hg of EARLY_ENTRY_GRID.hg) {
    for (const t10 of EARLY_ENTRY_GRID.t10) {
      for (const a10 of EARLY_ENTRY_GRID.a10) {
        for (const volMin of EARLY_ENTRY_GRID.volMin) {
          for (const volMax of EARLY_ENTRY_GRID.volMax) {
            for (const pc of EARLY_ENTRY_GRID.pc) {
              combos++;
              const r = evaluateEarlyEntry(tokens, {
                hg,
                t10,
                a10,
                volMin,
                volMax,
                pc,
              });
              if (r) results.push(r);
            }
          }
        }
      }
    }
  }

  console.log(
    `  ${combos} combos tested, ${results.length} passed filters`,
  );
  return results.sort((a, b) => b.expectedValue - a.expectedValue);
}

// ── Phase 3: Report ────────────────────────────────────────────────

function printStrongEntryResults(
  coarseResults: ConfigResult[],
  fineResults: ConfigResult[],
) {
  // Merge and deduplicate, sort by EV
  const all = new Map<string, ConfigResult>();
  for (const r of [...coarseResults, ...fineResults]) {
    const key = configKey(r.config);
    const existing = all.get(key);
    if (!existing || r.expectedValue > existing.expectedValue) {
      all.set(key, r);
    }
  }
  const sorted = [...all.values()].sort(
    (a, b) => b.expectedValue - a.expectedValue,
  );

  console.log(`\n${"=".repeat(140)}`);
  console.log("  TOP 20 STRONG ENTRY CONFIGS (by Expected Value)");
  console.log(`${"=".repeat(140)}\n`);

  console.log(
    "Rank".padEnd(6) +
      "hg>".padEnd(6) +
      "t10<".padEnd(7) +
      "a10>".padEnd(6) +
      "vol>".padEnd(6) +
      "pc>".padEnd(6) +
      "Count".padEnd(7) +
      "WinRate".padEnd(9) +
      "AvgATH".padEnd(10) +
      "MedATH".padEnd(10) +
      "AvgWin".padEnd(10) +
      "AvgLoss".padEnd(10) +
      "EV".padEnd(10) +
      "MaxGain",
  );
  console.log("-".repeat(140));

  const top20 = sorted.slice(0, 20);
  for (let i = 0; i < top20.length; i++) {
    const r = top20[i];
    const c = r.config;
    const isCurrent = isCurrentConfig(c);
    const marker = isCurrent ? " ← CURRENT" : "";
    console.log(
      `${isCurrent ? "*" : " "}${(i + 1).toString()}`.padEnd(6) +
        `${c.hg}`.padEnd(6) +
        `${c.t10}`.padEnd(7) +
        `${c.a10}`.padEnd(6) +
        `${c.vol}`.padEnd(6) +
        `${c.pc}`.padEnd(6) +
        `${r.signalCount}`.padEnd(7) +
        `${(r.winRate * 100).toFixed(1)}%`.padEnd(9) +
        `+${r.avgAthGain.toFixed(1)}%`.padEnd(10) +
        `+${r.medianAthGain.toFixed(1)}%`.padEnd(10) +
        `+${r.avgGainWinners.toFixed(1)}%`.padEnd(10) +
        `-${r.avgLossLosers.toFixed(1)}%`.padEnd(10) +
        `${r.expectedValue.toFixed(1)}`.padEnd(10) +
        `+${r.maxGain.toFixed(0)}%${marker}`,
    );
  }

  // Find current config rank
  const currentIdx = sorted.findIndex((r) => isCurrentConfig(r.config));
  if (currentIdx >= 20) {
    const r = sorted[currentIdx];
    const c = r.config;
    console.log("...");
    console.log(
      `*${currentIdx + 1}`.padEnd(6) +
        `${c.hg}`.padEnd(6) +
        `${c.t10}`.padEnd(7) +
        `${c.a10}`.padEnd(6) +
        `${c.vol}`.padEnd(6) +
        `${c.pc}`.padEnd(6) +
        `${r.signalCount}`.padEnd(7) +
        `${(r.winRate * 100).toFixed(1)}%`.padEnd(9) +
        `+${r.avgAthGain.toFixed(1)}%`.padEnd(10) +
        `+${r.medianAthGain.toFixed(1)}%`.padEnd(10) +
        `+${r.avgGainWinners.toFixed(1)}%`.padEnd(10) +
        `-${r.avgLossLosers.toFixed(1)}%`.padEnd(10) +
        `${r.expectedValue.toFixed(1)}`.padEnd(10) +
        `+${r.maxGain.toFixed(0)}% ← CURRENT`,
    );
  } else if (currentIdx < 0) {
    console.log("\n⚠ CURRENT config did not meet minimum filters (count<5 or WR<50%)");
    const fallback = evaluateConfigNoFilter(
      [], // placeholder — will be called with tokens below
      CURRENT_CONFIG,
    );
    if (fallback) {
      console.log(
        `  Count=${fallback.signalCount}, WinRate=${(fallback.winRate * 100).toFixed(1)}%, EV=${fallback.expectedValue.toFixed(1)}`,
      );
    }
  }

  return sorted;
}

function printEarlyEntryResults(results: EarlyEntryResult[]) {
  console.log(`\n${"=".repeat(120)}`);
  console.log("  EARLY ENTRY PATTERN ANALYSIS (vol range, bridging Wait ↔ Strong Entry)");
  console.log(`${"=".repeat(120)}\n`);

  if (results.length === 0) {
    console.log("  No viable Early Entry configs found (need count≥5, WR≥50%)");
    return;
  }

  console.log(
    "Rank".padEnd(6) +
      "hg>".padEnd(6) +
      "t10<".padEnd(7) +
      "a10>".padEnd(6) +
      "vol≥".padEnd(6) +
      "vol≤".padEnd(6) +
      "pc>".padEnd(6) +
      "Count".padEnd(7) +
      "WinRate".padEnd(9) +
      "AvgATH".padEnd(10) +
      "MedATH".padEnd(10) +
      "EV",
  );
  console.log("-".repeat(120));

  const top10 = results.slice(0, 10);
  for (let i = 0; i < top10.length; i++) {
    const r = top10[i];
    const c = r.config;
    console.log(
      ` ${i + 1}`.padEnd(6) +
        `${c.hg}`.padEnd(6) +
        `${c.t10}`.padEnd(7) +
        `${c.a10}`.padEnd(6) +
        `${c.volMin}`.padEnd(6) +
        `${c.volMax}`.padEnd(6) +
        `${c.pc}`.padEnd(6) +
        `${r.signalCount}`.padEnd(7) +
        `${(r.winRate * 100).toFixed(1)}%`.padEnd(9) +
        `+${r.avgAthGain.toFixed(1)}%`.padEnd(10) +
        `+${r.medianAthGain.toFixed(1)}%`.padEnd(10) +
        `${r.expectedValue.toFixed(1)}`,
    );
  }
}

function printSensitivity(
  tokens: DatasetToken[],
  bestConfig: ThresholdConfig,
) {
  console.log(`\n${"=".repeat(100)}`);
  console.log("  SENSITIVITY ANALYSIS (best config, varying one dim at a time)");
  console.log(`${"=".repeat(100)}\n`);

  const dims: Array<{
    name: string;
    key: keyof ThresholdConfig;
    values: number[];
  }> = [
    { name: "hg", key: "hg", values: range(5, 30, 2) },
    { name: "t10", key: "t10", values: range(-2.0, 0, 0.2).map(round1) },
    { name: "a10", key: "a10", values: range(1, 15, 1) },
    { name: "vol", key: "vol", values: range(0.5, 3.0, 0.25) },
    { name: "pc", key: "pc", values: range(0, 15, 1) },
  ];

  for (const dim of dims) {
    const line: string[] = [];
    for (const val of dim.values) {
      const testConfig = { ...bestConfig, [dim.key]: val };
      const r = evaluateConfigNoFilter(tokens, testConfig);
      const marker = val === bestConfig[dim.key] ? "**" : "  ";
      if (r && r.signalCount > 0) {
        line.push(
          `${marker}${dim.key === "t10" ? val.toFixed(1) : val}: n=${r.signalCount} WR=${(r.winRate * 100).toFixed(0)}% EV=${r.expectedValue.toFixed(0)}${marker}`,
        );
      } else {
        line.push(
          `  ${dim.key === "t10" ? val.toFixed(1) : val}: n=0`,
        );
      }
    }
    console.log(`  ${dim.name}:`);
    for (const l of line) console.log(`    ${l}`);
    console.log();
  }
}

function printRecommendation(
  bestStrong: ConfigResult | undefined,
  bestEarly: EarlyEntryResult | undefined,
  currentResult: ConfigResult | null,
) {
  console.log(`\n${"=".repeat(80)}`);
  console.log("  RECOMMENDATION");
  console.log(`${"=".repeat(80)}\n`);

  if (currentResult) {
    console.log(`Current Strong Entry config:`);
    console.log(
      `  hg>${CURRENT_CONFIG.hg} t10<${CURRENT_CONFIG.t10} a10>${CURRENT_CONFIG.a10} vol>${CURRENT_CONFIG.vol} pc>${CURRENT_CONFIG.pc}`,
    );
    console.log(
      `  Count=${currentResult.signalCount}, WR=${(currentResult.winRate * 100).toFixed(1)}%, EV=${currentResult.expectedValue.toFixed(1)}`,
    );
  }

  if (bestStrong) {
    const c = bestStrong.config;
    const improvement = currentResult
      ? bestStrong.expectedValue - currentResult.expectedValue
      : bestStrong.expectedValue;

    console.log(`\n1. UPDATE Strong Entry (#1):`);
    console.log(
      `   if (hg > ${c.hg} && t10 < ${c.t10} && a10 > ${c.a10} && vol > ${c.vol} && pc > ${c.pc})`,
    );
    console.log(
      `   Count=${bestStrong.signalCount}, WR=${(bestStrong.winRate * 100).toFixed(1)}%, EV=${bestStrong.expectedValue.toFixed(1)} (${improvement >= 0 ? "+" : ""}${improvement.toFixed(1)} vs current)`,
    );
  }

  if (bestEarly && bestEarly.expectedValue > 20) {
    const c = bestEarly.config;
    console.log(`\n2. ADD Early Entry (#11) — NEW PATTERN:`);
    console.log(
      `   if (hg > ${c.hg} && t10 < ${c.t10} && a10 > ${c.a10} && vol >= ${c.volMin} && vol <= ${c.volMax} && pc > ${c.pc})`,
    );
    console.log(`   Confidence: MED, Action: ENTRY`);
    console.log(
      `   Count=${bestEarly.signalCount}, WR=${(bestEarly.winRate * 100).toFixed(1)}%, EV=${bestEarly.expectedValue.toFixed(1)}`,
    );
  }
}

// ── Utilities ──────────────────────────────────────────────────────

function range(start: number, end: number, step: number): number[] {
  const result: number[] = [];
  for (let v = start; v <= end + step / 10; v += step) {
    result.push(Math.round(v * 100) / 100);
  }
  return result;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log("=== Strong Entry Threshold Optimizer ===\n");

  // Phase 1: Build dataset
  const tokens = await buildDataset();

  if (tokens.length === 0) {
    console.log("No tokens in dataset. Exiting.");
    return;
  }

  // Filter to tokens with kline data
  const valid = tokens.filter((t) => t.candlesAvailable > 0);
  console.log(
    `Dataset: ${tokens.length} total, ${valid.length} with kline data\n`,
  );

  // Phase 2a: Coarse grid
  const coarseResults = runCoarseGrid(valid);

  // Phase 2b: Fine grid around top 5
  const top5Coarse = coarseResults.slice(0, 5);
  const fineResults =
    top5Coarse.length > 0 ? runFineGrid(valid, top5Coarse) : [];

  // Phase 2c: Early Entry
  const earlyResults = runEarlyEntryGrid(valid);

  // Phase 3: Report
  const allSorted = printStrongEntryResults(coarseResults, fineResults);

  printEarlyEntryResults(earlyResults);

  if (allSorted.length > 0) {
    printSensitivity(valid, allSorted[0].config);
  }

  // Current config result
  const currentResult = evaluateConfigNoFilter(valid, CURRENT_CONFIG);

  printRecommendation(
    allSorted[0],
    earlyResults[0],
    currentResult,
  );

  // Dataset summary
  console.log(`\n--- Dataset Summary ---`);
  console.log(`Total tokens: ${valid.length}`);
  const withATH = valid.filter((t) => t.athGainPct > 0);
  console.log(
    `Tokens with ATH > entry: ${withATH.length} (${((withATH.length / valid.length) * 100).toFixed(1)}%)`,
  );
  const avgATH = withATH.length > 0
    ? withATH.reduce((s, t) => s + t.athGainPct, 0) / withATH.length
    : 0;
  console.log(`Avg ATH gain (all tokens that went up): +${avgATH.toFixed(1)}%`);

  await prisma.$disconnect();
}

main().catch(console.error);
