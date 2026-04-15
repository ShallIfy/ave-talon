// In-memory agent cycle log (ring buffer). Zero external deps.
// Persists for the lifetime of the server process.

import type { AgentCycleResult, AgentDecision } from "@/lib/types";

const MAX_LOG_ENTRIES = 100;
let agentLog: AgentCycleResult[] = [];

export function appendAgentLog(result: AgentCycleResult) {
  agentLog.unshift(result); // newest first
  if (agentLog.length > MAX_LOG_ENTRIES) {
    agentLog = agentLog.slice(0, MAX_LOG_ENTRIES);
  }
}

export function getAgentLog(limit = 20): AgentCycleResult[] {
  return agentLog.slice(0, limit);
}

export function getLastDecision(): AgentDecision | undefined {
  return agentLog[0]?.decision;
}

export function clearAgentLog() {
  agentLog = [];
}
