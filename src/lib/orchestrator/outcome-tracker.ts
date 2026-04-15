// OutcomeTracker — background job that fills priceAt1h/4h/24h in SignalSnapshot.
//
// Runs every 5 minutes. Each tick queries snapshots whose outcome fields are
// NULL and whose age exceeds the threshold (1h, 4h, 24h). For each, fetches
// the latest kline price and updates the row.
//
// Singleton pattern — same as scheduler.ts.

import { prisma } from "@/lib/db/client";
import { getKlineRange } from "@/lib/ave/internal";
import { pushOrchestratorLine } from "./terminal";

const INTERVAL_NORMAL_MS = 4 * 60 * 60 * 1000; // 4 hours (steady state)
const INTERVAL_BACKFILL_MS = 2 * 60 * 1000; // 2 minutes (while catching up)
const BATCH_LIMIT = 200;
const CONCURRENCY = 8;

interface TrackerState {
  running: boolean;
  intervalId: NodeJS.Timeout | null;
  inflight: boolean;
  backfilling: boolean;
  filled: { h1: number; h4: number; h24: number };
}

let state: TrackerState | null = null;

// ---------------------------------------------------------------------------
// Pass definitions
// ---------------------------------------------------------------------------

interface Pass {
  label: string;
  field: "priceAt1h" | "priceAt4h" | "priceAt24h";
  mcapField: "mcapAt1h" | "mcapAt4h" | "mcapAt24h";
  ageMs: number;
  final?: boolean; // if true, also compute outcomeScore + outcomeAt
}

const PASSES: Pass[] = [
  { label: "1h", field: "priceAt1h", mcapField: "mcapAt1h", ageMs: 60 * 60 * 1000 },
  { label: "4h", field: "priceAt4h", mcapField: "mcapAt4h", ageMs: 4 * 60 * 60 * 1000 },
  { label: "24h", field: "priceAt24h", mcapField: "mcapAt24h", ageMs: 24 * 60 * 60 * 1000, final: true },
];

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function runTick(): Promise<void> {
  if (!state || state.inflight) return;
  state.inflight = true;

  try {
    let totalFilled = 0;
    for (const pass of PASSES) {
      const filled = await runPass(pass);
      totalFilled += filled;
      if (pass.label === "1h") state.filled.h1 += filled;
      else if (pass.label === "4h") state.filled.h4 += filled;
      else state.filled.h24 += filled;
    }

    // Switch interval: if we filled a full batch, still catching up → stay fast.
    // If less than batch, backfill done → switch to normal 4h interval.
    const wasBf = state.backfilling;
    state.backfilling = totalFilled >= BATCH_LIMIT;
    if (wasBf && !state.backfilling) {
      // Transition to steady state
      if (state.intervalId) clearInterval(state.intervalId);
      state.intervalId = setInterval(() => void runTick(), INTERVAL_NORMAL_MS);
      state.intervalId.unref?.();
      pushOrchestratorLine("system", "outcome tracker backfill done → interval 4h");
    }
  } catch (err) {
    pushOrchestratorLine(
      "error",
      `outcome tracker tick failed: ${String(err).slice(0, 140)}`,
    );
  } finally {
    state.inflight = false;
  }
}

async function runPass(pass: Pass): Promise<number> {
  const cutoff = new Date(Date.now() - pass.ageMs);

  // Prioritise ENTRY patterns (#1, #7, #11) — fill them first so WR shows data fast.
  // Then backfill the rest.
  const ENTRY_PATTERNS = [1, 7, 11];

  const entrySnapshots = await prisma.signalSnapshot.findMany({
    where: {
      [pass.field]: null,
      createdAt: { lte: cutoff },
      priceUsd: { gt: 0 },
      signal: { patternId: { in: ENTRY_PATTERNS } },
    },
    select: {
      id: true,
      priceUsd: true,
      createdAt: true,
      signal: {
        select: { tokenMint: true, token: { select: { totalSupply: true } } },
      },
    },
    take: BATCH_LIMIT,
    orderBy: { createdAt: "asc" },
  });

  const remaining = BATCH_LIMIT - entrySnapshots.length;
  const otherSnapshots =
    remaining > 0
      ? await prisma.signalSnapshot.findMany({
          where: {
            [pass.field]: null,
            createdAt: { lte: cutoff },
            priceUsd: { gt: 0 },
            signal: { patternId: { notIn: ENTRY_PATTERNS } },
          },
          select: {
            id: true,
            priceUsd: true,
            createdAt: true,
            signal: {
              select: {
                tokenMint: true,
                token: { select: { totalSupply: true } },
              },
            },
          },
          take: remaining,
          orderBy: { createdAt: "asc" },
        })
      : [];

  const snapshots = [...entrySnapshots, ...otherSnapshots];

  if (snapshots.length === 0) return 0;

  let filled = 0;
  const queue = [...snapshots];

  async function worker() {
    while (queue.length > 0) {
      const snap = queue.shift();
      if (!snap) break;

      try {
        const mint = snap.signal.tokenMint;
        // Fetch klines from detection → detection + window, find ATH (highest high)
        const fromSec = Math.floor(snap.createdAt.getTime() / 1000);
        const toSec = fromSec + Math.floor(pass.ageMs / 1000);
        // Use 1-min candles for 1h (60 candles), 5-min for 4h (48), 15-min for 24h (96)
        const interval: 1 | 5 | 15 =
          pass.ageMs <= 60 * 60 * 1000 ? 1 : pass.ageMs <= 4 * 60 * 60 * 1000 ? 5 : 15;
        const klines = await getKlineRange(mint, fromSec, toSec, "solana", interval);
        if (!klines || klines.length === 0) continue;

        // ATH = highest high in the window
        const ath = Math.max(...klines.map((k) => k.h));
        if (!ath || ath <= 0) continue;

        const totalSupply = snap.signal.token.totalSupply
          ? Number(snap.signal.token.totalSupply)
          : null;
        const mcap = totalSupply && totalSupply > 0 ? totalSupply * ath : null;

        const update: Record<string, unknown> = {
          [pass.field]: ath,
          [pass.mcapField]: mcap,
        };

        // On final pass (24h), compute outcomeScore based on best ATH across all windows
        if (pass.final && snap.priceUsd > 0) {
          update.outcomeScore = ((ath - snap.priceUsd) / snap.priceUsd) * 100;
          update.outcomeAt = new Date();
        }

        await prisma.signalSnapshot.update({
          where: { id: snap.id },
          data: update,
        });

        filled++;
      } catch {
        // skip individual failures
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (filled > 0) {
    pushOrchestratorLine(
      "info",
      `outcome ${pass.label}: filled ${filled}/${snapshots.length} snapshots`,
    );
  }

  return filled;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function ensureOutcomeTrackerStarted(): void {
  if (state?.running) return;

  state = {
    running: true,
    intervalId: null,
    inflight: false,
    backfilling: true, // start in backfill mode (fast interval)
    filled: { h1: 0, h4: 0, h24: 0 },
  };

  pushOrchestratorLine("system", "outcome tracker started · backfill 2m → steady 4h");

  // First tick after 10s (let orchestrator boot first)
  const first = setTimeout(() => void runTick(), 10_000);
  first.unref?.();

  // Start with fast backfill interval; runTick() will switch to 4h when done
  state.intervalId = setInterval(() => void runTick(), INTERVAL_BACKFILL_MS);
  state.intervalId.unref?.();
}

export function getOutcomeTrackerStatus() {
  if (!state) return { running: false, filled: { h1: 0, h4: 0, h24: 0 } };
  return {
    running: state.running,
    inflight: state.inflight,
    filled: state.filled,
  };
}
