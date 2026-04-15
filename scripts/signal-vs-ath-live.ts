#!/usr/bin/env npx tsx
/**
 * Signal detection vs ATH after detection — LIVE kline lookup.
 *
 * For each actionable signal (ENTRY patterns), fetches kline candles
 * from detection time to now, finds the ATH, and computes gain.
 *
 * Usage:
 *   AVE_TOKEN="..." DATABASE_URL="..." npx tsx scripts/signal-vs-ath-live.ts
 */

import { prisma } from "../src/lib/db/client";
import { getKlineByToken, type KlineCandle } from "../src/lib/ave/internal";

const CONCURRENCY = 3; // don't hammer Ave API

// Only look at ENTRY patterns (action = ENTRY)
const ENTRY_PATTERNS = [1, 2, 3, 5]; // Strong Entry, Holder Breakout, Sneak Entry, Pump & Whale Load

interface SignalRow {
  id: string;
  tokenMint: string;
  patternId: number;
  score: number;
  confidence: string;
  detectedAt: Date;
  entryPrice: number;
  entryMcap: number;
  symbol: string;
  patternName: string;
}

interface ResultRow extends SignalRow {
  athPrice: number;
  athTime: Date | null;
  athGainPct: number;
  currentPrice: number;
  currentGainPct: number;
  minutesToAth: number;
  candlesAvailable: number;
  error?: string;
}

