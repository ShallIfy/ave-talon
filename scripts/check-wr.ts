#!/usr/bin/env npx tsx
/**
 * Quick WR check — fetch ATH after detection for all ENTRY-class signals,
 * compute win rate per pattern.
 *
 * Usage: npx tsx scripts/check-wr.ts
 */

import { prisma } from "../src/lib/db/client";
import { getKlineByToken } from "../src/lib/ave/internal";

const WIN_THRESHOLD = 0.10; // +10% ATH = win

interface Row {
  tokenMint: string;
  symbol: string | null;
  patternId: number;
  patternName: string;
  detectedAt: Date;
  entryPrice: number;
}

interface Result extends Row {
  athPrice: number;
  athGainPct: number;
  currentPrice: number;
  currentGainPct: number;
  win: boolean;
}

async function main() {
  // 1. Query all signals with entry price, deduplicated by token (first signal)
  const signals = await prisma.$queryRaw<
    Array<{
      tokenMint: string;
      symbol: string | null;
      patternId: number;
      patternName: string;
      detectedAt: Date;
      entryPrice: number;
    }>
  >`
    SELECT DISTINCT ON (s."tokenMint")
      s."tokenMint",
      t.symbol,
      s."patternId",
      s."patternName",
      s."detectedAt",
      ss."priceUsd" as "entryPrice"
    FROM "Signal" s
    JOIN "Token" t ON t.mint = s."tokenMint"
    LEFT JOIN "SignalSnapshot" ss ON ss."signalId" = s.id
    WHERE s."patternId" IN (1, 2, 7, 11)
      AND ss."priceUsd" > 0
    ORDER BY s."tokenMint", s."detectedAt" ASC
  `;

  console.log(`\n📊 Found ${signals.length} unique tokens with ENTRY/WAIT signals\n`);

  // 2. Fetch ATH for each token
  const results: Result[] = [];
  let done = 0;
  const concurrency = 3;
  const queue = [...signals];

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) break;

      try {
        const msSinceDetection = Date.now() - row.detectedAt.getTime();
        const minSince = Math.floor(msSinceDetection / 60000) + 10;
        const interval = minSince > 3000 ? 15 : 5; // 15min for older, 5min for recent

        const klines = await getKlineByToken(
          row.tokenMint,
          "solana",
          interval,
          Math.min(minSince, 200 * interval),
        );

        if (!klines || klines.length === 0) {
          done++;
          continue;
        }

        // Filter candles after detection time
        const detectedTs = row.detectedAt.getTime() / 1000;
        const afterDetection = klines.filter((k: { t: number }) => k.t >= detectedTs);
        const relevantCandles = afterDetection.length > 0 ? afterDetection : klines;

        const athPrice = Math.max(...relevantCandles.map((k: { h: number }) => k.h));
        const currentPrice = klines[klines.length - 1]?.c ?? 0;
        const athGainPct = row.entryPrice > 0 ? ((athPrice - row.entryPrice) / row.entryPrice) * 100 : 0;
        const currentGainPct = row.entryPrice > 0 ? ((currentPrice - row.entryPrice) / row.entryPrice) * 100 : 0;

        results.push({
          ...row,
          athPrice,
          athGainPct,
          currentPrice,
          currentGainPct,
          win: athGainPct >= WIN_THRESHOLD * 100,
        });
      } catch {
        // skip on error
      }

      done++;
      if (done % 10 === 0) {
        process.stdout.write(`\r  Fetching klines... ${done}/${signals.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`\r  Fetched ${results.length}/${signals.length} tokens with kline data\n`);

  // 3. Compute WR per pattern
  const patterns = new Map<number, { name: string; results: Result[] }>();
  for (const r of results) {
    if (!patterns.has(r.patternId)) {
      patterns.set(r.patternId, { name: r.patternName, results: [] });
    }
    patterns.get(r.patternId)!.results.push(r);
  }

  console.log(`${"═".repeat(90)}`);
  console.log(
    `${"Pattern".padEnd(20)} ${"Count".padStart(6)} ${"Win".padStart(5)} ${"WR%".padStart(7)} ${"AvgATH".padStart(9)} ${"MedATH".padStart(9)} ${"AvgNow".padStart(9)} ${"MedNow".padStart(9)}`
  );
  console.log(`${"─".repeat(90)}`);

  const sortedPatterns = [...patterns.entries()].sort((a, b) => a[0] - b[0]);

  let totalWin = 0;
  let totalCount = 0;

  for (const [pid, { name, results: pr }] of sortedPatterns) {
    const wins = pr.filter((r) => r.win).length;
    const wr = (wins / pr.length) * 100;
    const athGains = pr.map((r) => r.athGainPct).sort((a, b) => a - b);
    const nowGains = pr.map((r) => r.currentGainPct).sort((a, b) => a - b);
    const avgAth = athGains.reduce((a, b) => a + b, 0) / athGains.length;
    const medAth = athGains[Math.floor(athGains.length / 2)];
    const avgNow = nowGains.reduce((a, b) => a + b, 0) / nowGains.length;
    const medNow = nowGains[Math.floor(nowGains.length / 2)];

    totalWin += wins;
    totalCount += pr.length;

    console.log(
      `#${String(pid).padEnd(2)} ${name.padEnd(17)} ${String(pr.length).padStart(6)} ${String(wins).padStart(5)} ${wr.toFixed(1).padStart(6)}% ${(avgAth >= 0 ? "+" : "") + avgAth.toFixed(1).padStart(8)}% ${(medAth >= 0 ? "+" : "") + medAth.toFixed(1).padStart(8)}% ${(avgNow >= 0 ? "+" : "") + avgNow.toFixed(1).padStart(8)}% ${(medNow >= 0 ? "+" : "") + medNow.toFixed(1).padStart(8)}%`
    );
  }

  console.log(`${"─".repeat(90)}`);
  const overallWr = (totalWin / totalCount) * 100;
  console.log(
    `${"OVERALL".padEnd(23)} ${String(totalCount).padStart(6)} ${String(totalWin).padStart(5)} ${overallWr.toFixed(1).padStart(6)}%`
  );
  console.log(`${"═".repeat(90)}`);

  // 4. Top winners and worst losers
  const sorted = [...results].sort((a, b) => b.athGainPct - a.athGainPct);

  console.log(`\n🏆 TOP 10 WINNERS (by ATH gain):`);
  for (const r of sorted.slice(0, 10)) {
    console.log(
      `  ${(r.symbol ?? r.tokenMint.slice(0, 6)).padEnd(12)} #${r.patternId} ${r.patternName.padEnd(18)} entry=$${r.entryPrice.toExponential(2)}  ATH +${r.athGainPct.toFixed(0)}%  now ${r.currentGainPct >= 0 ? "+" : ""}${r.currentGainPct.toFixed(0)}%`
    );
  }

  console.log(`\n💀 BOTTOM 10 (by current price vs entry):`);
  const sortedByNow = [...results].sort((a, b) => a.currentGainPct - b.currentGainPct);
  for (const r of sortedByNow.slice(0, 10)) {
    console.log(
      `  ${(r.symbol ?? r.tokenMint.slice(0, 6)).padEnd(12)} #${r.patternId} ${r.patternName.padEnd(18)} entry=$${r.entryPrice.toExponential(2)}  ATH +${r.athGainPct.toFixed(0)}%  now ${r.currentGainPct >= 0 ? "+" : ""}${r.currentGainPct.toFixed(0)}%`
    );
  }

  // 5. WR by time period (how old is the signal)
  console.log(`\n⏰ WR BY SIGNAL AGE:`);
  const now = Date.now();
  const buckets = [
    { label: "< 1h", maxMs: 60 * 60 * 1000 },
    { label: "1-6h", maxMs: 6 * 60 * 60 * 1000 },
    { label: "6-12h", maxMs: 12 * 60 * 60 * 1000 },
    { label: "12-24h", maxMs: 24 * 60 * 60 * 1000 },
    { label: "> 24h", maxMs: Infinity },
  ];

  let prevMax = 0;
  for (const b of buckets) {
    const inBucket = results.filter((r) => {
      const age = now - r.detectedAt.getTime();
      return age > prevMax && age <= b.maxMs;
    });
    if (inBucket.length === 0) {
      prevMax = b.maxMs;
      continue;
    }
    const wins = inBucket.filter((r) => r.win).length;
    const wr = (wins / inBucket.length) * 100;
    console.log(`  ${b.label.padEnd(8)} ${String(inBucket.length).padStart(4)} signals  ${String(wins).padStart(4)} wins  WR ${wr.toFixed(1)}%`);
    prevMax = b.maxMs;
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
