// Scheduler singleton — wraps OrchestratorEngine in a setInterval loop.
//
// Lifecycle:
//   ensureStarted()  → idempotent boot, safe to call from layout / API routes
//   getStatus()      → read-only snapshot for /api/agent/orchestrator
//   kickCycle()      → force run cycle right now (POST /api/agent/orchestrator)
//   stop()           → testing / debug

import {
  OrchestratorEngine,
  DEFAULT_CONFIG,
  type CycleResult,
  type CycleSignalSummary,
  type OrchestratorConfig,
} from "./engine";
import { pushOrchestratorLine } from "./terminal";

interface SchedulerState {
  engine: OrchestratorEngine;
  intervalId: NodeJS.Timeout | null;
  startedAt: number;
  running: boolean;
  inflight: boolean;
  cyclesTotal: number;
  lastCycleAt: number;
  lastCycleDurationMs: number;
  nextCycleAt: number;
  totals: {
    tokensScanned: number;
    signalsDetected: number;
    signalsPersisted: number;
    dedupSkipped: number;
    errors: number;
  };
  lastCycle: CycleResult | null;
  history: CycleResult[]; // recent N cycles
}

const MAX_HISTORY = 20;

// Use globalThis to survive Turbopack HMR module reloads.
// Module-level `let` gets wiped on HMR, but globalThis persists.
const GLOBAL_KEY = "__ave_orchestrator_state__" as const;

function getState(): SchedulerState | null {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as SchedulerState | null ?? null;
}
function setState(s: SchedulerState | null) {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = s;
}

// Compat alias
let state: SchedulerState | null = getState();

function init(configOverride: Partial<OrchestratorConfig> = {}): SchedulerState {
  const engine = new OrchestratorEngine(configOverride);
  return {
    engine,
    intervalId: null,
    startedAt: 0,
    running: false,
    inflight: false,
    cyclesTotal: 0,
    lastCycleAt: 0,
    lastCycleDurationMs: 0,
    nextCycleAt: 0,
    totals: {
      tokensScanned: 0,
      signalsDetected: 0,
      signalsPersisted: 0,
      dedupSkipped: 0,
      errors: 0,
    },
    lastCycle: null,
    history: [],
  };
}

