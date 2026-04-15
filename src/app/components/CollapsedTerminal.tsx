"use client";

// CollapsedTerminal — compressed 120px preview of the agent log for the
// dashboard. Shows last 4 lines + link to the full /terminal page.
// Subscribes to the same global buffer as AgentLog via useTerminalLines.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useTerminalLines, pushTerminalLine, type TerminalLine } from "./AgentLog";
import { cn } from "@/lib/utils";

const KIND_COLOR: Record<string, string> = {
  system: "text-[var(--ave-accent-bright)]",
  info: "text-white/70",
  observe: "text-[var(--ave-teal)]",
  decide: "text-yellow-400/80",
  act: "text-[var(--ave-accent)]",
  "tx-pending": "text-yellow-400/80",
  "tx-success": "text-[var(--ave-accent-bright)]",
  "tx-failed": "text-red-400",
  warning: "text-yellow-400/80",
  error: "text-red-400",
  signal: "text-[var(--ave-accent-bright)]",
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export function CollapsedTerminal() {
  const lines = useTerminalLines();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cold-start boot if buffer is empty (e.g. user lands directly on /dashboard)
  useEffect(() => {
    if (lines.length === 0) {
      pushTerminalLine("system", "AVE Agent Terminal v1.0 · Solana mainnet");
      pushTerminalLine("info", "observer mode · signing via Phantom");
      pushTerminalLine("info", "subscribed to /api/signals · polling 20s");
      pushTerminalLine("system", "ready · awaiting instructions ▮");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to latest
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const tail = lines.slice(-6);

  return (
    <div className="ave-card-premium !p-0">
      <div className="flex items-center justify-between border-b border-[var(--card-border)] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse bg-[var(--ave-accent)]" />
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-white/80">
            agent_terminal
          </h2>
          <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            {lines.length} lines
          </span>
        </div>
        <Link
          href="/terminal"
          className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)] hover:text-[var(--ave-accent-bright)]"
        >
          expand →
        </Link>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-none max-h-[120px] min-h-[120px] overflow-y-auto bg-black/30 px-4 py-2 font-mono text-[10px] leading-[1.55]"
      >
        {tail.length === 0 ? (
          <div className="text-white/25">$ waiting…</div>
        ) : (
          tail.map((line: TerminalLine) => (
            <div key={line.id} className="flex gap-2">
              <span className="shrink-0 text-white/20">{formatTs(line.ts)}</span>
              <span className={cn("truncate", KIND_COLOR[line.kind] ?? "text-white/70")}>
                {line.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