async function main() {
  // 1. Query all entry signals from DB
  const signals = await prisma.signal.findMany({
    where: {
      patternId: { in: ENTRY_PATTERNS },
      snapshot: { priceUsd: { gt: 0 } },
    },
    orderBy: { detectedAt: "desc" },
    include: { token: true, snapshot: true },
  });

  console.log(`Found ${signals.length} ENTRY signals\n`);

  // Deduplicate: keep first (earliest) signal per token per pattern
  const seen = new Map<string, SignalRow>();
  for (const s of signals) {
    const snap = s.snapshot;
    if (!snap || !snap.priceUsd || snap.priceUsd <= 0) continue;

    const meta = s.meta as Record<string, unknown> | null;
    const sig = (meta?.signal ?? {}) as Record<string, unknown>;

    const key = `${s.tokenMint}:${s.patternId}`;
    if (seen.has(key)) continue; // keep earliest (signals are desc, so later ones are earlier — actually we want earliest)

    seen.set(key, {
      id: s.id,
      tokenMint: s.tokenMint,
      patternId: s.patternId,
      score: s.score,
      confidence: s.confidence,
      detectedAt: s.detectedAt,
      entryPrice: snap.priceUsd,
      entryMcap: snap.mcapUsd ?? 0,
      symbol: s.token?.symbol ?? s.tokenMint.slice(0, 8),
      patternName: (sig.name as string) ?? `#${s.patternId}`,
    });
  }

  // Actually we want earliest per key, but signals are ordered desc.
  // Reverse the map to keep earliest:
  const deduped: SignalRow[] = [];
  const byKey = new Map<string, SignalRow>();
  for (const s of signals) {
    const snap = s.snapshot;
    if (!snap || !snap.priceUsd || snap.priceUsd <= 0) continue;
    const meta = s.meta as Record<string, unknown> | null;
    const sig = (meta?.signal ?? {}) as Record<string, unknown>;
    const key = `${s.tokenMint}:${s.patternId}`;
    // Overwrite with each (desc order), so last write = earliest
    byKey.set(key, {
      id: s.id,
      tokenMint: s.tokenMint,
      patternId: s.patternId,
      score: s.score,
      confidence: s.confidence,
      detectedAt: s.detectedAt,
      entryPrice: snap.priceUsd,
      entryMcap: snap.mcapUsd ?? 0,
      symbol: s.token?.symbol ?? s.tokenMint.slice(0, 8),
      patternName: (sig.name as string) ?? `#${s.patternId}`,
    });
  }
  for (const row of byKey.values()) deduped.push(row);
  deduped.sort((a, b) => b.score - a.score || b.detectedAt.getTime() - a.detectedAt.getTime());

  console.log(`After dedup (earliest per token×pattern): ${deduped.length} unique signals\n`);

  // 2. For each signal, fetch kline from detection to now
  const results: ResultRow[] = [];
  const queue = [...deduped];
  let done = 0;

  async function worker() {
    while (queue.length > 0) {
      const sig = queue.shift();
      if (!sig) break;

      try {
        const now = Date.now();
        const detectionTs = sig.detectedAt.getTime();
        const minutesSinceDetection = Math.floor((now - detectionTs) / 60_000);

        // Fetch klines from detection to now (15-min interval for longer range)
        // 200 candle cap: 15min * 200 = 3000min = 50h — enough for ~2 days
        const interval = minutesSinceDetection > 200 ? 15 : 1;
        const klines = await getKlineByToken(
          sig.tokenMint,
          "solana",
          interval as 1 | 5 | 15 | 30 | 60 | 900,
          minutesSinceDetection + 5, // +5 buffer
        );

        // Filter candles that are AFTER detection time
        const detectionSec = Math.floor(detectionTs / 1000);
        const afterDetection = klines.filter((k) => k.t >= detectionSec);

        let athPrice = sig.entryPrice;
        let athTime: Date | null = null;
        let currentPrice = sig.entryPrice;

        if (afterDetection.length > 0) {
          // Find ATH (highest high)
          for (const k of afterDetection) {
            if (k.h > athPrice) {
              athPrice = k.h;
              athTime = new Date(k.t * 1000);
            }
          }
          // Current = last candle close
          const lastCandle = afterDetection[afterDetection.length - 1];
          currentPrice = lastCandle.c;
        }

        const athGainPct = ((athPrice - sig.entryPrice) / sig.entryPrice) * 100;
        const currentGainPct = ((currentPrice - sig.entryPrice) / sig.entryPrice) * 100;
        const minutesToAth = athTime
          ? Math.floor((athTime.getTime() - detectionTs) / 60_000)
          : 0;

        done++;
        results.push({
          ...sig,
          athPrice,
          athTime,
          athGainPct,
          currentPrice,
          currentGainPct,
          minutesToAth,
          candlesAvailable: afterDetection.length,
        });

        const athStr = athGainPct > 0 ? `+${athGainPct.toFixed(1)}%` : `${athGainPct.toFixed(1)}%`;
        const curStr = currentGainPct > 0 ? `+${currentGainPct.toFixed(1)}%` : `${currentGainPct.toFixed(1)}%`;
        console.log(
          `[${done}/${deduped.length}] ${sig.symbol.padEnd(12)} ${sig.patternName.padEnd(18)} ATH: ${athStr.padEnd(10)} Now: ${curStr.padEnd(10)} (${afterDetection.length} candles)`,
        );
      } catch (err) {
        done++;
        results.push({
          ...sig,
          athPrice: 0,
          athTime: null,
          athGainPct: 0,
          currentPrice: 0,
          currentGainPct: 0,
          minutesToAth: 0,
          candlesAvailable: 0,
          error: String(err).slice(0, 80),
        });
        console.log(
          `[${done}/${deduped.length}] ${sig.symbol.padEnd(12)} ERROR: ${String(err).slice(0, 60)}`,
        );
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // 3. Report
  const valid = results.filter((r) => !r.error && r.candlesAvailable > 0);
  valid.sort((a, b) => b.athGainPct - a.athGainPct);

  console.log(`\n${"=".repeat(140)}`);
  console.log("  SIGNAL DETECTION vs ATH (Live Kline Data)");
  console.log(`${"=".repeat(140)}\n`);

  console.log(
    "Symbol".padEnd(12) +
      "Pattern".padEnd(20) +
      "Conf".padEnd(6) +
      "Scr".padEnd(5) +
      "Entry$".padEnd(14) +
      "ATH$".padEnd(14) +
      "ATH Gain".padEnd(11) +
      "Now$".padEnd(14) +
      "Now Gain".padEnd(11) +
      "Min→ATH".padEnd(9) +
      "Candles".padEnd(9) +
      "Detected",
  );
  console.log("-".repeat(140));

  for (const r of valid) {
    const athSign = r.athGainPct >= 0 ? "+" : "";
    const curSign = r.currentGainPct >= 0 ? "+" : "";
    console.log(
      r.symbol.padEnd(12) +
        r.patternName.padEnd(20) +
        r.confidence.padEnd(6) +
        String(r.score).padEnd(5) +
        `$${r.entryPrice.toPrecision(4)}`.padEnd(14) +
        `$${r.athPrice.toPrecision(4)}`.padEnd(14) +
        `${athSign}${r.athGainPct.toFixed(1)}%`.padEnd(11) +
        `$${r.currentPrice.toPrecision(4)}`.padEnd(14) +
        `${curSign}${r.currentGainPct.toFixed(1)}%`.padEnd(11) +
        `${r.minutesToAth}m`.padEnd(9) +
        String(r.candlesAvailable).padEnd(9) +
        r.detectedAt.toISOString().slice(0, 16),
    );
  }

  // 4. Summary stats
  console.log(`\n${"=".repeat(80)}`);
  console.log("  SWEET SPOT ANALYSIS");
  console.log(`${"=".repeat(80)}\n`);

  console.log(`Total ENTRY signals (deduped): ${deduped.length}`);
  console.log(`With kline data:              ${valid.length}`);
  console.log(`Errors/no data:               ${results.length - valid.length}`);

  if (valid.length > 0) {
    // Win = ATH > entry (any profit possible)
    const wins = valid.filter((r) => r.athGainPct > 0);
    const losses = valid.filter((r) => r.athGainPct <= 0);

    console.log(`\n--- Win Rate (ATH > Entry) ---`);
    console.log(`Wins:    ${wins.length}/${valid.length} = ${((wins.length / valid.length) * 100).toFixed(1)}%`);

    if (wins.length > 0) {
      const avgAthGain = wins.reduce((s, r) => s + r.athGainPct, 0) / wins.length;
      const medianAthGain = wins.map((r) => r.athGainPct).sort((a, b) => a - b)[Math.floor(wins.length / 2)];
      const maxAthGain = Math.max(...wins.map((r) => r.athGainPct));
      const avgMinToAth = wins.reduce((s, r) => s + r.minutesToAth, 0) / wins.length;

      console.log(`Avg ATH gain:    +${avgAthGain.toFixed(1)}%`);
      console.log(`Median ATH gain: +${medianAthGain.toFixed(1)}%`);
      console.log(`Max ATH gain:    +${maxAthGain.toFixed(1)}%`);
      console.log(`Avg time to ATH: ${avgMinToAth.toFixed(0)} minutes`);

      // Milestone distribution
      const milestones = [2, 3, 5, 10];
      for (const m of milestones) {
        const hit = wins.filter((r) => r.athGainPct >= (m - 1) * 100);
        console.log(`  ≥${m}x:  ${hit.length}/${valid.length} (${((hit.length / valid.length) * 100).toFixed(1)}%)`);
      }
    }

    // Current P&L (if you held from entry)
    console.log(`\n--- If You Held (Current Price vs Entry) ---`);
    const stillUp = valid.filter((r) => r.currentGainPct > 0);
    const stillDown = valid.filter((r) => r.currentGainPct <= 0);
    console.log(`Still profitable: ${stillUp.length}/${valid.length} = ${((stillUp.length / valid.length) * 100).toFixed(1)}%`);

    if (stillUp.length > 0) {
      const avgCurGain = stillUp.reduce((s, r) => s + r.currentGainPct, 0) / stillUp.length;
      console.log(`Avg current gain (winners): +${avgCurGain.toFixed(1)}%`);
    }
    if (stillDown.length > 0) {
      const avgCurLoss = stillDown.reduce((s, r) => s + r.currentGainPct, 0) / stillDown.length;
      console.log(`Avg current loss (losers):  ${avgCurLoss.toFixed(1)}%`);
    }

    // By pattern
    console.log(`\n--- By Pattern ---`);
    const byPat = new Map<string, ResultRow[]>();
    for (const r of valid) {
      const arr = byPat.get(r.patternName) || [];
      arr.push(r);
      byPat.set(r.patternName, arr);
    }
    console.log(
      "Pattern".padEnd(22) +
        "Count".padEnd(7) +
        "WinRate".padEnd(10) +
        "AvgATH%".padEnd(12) +
        "AvgNow%".padEnd(12) +
        "Avg→ATH",
    );
    console.log("-".repeat(75));
    for (const [pat, arr] of [...byPat.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const w = arr.filter((r) => r.athGainPct > 0).length;
      const avgAth = arr.reduce((s, r) => s + r.athGainPct, 0) / arr.length;
      const avgCur = arr.reduce((s, r) => s + r.currentGainPct, 0) / arr.length;
      const avgMin = arr.reduce((s, r) => s + r.minutesToAth, 0) / arr.length;
      console.log(
        pat.padEnd(22) +
          String(arr.length).padEnd(7) +
          `${((w / arr.length) * 100).toFixed(0)}%`.padEnd(10) +
          `${avgAth >= 0 ? "+" : ""}${avgAth.toFixed(1)}%`.padEnd(12) +
          `${avgCur >= 0 ? "+" : ""}${avgCur.toFixed(1)}%`.padEnd(12) +
          `${avgMin.toFixed(0)}m`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