async function runOne(s: SchedulerState): Promise<CycleResult | null> {
  if (s.inflight) {
    pushOrchestratorLine("warning", "cycle already in-flight, skipping tick");
    return null;
  }
  s.inflight = true;
  try {
    const res = await s.engine.runCycle();
    s.cyclesTotal++;
    s.lastCycleAt = res.finishedAt;
    s.lastCycleDurationMs = res.durationMs;
    s.nextCycleAt = s.lastCycleAt + s.engine.config.intervalMs;
    s.totals.tokensScanned += res.scanned;
    s.totals.signalsDetected += res.detected;
    s.totals.signalsPersisted += res.persisted;
    s.totals.dedupSkipped += res.dedupSkipped;
    s.totals.errors += res.errors.length;
    s.lastCycle = res;
    s.history.push(res);
    if (s.history.length > MAX_HISTORY) {
      s.history = s.history.slice(-MAX_HISTORY);
    }
    return res;
  } catch (err) {
    s.totals.errors++;
    pushOrchestratorLine(
      "error",
      `cycle crashed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    s.inflight = false;
  }
}

export function ensureOrchestratorStarted(
  configOverride: Partial<OrchestratorConfig> = {},
): void {
  // Read from globalThis (survives HMR)
  state = getState();

  if (state?.running) return;

  // If old state exists but not running, clean up stale interval
  if (state?.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  if (!state) {
    state = init(configOverride);
    setState(state);
  }

  state.running = true;
  state.startedAt = Date.now();
  state.nextCycleAt = Date.now() + state.engine.config.intervalMs;

  pushOrchestratorLine(
    "system",
    `orchestrator started · interval ${state.engine.config.intervalMs / 1000}s · concurrency ${state.engine.config.concurrency} · sources ${state.engine.config.sources.join("+")}`,
  );

  // Catchup recent ENTRY signals that weren't notified (e.g. from before restart),
  // then fire the first scan cycle.
  const first = setTimeout(async () => {
    try {
      await state!.engine.catchupRecentEntries();
    } catch (err) {
      pushOrchestratorLine("warning", `catchup error: ${String(err).slice(0, 120)}`);
    }
    void runOne(state!);
  }, 3_000);
  first.unref?.();

  state.intervalId = setInterval(() => {
    void runOne(state!);
  }, state.engine.config.intervalMs);
  state.intervalId.unref?.();
}

export function getOrchestratorStatus() {
  state = getState();
  if (!state) {
    return {
      running: false,
      startedAt: 0,
      config: DEFAULT_CONFIG,
      cycles: {
        total: 0,
        lastAt: 0,
        lastDurationMs: 0,
        nextAt: 0,
        inflight: false,
      },
      totals: {
        tokensScanned: 0,
        signalsDetected: 0,
        signalsPersisted: 0,
        dedupSkipped: 0,
        errors: 0,
      },
      dedupTracked: 0,
      lastCycle: null,
    };
  }
  return {
    running: state.running,
    startedAt: state.startedAt,
    config: state.engine.config,
    cycles: {
      total: state.cyclesTotal,
      lastAt: state.lastCycleAt,
      lastDurationMs: state.lastCycleDurationMs,
      nextAt: state.nextCycleAt,
      inflight: state.inflight,
    },
    totals: state.totals,
    dedupTracked: state.engine.dedup.size(),
    lastCycle: state.lastCycle
      ? {
          id: state.lastCycle.id,
          startedAt: state.lastCycle.startedAt,
          finishedAt: state.lastCycle.finishedAt,
          durationMs: state.lastCycle.durationMs,
          candidates: state.lastCycle.candidates,
          scanned: state.lastCycle.scanned,
          detected: state.lastCycle.detected,
          persisted: state.lastCycle.persisted,
          dedupSkipped: state.lastCycle.dedupSkipped,
          signals: state.lastCycle.signals,
          errors: state.lastCycle.errors,
        }
      : null,
  };
}

export async function kickCycle(): Promise<CycleResult | null> {
  state = getState();
  if (!state) {
    ensureOrchestratorStarted();
    state = getState();
  }
  if (!state) return null;
  return runOne(state);
}

// ─────────────────────────────────────────────────────────────────────────
// Live signal feed — read-only access to the in-memory cycle history.
// Bypasses DB entirely. Dedupes by mint (keeps most-recent-by-time), ranks
// by composite score × confidence weight, and paginates without state.
// ─────────────────────────────────────────────────────────────────────────

export interface LiveSignalRow extends CycleSignalSummary {
  cycleId: string;
}

const CONF_WEIGHT: Record<string, number> = {
  HIGH: 1.0,
  MED: 0.7,
  MEDIUM: 0.7,
  LOW: 0.4,
  NONE: 0.15,
};

export interface LiveSignalsPage {
  signals: LiveSignalRow[];
  total: number; // after dedup, before pagination
  offset: number;
  limit: number;
  hasMore: boolean;
  generatedAt: number; // unix ms
  lastCycleAt: number;
  orchestratorRunning: boolean;
}

export function getRecentSignals(
  limit: number,
  offset: number,
  options: { includeNoSignal?: boolean; minConfidence?: string } = {},
): LiveSignalsPage {
  const { includeNoSignal = false, minConfidence } = options;
  const minRank = minConfidence ? (CONF_WEIGHT[minConfidence] ?? 0) : 0;

  state = getState();
  if (!state) {
    return {
      signals: [],
      total: 0,
      offset,
      limit,
      hasMore: false,
      generatedAt: Date.now(),
      lastCycleAt: 0,
      orchestratorRunning: false,
    };
  }

  // 1. Flatten all signals across cycle history (newest cycle last).
  //    Also include the in-flight lastCycle so the feed ticks forward as
  //    soon as a cycle finishes without waiting for history rotation.
  const byMint = new Map<string, LiveSignalRow>();
  const pushCycle = (cycle: CycleResult) => {
    for (const s of cycle.signals) {
      if (!includeNoSignal && s.patternId === 9) continue;
      if (s.dedup) continue; // already seen within dedup window
      const w = CONF_WEIGHT[s.confidence] ?? 0.15;
      if (w < minRank) continue;
      const existing = byMint.get(s.mint);
      if (!existing || s.detectedAt > existing.detectedAt) {
        byMint.set(s.mint, { ...s, cycleId: cycle.id });
      }
    }
  };
  for (const cyc of state.history) pushCycle(cyc);
  if (state.lastCycle && !state.history.includes(state.lastCycle)) {
    pushCycle(state.lastCycle);
  }

  // 2. Rank by score × confidence weight (same formula as old MomentumFeed).
  const ranked = Array.from(byMint.values()).sort((a, b) => {
    const wa = (CONF_WEIGHT[a.confidence] ?? 0.15) * a.score;
    const wb = (CONF_WEIGHT[b.confidence] ?? 0.15) * b.score;
    return wb - wa;
  });

  // 3. Window for pagination.
  const total = ranked.length;
  const page = ranked.slice(offset, offset + limit);

  return {
    signals: page,
    total,
    offset,
    limit,
    hasMore: offset + limit < total,
    generatedAt: Date.now(),
    lastCycleAt: state.lastCycleAt,
    orchestratorRunning: state.running,
  };
}

export function stopOrchestrator(): void {
  state = getState();
  if (!state) return;
  if (state.intervalId) clearInterval(state.intervalId);
  state.intervalId = null;
  state.running = false;
  pushOrchestratorLine("system", "orchestrator stopped");
}
