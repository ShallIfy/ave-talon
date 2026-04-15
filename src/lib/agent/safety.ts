// Safety rules for AVE AI — Solana observer mode.
// These are hard constraints independent of Claude's reasoning.

import {
  MAX_PER_TRADE_SOL,
  DAILY_LIMIT_SOL,
  DEFAULT_SLIPPAGE_BPS,
} from "@/lib/solana/config";
import type {
  AgentDecision,
  AgentAction,
  StrategyConfig,
  SafetyCheckResult,
} from "@/lib/types";
import type { DetectedSignal } from "@/lib/signals/detector";

export const DEFAULT_STRATEGY: StrategyConfig = {
  riskProfile: "balanced",
  maxPerTradeSol: MAX_PER_TRADE_SOL,
  dailyLimitSol: DAILY_LIMIT_SOL,
  defaultSlippageBps: DEFAULT_SLIPPAGE_BPS,
  minSignalScore: 50,
};

/**
 * Check whether the proposed actions from a decision are safe to act on.
 *
 * Rules:
 *  1. No trades on DANGER actions (Pattern #5 Exit Signal, #6 Full Dump).
 *  2. Per-trade SOL cap.
 *  3. Daily cumulative cap (caller supplies `dailySpendSol`).
 *  4. Slippage must not exceed 10% (1000 bps).
 *  5. Signal score must clear `minSignalScore` for any buy.
 */
export function checkSafety(
  decision: AgentDecision,
  signal: DetectedSignal | null,
  config: StrategyConfig = DEFAULT_STRATEGY,
  dailySpendSol: number = 0,
): SafetyCheckResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const actions = decision.actions ?? [];

  // Rule 1: block trades on DANGER / EXIT signals
  const sigAction = signal?.signal.action;
  const isDangerSignal = sigAction === "DANGER" || sigAction === "EXIT";
  if (isDangerSignal) {
    for (const a of actions) {
      if (a.type === "propose_buy") {
        violations.push(
          `Signal is ${sigAction} (pattern #${signal?.signal.number}). Blocking buy proposals.`,
        );
      }
    }
  }

  // Rule 5: minimum score for buy actions
  const score = signal?.score ?? 0;
  if (score < config.minSignalScore) {
    for (const a of actions) {
      if (a.type === "propose_buy") {
        warnings.push(
          `Signal score ${score} below min ${config.minSignalScore} — buy suggestion downgraded to watchlist.`,
        );
      }
    }
  }

  // Rule 2 + 4: per-trade cap + slippage check
  for (const a of actions) {
    if (a.type === "propose_buy" || a.type === "propose_sell") {
      if (a.amountSol !== null && a.amountSol > config.maxPerTradeSol) {
        violations.push(
          `Action ${a.type} amount ${a.amountSol} SOL exceeds per-trade cap ${config.maxPerTradeSol} SOL.`,
        );
      }
      const slip = a.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
      if (slip > 1000) {
        violations.push(
          `Slippage ${slip} bps (${slip / 100}%) exceeds 10% hard cap.`,
        );
      }
    }
  }

  // Rule 3: daily cumulative cap
  const proposedBuySol = actions
    .filter((a) => a.type === "propose_buy")
    .reduce((sum, a) => sum + (a.amountSol ?? 0), 0);
  if (dailySpendSol + proposedBuySol > config.dailyLimitSol) {
    violations.push(
      `Daily limit ${config.dailyLimitSol} SOL would be exceeded (spent ${dailySpendSol} + proposed ${proposedBuySol}).`,
    );
  }

  // Strip any unsafe actions before passing along
  const adjusted: AgentAction[] = violations.length === 0
    ? actions
    : actions.filter((a) => a.type !== "propose_buy" && a.type !== "propose_sell");

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    adjustedActions: adjusted,
  };
}
