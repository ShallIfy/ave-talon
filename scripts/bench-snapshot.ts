#!/usr/bin/env npx tsx
/**
 * Benchmark: how long does it take to snapshot all 5 metrics
 * for graduated tokens (≤24h old)?
 *
 * Usage:
 *   AVE_TOKEN="..." npx tsx scripts/bench-snapshot.ts
 */

import { getPumpTokens } from "../src/lib/ave/internal";
import { buildAveSnapshot, type AveSnapshot } from "../src/lib/ave/snapshot";
import { detectSignalFromSnapshot } from "../src/lib/signals/detector";

const CONCURRENCY = 4; // match orchestrator default

async function main() {
  console.log("=== Snapshot Benchmark ===\n");

  // 1. Fetch graduated tokens
  const t0 = Date.now();
  const tokens = await getPumpTokens("graduated", {
    limit: 100,
    platforms: "pump,moonshot",
  });
  const discoverMs = Date.now() - t0;
  console.log(`Discovered ${tokens.length} graduated tokens (${discoverMs}ms)\n`);

  if (tokens.length === 0) {
    console.log("No tokens found. Exiting.");
    return;
  }

  // 2. Filter to ≤24h age (publish_at in token response)
  const now = Math.floor(Date.now() / 1000);
  const MAX_AGE_SEC = 24 * 3600;
  interface TokenRow {
    target_token?: string;
    token0_address?: string;
    token0_symbol?: string;
    symbol?: string;
    publish_at?: number;
    opening_at?: number;
    [k: string]: unknown;
  }

  const candidates: Array<{ mint: string; symbol: string }> = [];
  for (const raw of tokens) {
    const t = raw as TokenRow;
    const mint = t.target_token ?? t.token0_address;
    if (!mint) continue;
    const symbol = t.token0_symbol ?? t.symbol ?? mint.slice(0, 6);

    // Check age if publish_at available
    const publishAt = t.publish_at ?? t.opening_at;
    if (publishAt && publishAt > 0) {
      const ageSec = now - publishAt;
      if (ageSec > MAX_AGE_SEC) {
        continue; // skip tokens older than 24h
      }
    }

    candidates.push({ mint, symbol });
  }

  console.log(`After 24h age filter: ${candidates.length} tokens\n`);

  // 3. Snapshot all with bounded concurrency, timing each
  const results: Array<{
    mint: string;
    symbol: string;
    ms: number;
    holders: number;
    klines: number;
    patternId: number;
    patternName: string;
    error?: string;
  }> = [];

  const queue = [...candidates];
  let done = 0;

  const tStart = Date.now();

  async function worker() {
    while (queue.length > 0) {
      const cand = queue.shift();
      if (!cand) break;

      const t1 = Date.now();
      try {
        const snap = await buildAveSnapshot(cand.mint, {
          chain: "solana",
          holderInterval: "1m",
        });
        const detected = detectSignalFromSnapshot(snap);
        const elapsed = Date.now() - t1;
        done++;

        results.push({
          mint: cand.mint,
          symbol: cand.symbol,
          ms: elapsed,
          holders: snap.holderSeries.length,
          klines: snap.klines.length,
          patternId: detected.signal.number,
          patternName: detected.signal.name,
        });

        console.log(
          `[${done}/${candidates.length}] ${cand.symbol.padEnd(12)} ${elapsed}ms · ${snap.holderSeries.length}pt · ${snap.klines.length}c · #${detected.signal.number} ${detected.signal.name}`
        );
      } catch (err) {
        const elapsed = Date.now() - t1;
        done++;
        results.push({
          mint: cand.mint,
          symbol: cand.symbol,
          ms: elapsed,
          holders: 0,
          klines: 0,
          patternId: -1,
          patternName: "ERROR",
          error: String(err).slice(0, 100),
        });
        console.log(
          `[${done}/${candidates.length}] ${cand.symbol.padEnd(12)} ${elapsed}ms · ERROR: ${String(err).slice(0, 80)}`
        );
      }
    }
  }

  // Run workers
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const totalMs = Date.now() - tStart;

  // 4. Summary
  console.log("\n=== SUMMARY ===");
  console.log(`Total tokens:      ${candidates.length}`);
  console.log(`Concurrency:       ${CONCURRENCY}`);
  console.log(`Total wall time:   ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Avg per token:     ${(totalMs / candidates.length).toFixed(0)}ms (wall) / ${(results.reduce((s, r) => s + r.ms, 0) / results.length).toFixed(0)}ms (serial)`);

  const errors = results.filter((r) => r.error);
  console.log(`Errors:            ${errors.length}`);

  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
  const p90 = times[Math.floor(times.length * 0.9)] ?? 0;
  const p99 = times[Math.floor(times.length * 0.99)] ?? 0;
  const max = times[times.length - 1] ?? 0;

  console.log(`\nLatency distribution:`);
  console.log(`  p50:  ${p50}ms`);
  console.log(`  p90:  ${p90}ms`);
  console.log(`  p99:  ${p99}ms`);
  console.log(`  max:  ${max}ms`);

  // Signal breakdown
  const signalCounts = new Map<string, number>();
  for (const r of results) {
    const key = `#${r.patternId} ${r.patternName}`;
    signalCounts.set(key, (signalCounts.get(key) ?? 0) + 1);
  }
  console.log(`\nSignal distribution:`);
  for (const [key, count] of [...signalCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }

  // Can we fit in 5min?
  console.log(`\n--- Feasibility check ---`);
  console.log(`5-min budget:  300s`);
  console.log(`Wall time:     ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Headroom:      ${(300 - totalMs / 1000).toFixed(1)}s`);
  if (totalMs < 300_000) {
    console.log(`✓ FITS within 5-minute window`);
  } else {
    console.log(`✗ EXCEEDS 5-minute window — need higher concurrency or fewer tokens`);
  }
}

main().catch(console.error);
