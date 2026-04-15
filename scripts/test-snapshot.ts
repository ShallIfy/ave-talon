// Quick smoke test: build a snapshot for a known Solana token and
// print holder delta, price, and detected signal.
//
// Run: pnpm exec tsx scripts/test-snapshot.ts <mint>

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env", override: false });

async function main() {
  // Dynamic imports so env is loaded BEFORE ave/config.ts captures process.env
  const { buildAveSnapshot } = await import("../src/lib/ave/snapshot");
  const { detectSignalFromSnapshot } = await import(
    "../src/lib/signals/detector"
  );

  // Default: BONK
  const mint =
    process.argv[2] || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

  console.log(`[test-snapshot] building snapshot for ${mint}...`);
  const t0 = Date.now();
  const snap = await buildAveSnapshot(mint);
  const elapsed = Date.now() - t0;

  console.log("\n── Token Identity ──");
  console.log(`symbol        : ${snap.symbol}`);
  console.log(`name          : ${snap.name}`);
  console.log(`totalSupply   : ${snap.totalSupply}`);
  console.log(`decimals      : ${snap.decimals}`);
  console.log(`primaryPairId : ${snap.primaryPairId}`);

  console.log("\n── Holder Series ──");
  console.log(`points        : ${snap.holderSeries.length}`);
  if (snap.holderDelta) {
    console.log(`delta window  : ${snap.holderDelta.window}`);
    console.log(`holders start : ${snap.holderDelta.holdersCountStart}`);
    console.log(`holders end   : ${snap.holderDelta.holdersCountEnd}`);
    console.log(`growth %      : ${snap.holderDelta.holderGrowthPct}`);
    console.log(`top10 delta   : ${snap.holderDelta.top10RatioDelta}`);
    console.log(`>$10 delta    : ${snap.holderDelta.holdersAbove10Delta}`);
  }

  console.log("\n── Price / Volume ──");
  console.log(`klines        : ${snap.klines.length}`);
  console.log(`latest price  : $${snap.latestPriceUsd}`);
  console.log(`price change %: ${snap.priceChangePct.toFixed(2)}`);
  console.log(`1h avg volume : ${snap.volume1hAvg.toFixed(2)}`);

  console.log("\n── Risk ──");
  if (snap.risk) {
    console.log(`risk score    : ${snap.risk.riskScore}`);
    console.log(`market cap    : $${snap.risk.marketCap}`);
    console.log(`holders       : ${snap.risk.holders}`);
    console.log(`top10 ratio   : ${snap.risk.top10Ratio}`);
    console.log(`migrated      : ${snap.risk.migrated}`);
  }

  console.log("\n── Detected Signal ──");
  const det = detectSignalFromSnapshot(snap);
  console.log(`#${det.signal.number} ${det.signal.name}`);
  console.log(`confidence    : ${det.signal.confidence}`);
  console.log(`action        : ${det.signal.action}`);
  console.log(`score         : ${det.score}/100`);
  console.log(`reasoning     : ${det.reasoning}`);

  console.log("\n── Metadata ──");
  console.log(`collection ms : ${snap.metadata.collectionTimeMs}`);
  console.log(`total elapsed : ${elapsed}ms`);
  if (snap.metadata.errors.length > 0) {
    console.log(`errors        :`);
    for (const e of snap.metadata.errors) {
      console.log(`  - ${e.source}: ${e.message.slice(0, 200)}`);
    }
  } else {
    console.log(`errors        : (none)`);
  }
}

main().catch((err) => {
  console.error("[test-snapshot] FAILED:", err);
  process.exit(1);
});
