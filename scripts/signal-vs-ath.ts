#!/usr/bin/env npx tsx
/**
 * Analyze: detection time vs ATH after detection
 * Did our signals catch the sweet spot?
 *
 * Usage: npx tsx scripts/signal-vs-ath.ts
 */

import { prisma } from "../src/lib/db/client";

async function main() {
  // Get all signals with snapshots that have entry price
  const signals = await prisma.signal.findMany({
    where: {
      patternId: { not: 9 }, // exclude No Signal
      snapshot: { priceUsd: { gt: 0 } },
    },
    orderBy: { detectedAt: "desc" },
    include: {
      token: true,
      snapshot: true,
    },
  });

  console.log(`Total signals with price data: ${signals.length}\n`);

  type Row = {
    symbol: string;
    mint: string;
    pattern: string;
    confidence: string;
    score: number;
    detectedAt: Date;
    entryPrice: number;
    entryMcap: number;
    priceAt1h: number | null;
    priceAt4h: number | null;
    priceAt24h: number | null;
    gain1h: string;
    gain4h: string;
    gain24h: string;
    maxPrice: number;
    maxGainPct: string;
  };

  const rows: Row[] = [];

  for (const s of signals) {
    const snap = s.snapshot;
    if (!snap) continue;

    const entryPrice = snap.priceUsd;
    if (!entryPrice || entryPrice <= 0) continue;

    const meta = s.meta as Record<string, unknown> | null;
    const sig = (meta?.signal ?? {}) as Record<string, unknown>;
    const pattern = (sig.name as string) ?? `#${s.patternId}`;

    const gain = (later: number | null) => {
      if (!later || later <= 0) return null;
      return ((later - entryPrice) / entryPrice) * 100;
    };

    const g1h = gain(snap.priceAt1h);
    const g4h = gain(snap.priceAt4h);
    const g24h = gain(snap.priceAt24h);

    const prices = [snap.priceAt1h, snap.priceAt4h, snap.priceAt24h].filter(
      (p): p is number => p !== null && p > 0,
    );
    const maxPrice = prices.length > 0 ? Math.max(...prices) : entryPrice;
    const maxGainPct = ((maxPrice - entryPrice) / entryPrice) * 100;

    rows.push({
      symbol: s.token?.symbol ?? s.tokenMint.slice(0, 6),
      mint: s.tokenMint,
      pattern,
      confidence: s.confidence,
      score: s.score,
      detectedAt: s.detectedAt,
      entryPrice,
      entryMcap: snap.mcapUsd ?? 0,
      priceAt1h: snap.priceAt1h,
      priceAt4h: snap.priceAt4h,
      priceAt24h: snap.priceAt24h,
      gain1h: g1h !== null ? `${g1h >= 0 ? "+" : ""}${g1h.toFixed(1)}%` : "—",
      gain4h: g4h !== null ? `${g4h >= 0 ? "+" : ""}${g4h.toFixed(1)}%` : "—",
      gain24h:
        g24h !== null ? `${g24h >= 0 ? "+" : ""}${g24h.toFixed(1)}%` : "—",
      maxPrice,
      maxGainPct:
        prices.length > 0
          ? `${maxGainPct >= 0 ? "+" : ""}${maxGainPct.toFixed(1)}%`
          : "no data",
    });
  }

  // Sort by score desc
  rows.sort((a, b) => b.score - a.score);

  console.log("=== SIGNAL DETECTION vs POST-DETECTION PRICE ===\n");
  console.log(
    "Symbol".padEnd(12) +
      "Pattern".padEnd(22) +
      "Conf".padEnd(6) +
      "Scr".padEnd(5) +
      "Entry$".padEnd(14) +
      "Mcap".padEnd(10) +
      "+1h".padEnd(10) +
      "+4h".padEnd(10) +
      "+24h".padEnd(10) +
      "MaxGain".padEnd(12) +
      "Detected",
  );
  console.log("-".repeat(135));

  for (const r of rows) {
    const mcapStr =
      r.entryMcap >= 1_000_000
        ? `$${(r.entryMcap / 1_000_000).toFixed(1)}M`
        : `$${(r.entryMcap / 1_000).toFixed(0)}K`;
    console.log(
      r.symbol.padEnd(12) +
        r.pattern.padEnd(22) +
        r.confidence.padEnd(6) +
        String(r.score).padEnd(5) +
        `$${r.entryPrice.toPrecision(4)}`.padEnd(14) +
        mcapStr.padEnd(10) +
        r.gain1h.padEnd(10) +
        r.gain4h.padEnd(10) +
        r.gain24h.padEnd(10) +
        r.maxGainPct.padEnd(12) +
        r.detectedAt.toISOString().slice(0, 16),
    );
  }

  // ── Summary ──
  const withOutcome = rows.filter(
    (r) => r.priceAt1h || r.priceAt4h || r.priceAt24h,
  );
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total signals:        ${rows.length}`);
  console.log(`With outcome data:    ${withOutcome.length}`);
  console.log(`Without outcome data: ${rows.length - withOutcome.length}`);

  if (withOutcome.length === 0) {
    console.log(
      "\nNo outcome data yet. Outcome columns (priceAt1h/4h/24h) belum terisi.",
    );
    console.log(
      "Ini berarti belum ada scheduled job yang mengisi harga setelah deteksi.",
    );

    // Alternative: use kline API to check current price vs entry
    console.log("\n=== ALTERNATIVE: Entry Price vs Latest Detection Price ===");
    console.log(
      "Membandingkan harga deteksi pertama vs terakhir per token:\n",
    );

    // Group by token, compare first vs last entry price
    const byToken = new Map<
      string,
      { symbol: string; sigs: typeof rows; mint: string }
    >();
    for (const r of rows) {
      const existing = byToken.get(r.mint);
      if (existing) {
        existing.sigs.push(r);
      } else {
        byToken.set(r.mint, { symbol: r.symbol, sigs: [r], mint: r.mint });
      }
    }

    console.log(
      "Symbol".padEnd(12) +
        "#Detect".padEnd(8) +
        "1stPrice".padEnd(14) +
        "LastPrice".padEnd(14) +
        "Change".padEnd(12) +
        "1st Pattern".padEnd(22) +
        "First Detected",
    );
    console.log("-".repeat(100));

    const tokenRows: Array<{
      symbol: string;
      count: number;
      firstPrice: number;
      lastPrice: number;
      changePct: number;
      firstPattern: string;
      firstDetected: string;
    }> = [];

    for (const [, data] of byToken) {
      const sorted = data.sigs.sort(
        (a, b) => a.detectedAt.getTime() - b.detectedAt.getTime(),
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const changePct =
        ((last.entryPrice - first.entryPrice) / first.entryPrice) * 100;

      tokenRows.push({
        symbol: data.symbol,
        count: sorted.length,
        firstPrice: first.entryPrice,
        lastPrice: last.entryPrice,
        changePct,
        firstPattern: first.pattern,
        firstDetected: first.detectedAt.toISOString().slice(0, 16),
      });
    }

    tokenRows.sort((a, b) => b.changePct - a.changePct);

    for (const r of tokenRows) {
      const sign = r.changePct >= 0 ? "+" : "";
      console.log(
        r.symbol.padEnd(12) +
          String(r.count).padEnd(8) +
          `$${r.firstPrice.toPrecision(4)}`.padEnd(14) +
          `$${r.lastPrice.toPrecision(4)}`.padEnd(14) +
          `${sign}${r.changePct.toFixed(1)}%`.padEnd(12) +
          r.firstPattern.padEnd(22) +
          r.firstDetected,
      );
    }
  } else {
    // Win rate analysis
    const wins = withOutcome.filter((r) => r.maxPrice > r.entryPrice);
    console.log(
      `\nWin rate (maxPrice > entryPrice): ${wins.length}/${withOutcome.length} = ${((wins.length / withOutcome.length) * 100).toFixed(1)}%`,
    );

    const winGains = wins.map(
      (r) => ((r.maxPrice - r.entryPrice) / r.entryPrice) * 100,
    );
    if (winGains.length > 0) {
      const avgWinGain =
        winGains.reduce((s, g) => s + g, 0) / winGains.length;
      console.log(`Avg max gain (winners): +${avgWinGain.toFixed(1)}%`);
    }

    const losses = withOutcome.filter((r) => r.maxPrice <= r.entryPrice);
    if (losses.length > 0) {
      const lossGains = losses.map(
        (r) => ((r.maxPrice - r.entryPrice) / r.entryPrice) * 100,
      );
      const avgLoss =
        lossGains.reduce((s, g) => s + g, 0) / lossGains.length;
      console.log(`Avg max loss (losers): ${avgLoss.toFixed(1)}%`);
    }

    // By pattern breakdown
    const byPattern = new Map<
      string,
      { wins: number; total: number; gains: number[] }
    >();
    for (const r of withOutcome) {
      const p = byPattern.get(r.pattern) || {
        wins: 0,
        total: 0,
        gains: [],
      };
      p.total++;
      const g = ((r.maxPrice - r.entryPrice) / r.entryPrice) * 100;
      p.gains.push(g);
      if (r.maxPrice > r.entryPrice) p.wins++;
      byPattern.set(r.pattern, p);
    }

    console.log(`\n=== BY PATTERN ===`);
    console.log(
      "Pattern".padEnd(22) +
        "WinRate".padEnd(10) +
        "AvgGain".padEnd(12) +
        "Count",
    );
    console.log("-".repeat(55));
    for (const [pat, data] of [...byPattern.entries()].sort(
      (a, b) => b[1].total - a[1].total,
    )) {
      const avgG =
        data.gains.reduce((s, g) => s + g, 0) / data.gains.length;
      console.log(
        pat.padEnd(22) +
          `${((data.wins / data.total) * 100).toFixed(0)}%`.padEnd(10) +
          `${avgG >= 0 ? "+" : ""}${avgG.toFixed(1)}%`.padEnd(12) +
          String(data.total),
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
