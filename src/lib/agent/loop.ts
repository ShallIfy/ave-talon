// OBSERVE → DECIDE → ACT orchestration for a single token cycle.

import { buildAveSnapshot } from "@/lib/ave/snapshot";
import { detectSignalFromSnapshot } from "@/lib/signals/detector";
import { runReasoningEngine } from "./engine";
import { checkSafety, DEFAULT_STRATEGY } from "./safety";
import { appendAgentLog, getLastDecision } from "./logger";
import type {
  AgentCycleResult,
  StrategyConfig,
  ProposedTransaction,
} from "@/lib/types";

/**
 * Run one full agent cycle on a single token.
 *
 * For hackathon MVP this is purely "propose mode":
 *   - Build snapshot
 *   - Detect signal
 *   - Ask Claude for a decision
 *   - Run safety check
 *   - Return proposed actions (no execution)
 *
 * Mode `execute` is reserved for post-hackathon; currently behaves like propose.
 */
export async function runAgentCycle(
  tokenMint: string,
  config: StrategyConfig = DEFAULT_STRATEGY,
): Promise<AgentCycleResult> {
  const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const phases = {
    observe: { durationMs: 0, errors: [] as string[] },
    decide: { durationMs: 0 },
    act: { durationMs: 0, safetyPassed: false, violations: [] as string[] },
  };

  // PHASE 1: OBSERVE
  const observeStart = Date.now();
  const snapshot = await buildAveSnapshot(tokenMint);
  const signal = detectSignalFromSnapshot(snapshot);
  phases.observe.durationMs = Date.now() - observeStart;
  phases.observe.errors = snapshot.metadata.errors.map(
    (e) => `${e.source}: ${e.message}`,
  );

  // PHASE 2: DECIDE
  const decideStart = Date.now();
  const previousDecision = getLastDecision();
  const decision = await runReasoningEngine(snapshot, signal, previousDecision);
  decision.timestamp = Date.now();
  phases.decide.durationMs = Date.now() - decideStart;

  // PHASE 3: ACT (propose-only in observer mode)
  const actStart = Date.now();
  const safetyCheck = checkSafety(decision, signal, config);
  phases.act.safetyPassed = safetyCheck.passed;
  phases.act.violations = safetyCheck.violations;

  // We do not build Jupiter txs server-side in the agent cycle — the chat
  // tool `trade_propose` handles that when the user explicitly asks.
  const proposedTransactions: ProposedTransaction[] = [];
  phases.act.durationMs = Date.now() - actStart;

  const result: AgentCycleResult = {
    cycleId,
    timestamp: Date.now(),
    snapshot,
    signal,
    decision,
    proposedTransactions: proposedTransactions.length > 0 ? proposedTransactions : undefined,
    phases,
  };

  appendAgentLog(result);
  return result;
}
