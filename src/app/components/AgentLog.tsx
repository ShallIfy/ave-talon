"use client";

// Global agent terminal with in-memory pub/sub.
// Other components can stream into this via pushTerminalLine() without
// prop drilling — the hook subscribes on mount and returns the current buffer.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { solscanTx } from "@/lib/solana/config";

// ── Terminal line kinds ─────────────────────────────────────────
export type TerminalKind =
  | "system"
  | "info"
  | "observe"
  | "decide"
  | "act"
  | "tx-pending"
  | "tx-success"
  | "tx-failed"
  | "warning"
  | "error"
  | "signal"
  | "twitter"
  | "telegram"
  | "research";

export interface TerminalLine {
  id: string;
  kind: TerminalKind;
  ts: number;
  text: string;
  meta?: Record<string, unknown>;
}

// ── Pub/sub store ────────────────────────────────────────────────
const MAX_LINES = 200;
let buffer: TerminalLine[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  // snapshot must be new ref so useSyncExternalStore triggers re-render
  buffer = [...buffer];
  listeners.forEach((l) => l());
}

export function pushTerminalLine(
  kind: TerminalKind,
  text: string,
  meta?: Record<string, unknown>,
): void {
  const line: TerminalLine = {
    id: `${Date.now()}-${counter++}`,
    kind,
    ts: Date.now(),
    text,
    meta,
  };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer = buffer.slice(-MAX_LINES);
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return buffer;
}

const EMPTY_LINES: TerminalLine[] = [];
function getServerSnapshot(): TerminalLine[] {
  return EMPTY_LINES;
}

export function useTerminalLines(): TerminalLine[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── Boot sequence ────────────────────────────────────────────────
const BOOT_LINES: Array<[TerminalKind, string, number]> = [
  ["system", "AVE Agent Terminal v1.0 · Solana mainnet", 0],
  ["system", "boot ok · observer mode · signing via Phantom", 120],
  ["info", "loading signal matrix · 5 dim × 10 pattern", 280],
  ["info", "connecting to ave claw + internal api", 440],
  ["info", "subscribed to /api/signals · polling 20s", 620],
  ["system", "ready · awaiting instructions ▮", 780],
];

let booted = false;
function runBoot() {
  if (booted) return;
  booted = true;
  BOOT_LINES.forEach(([k, text, delay]) => {
    setTimeout(() => pushTerminalLine(k, text), delay);
  });
}

// ── Color mapping ────────────────────────────────────────────────
const KIND_COLOR: Record<TerminalKind, string> = {
  system: "text-[color:var(--ave-teal)]",
  info: "text-[color:var(--muted-foreground)]",
  observe: "text-blue-300",
  decide: "text-[color:var(--ave-purple)]",
  act: "text-[color:var(--ave-teal)]",
  "tx-pending": "text-yellow-300",
  "tx-success": "text-[color:var(--ave-teal)]",
  "tx-failed": "text-red-400",
  warning: "text-yellow-400",
  error: "text-red-400",
  signal: "text-[color:var(--ave-teal)]",
  twitter: "text-sky-400",
  telegram: "text-blue-400",
  research: "text-[color:var(--ave-purple)]",
};

const KIND_PREFIX: Record<TerminalKind, string> = {
  system: "sys ",
  info: "info",
  observe: "obsv",
  decide: "deci",
  act: "act ",
  "tx-pending": "tx  ",
  "tx-success": "ok  ",
  "tx-failed": "fail",
  warning: "warn",
  error: "err ",
  signal: "sig ",
  twitter: "twtr",
  telegram: "tg  ",
  research: "rsc ",
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

// ── Component ────────────────────────────────────────────────────
export function AgentLog({ className }: { className?: string }) {
  const lines = useTerminalLines();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll] = useState(true);

  // Boot once on mount.
  useEffect(() => {
    runBoot();
  }, []);

  // Auto-scroll to bottom on new lines.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div
      className={cn(
        "ave-card-premium terminal-body relative overflow-hidden !p-0",
        className,
      )}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-[color:var(--card-border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--ave-teal)]/80" />
          </div>
          <span className="ml-2 font-mono text-[11px] tracking-wider text-[color:var(--muted-foreground)]">
            ave@solana — agent terminal
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="pulse-dot" />
          <span className="font-mono text-[10px] text-[color:var(--ave-teal)]">LIVE</span>
        </div>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className="scrollbar-none max-h-[360px] overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-[color:var(--muted-foreground)]">
            <span className="text-[color:var(--ave-teal)]">$</span> waiting for events…{" "}
            <span className="terminal-cursor inline-block h-3 w-1.5 translate-y-0.5 rounded-sm bg-[color:var(--ave-teal)]" />
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="terminal-line flex gap-2">
              <span className="text-[color:var(--muted-foreground)]/60">
                {formatTs(line.ts)}
              </span>
              <span className={cn("shrink-0 font-bold uppercase", KIND_COLOR[line.kind])}>
                {KIND_PREFIX[line.kind]}
              </span>
              <span className={cn("flex-1 break-words", KIND_COLOR[line.kind])}>
                {line.text}
                {typeof line.meta?.txSig === "string" && (
                  <a
                    href={solscanTx(line.meta.txSig)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-[color:var(--ave-teal)] underline"
                  >
                    solscan ↗
                  </a>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
