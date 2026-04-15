"use client";

// OrchestratorBridge — client-side poller that pulls new server-side
// orchestrator lines and replays them into the global AgentLog buffer
// via pushTerminalLine. Mount once anywhere in the tree (e.g. AppShell).
//
// Poll interval: 5s. Uses /api/agent/orchestrator?stream=1&since=<seq>
// to fetch only new lines since last seq.

import { useEffect, useRef } from "react";
import { pushTerminalLine, type TerminalKind } from "./AgentLog";

interface ServerLine {
  seq: number;
  ts: number;
  kind: string;
  text: string;
  meta?: Record<string, unknown>;
}

interface StreamPayload {
  latestSeq: number;
  lines: ServerLine[];
}

const VALID_KINDS: readonly TerminalKind[] = [
  "system",
  "info",
  "observe",
  "decide",
  "act",
  "tx-pending",
  "tx-success",
  "tx-failed",
  "warning",
  "error",
  "signal",
  "twitter",
  "telegram",
  "research",
] as const;

function toKind(k: string): TerminalKind {
  return (VALID_KINDS as readonly string[]).includes(k)
    ? (k as TerminalKind)
    : "info";
}

export function OrchestratorBridge() {
  const sinceRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;

    async function poll() {
      try {
        const url = `/api/agent/orchestrator?stream=1&since=${sinceRef.current}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as StreamPayload;
        if (!mountedRef.current) return;
        for (const line of payload.lines) {
          if (line.seq <= sinceRef.current) continue;
          sinceRef.current = line.seq;
          pushTerminalLine(toKind(line.kind), line.text, line.meta);
        }
        if (payload.latestSeq > sinceRef.current) {
          sinceRef.current = payload.latestSeq;
        }
      } catch {
        // swallow — next tick retries
      }
    }

    // Initial poll immediately, then every 5s
    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, []);

  return null;
}
