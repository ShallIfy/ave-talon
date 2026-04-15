// Server-side terminal buffer for orchestrator events.
//
// Why we need this: pushTerminalLine in AgentLog.tsx is client-only
// (module state in a "use client" component). The orchestrator runs
// on the server and needs a way to stream events to browser clients.
//
// Design: globalThis-backed ring buffer + monotonic seq id. Uses
// globalThis to survive Turbopack HMR module reloads (same pattern
// as scheduler.ts). Clients poll GET /api/agent/orchestrator?stream=1
// &since=<seq> and replay new lines via client-side pushTerminalLine.

export type OrchestratorKind =
  | "system"
  | "info"
  | "observe"
  | "decide"
  | "act"
  | "signal"
  | "warning"
  | "error"
  | "twitter"
  | "telegram"
  | "research";

export interface OrchestratorLine {
  seq: number;
  ts: number;
  kind: OrchestratorKind;
  text: string;
  meta?: Record<string, unknown>;
}

const MAX_LINES = 500;

// Use globalThis to survive Turbopack HMR and ensure the orchestrator
// engine and API route share the same buffer instance.
const BUF_KEY = "__ave_terminal_buffer__" as const;
const SEQ_KEY = "__ave_terminal_seq__" as const;

function getBuffer(): OrchestratorLine[] {
  const g = globalThis as Record<string, unknown>;
  if (!g[BUF_KEY]) g[BUF_KEY] = [];
  return g[BUF_KEY] as OrchestratorLine[];
}

function getSeq(): number {
  const g = globalThis as Record<string, unknown>;
  if (typeof g[SEQ_KEY] !== "number") g[SEQ_KEY] = 1;
  return g[SEQ_KEY] as number;
}

function setSeq(v: number) {
  (globalThis as Record<string, unknown>)[SEQ_KEY] = v;
}

export function pushOrchestratorLine(
  kind: OrchestratorKind,
  text: string,
  meta?: Record<string, unknown>,
): OrchestratorLine {
  const seq = getSeq();
  const line: OrchestratorLine = {
    seq,
    ts: Date.now(),
    kind,
    text,
    meta,
  };
  setSeq(seq + 1);

  const buf = getBuffer();
  buf.push(line);
  if (buf.length > MAX_LINES) {
    const g = globalThis as Record<string, unknown>;
    g[BUF_KEY] = buf.slice(-MAX_LINES);
  }
  return line;
}

export function getOrchestratorLines(sinceSeq = 0, limit = 100): OrchestratorLine[] {
  const buf = getBuffer();
  const slice = sinceSeq > 0 ? buf.filter((l) => l.seq > sinceSeq) : buf;
  return slice.slice(-limit);
}

export function getLatestSeq(): number {
  return getSeq() - 1;
}
