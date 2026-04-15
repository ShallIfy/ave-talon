// AVE AI — core types (Solana / token-centric)
// Ave snapshot types live in src/lib/ave/snapshot.ts.
// This file only holds agent loop + decision types.

import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { DetectedSignal } from "@/lib/signals/detector";

// ═══════════════════════════════════════════════
// Agent decision / action types
// ═══════════════════════════════════════════════

export type AgentActionType =
  | "watchlist_add"
  | "watchlist_remove"
  | "propose_buy"
  | "propose_sell"
  | "alert"
  | "none";

export interface AgentAction {
  type: AgentActionType;
  tokenMint: string | null;
  symbol: string | null;
  amountSol: number | null;
  slippageBps: number | null;
  reasoning: string;
}

export interface AgentDecision {
  timestamp?: number;
  thinking?: string;
  analysis: {
    summary: string;
    signalsDetected?: string[];
    tokensScanned?: number;
    highConfidenceCount?: number;
    risk_level?: "low" | "medium" | "high";
    [key: string]: unknown;
  };
  decision: {
    action: "hold" | "suggest" | "alert" | "watchlist";
    confidence: number;
    urgency?: "none" | "low" | "medium" | "high";
    reasoning: string;
  };
  actions?: AgentAction[];
  user_message: string;
  [key: string]: unknown;
}

export interface ProposedTransaction {
  id: string;
  label: string;
  tokenMint: string;
  side: "buy" | "sell";
  amountSol: number;
  slippageBps: number;
  // Unsigned Jupiter swap transaction, base64 encoded
  unsignedTxB64: string;
  quote: unknown;
  action: AgentAction;
}

export interface AgentCycleResult {
  cycleId: string;
  timestamp: number;
  /** Primary token snapshot used for reasoning. */
  snapshot: AveSnapshot;
  /** Signal detected on the primary token. */
  signal: DetectedSignal | null;
  decision: AgentDecision;
  proposedTransactions?: ProposedTransaction[];
  phases: {
    observe: { durationMs: number; errors: string[] };
    decide: { durationMs: number };
    act: { durationMs: number; safetyPassed: boolean; violations: string[] };
  };
}

// ═══════════════════════════════════════════════
// Strategy + safety
// ═══════════════════════════════════════════════

export interface StrategyConfig {
  riskProfile: "conservative" | "balanced" | "aggressive";
  /** Max SOL per single trade. */
  maxPerTradeSol: number;
  /** Max cumulative SOL per day. */
  dailyLimitSol: number;
  /** Default slippage in basis points (500 = 5%). */
  defaultSlippageBps: number;
  /** Minimum signal score to surface a suggest action. */
  minSignalScore: number;
}

export interface SafetyCheckResult {
  passed: boolean;
  violations: string[];
  warnings: string[];
  adjustedActions: AgentAction[];
}
