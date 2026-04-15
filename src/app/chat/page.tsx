"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ------------------------------------------------------------------ */
/*  Suggestions                                                        */
/* ------------------------------------------------------------------ */

const SUGGESTIONS = [
  {
    label: "Scan graduated tokens",
    prompt:
      "Scan graduated Solana memecoins and show me the top 5 by holder growth",
    icon: "⌁",
  },
  {
    label: "Check signal",
    prompt: "What signal does BONK have right now?",
    icon: "◈",
  },
  {
    label: "Compare tokens",
    prompt: "Compare WIF vs POPCAT on holder concentration",
    icon: "⟐",
  },
  {
    label: "Signal feed",
    prompt: "Show me recent high-confidence entries from the signal feed",
    icon: "▣",
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ChatPage() {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? "";

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ walletAddress }),
      }),
    [walletAddress],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text });
      setInput("");
    },
    [sendMessage],
  );

  const msgCount = messages.filter((m) => m.role === "assistant").length;

  return (
    <main className="mx-auto flex h-[calc(100dvh-48px)] w-full max-w-[1200px] flex-col overflow-hidden px-4 py-6 sm:px-6 lg:h-dvh">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-end justify-between border-b border-[var(--card-border)] pb-4">
        <div>
          <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
            Chat
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">
            Sonnet 4.5 · 22 tools · adaptive thinking
          </p>
        </div>

        {/* Status pill */}
        <div className="flex items-center gap-2">
          {msgCount > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-white/20">
              {msgCount} {msgCount === 1 ? "response" : "responses"}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-1.5 w-1.5",
                busy
                  ? "animate-pulse bg-[var(--ave-accent)]"
                  : "bg-emerald-500/80",
              )}
            />
            <span className="font-mono text-[9px] uppercase tracking-widest text-white/25">
              {busy ? "Active" : "Ready"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Messages ───────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="scrollbar-none relative mt-4 mb-4 min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyState onSubmit={submit} />
        ) : (
          <div className="space-y-1">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}

            {/* Streaming indicator */}
            {busy && (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--ave-accent)]/40 bg-[rgba(124,58,237,0.08)]">
                  <div className="typing-dots flex items-center gap-[3px]">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-white/30">
                    {status === "submitted" ? "Thinking" : "Streaming"}
                  </span>
                  <button
                    onClick={stop}
                    className="border border-[var(--card-border)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/30 transition-colors hover:border-red-400/40 hover:text-red-400"
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Input ──────────────────────────────────────────── */}
      <div className="relative">
        {/* Top accent line */}
        <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-[var(--ave-accent)]/20 to-transparent" />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-0 pt-4"
        >
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about a token, scan for signals, propose a trade…"
              disabled={busy}
              className={cn(
                "w-full border border-r-0 border-[var(--card-border)] bg-transparent",
                "px-4 py-3 font-mono text-[13px] text-white",
                "placeholder:text-white/20",
                "transition-colors duration-150",
                "focus:border-[rgba(124,58,237,0.4)] focus:outline-none",
                "disabled:opacity-40",
              )}
            />
          </div>

          <button
            type="submit"
            disabled={busy || !input.trim()}
            className={cn(
              "btn-glow shrink-0 border border-[var(--ave-accent)] !px-6 py-3",
              (busy || !input.trim()) && "pointer-events-none opacity-30",
            )}
          >
            Send
          </button>
        </form>

        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/15">
            Enter to send
          </span>
          {walletAddress ? (
            <span className="font-mono text-[9px] text-white/15">
              {walletAddress.slice(0, 4)}…{walletAddress.slice(-4)}
            </span>
          ) : (
            <span className="font-mono text-[9px] text-white/20">
              No wallet connected
            </span>
          )}
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ onSubmit }: { onSubmit: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12">
      {/* Icon */}
      <div className="relative mb-8">
        <div className="flex h-16 w-16 items-center justify-center border border-[var(--card-border)] bg-white/[0.02]">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[var(--ave-accent)]"
          >
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </svg>
        </div>
        {/* Corner accents */}
        <div className="absolute -top-1 -left-1 h-2 w-2 border-t border-l border-[var(--ave-accent)]/30" />
        <div className="absolute -right-1 -bottom-1 h-2 w-2 border-r border-b border-[var(--ave-accent)]/30" />
      </div>

      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-white/50">
        What do you want to explore?
      </h2>
      <p className="mt-2 font-mono text-[10px] text-white/20">
        22 on-chain tools at your disposal
      </p>

      {/* Suggestion grid */}
      <div className="mt-8 grid w-full max-w-xl grid-cols-2 gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onSubmit(s.prompt)}
            className={cn(
              "group relative border border-[var(--card-border)] bg-transparent",
              "px-4 py-3 text-left transition-all duration-150",
              "hover:border-[rgba(124,58,237,0.35)] hover:bg-[rgba(124,58,237,0.04)]",
            )}
          >
            {/* Accent line top */}
            <div className="absolute top-0 left-0 h-px w-0 bg-[var(--ave-accent)]/50 transition-all duration-300 group-hover:w-full" />

            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 font-mono text-[14px] leading-none text-[var(--ave-accent)]/40 transition-colors group-hover:text-[var(--ave-accent)]/80">
                {s.icon}
              </span>
              <div>
                <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-white/60 transition-colors group-hover:text-white/90">
                  {s.label}
                </div>
                <div className="mt-1 line-clamp-2 font-mono text-[10px] leading-relaxed text-white/25 transition-colors group-hover:text-white/40">
                  {s.prompt}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Message Bubble                                                     */
/* ------------------------------------------------------------------ */

type UiMsg = ReturnType<typeof useChat>["messages"][number];

function isToolPart(p: { type: string }): boolean {
  // AI SDK v6: static tools = "tool-{name}", dynamic = "dynamic-tool"
  return p.type.startsWith("tool-") || p.type === "dynamic-tool";
}

function MessageBubble({ message }: { message: UiMsg }) {
  const isUser = message.role === "user";
  const parts = message.parts ?? [];
  const [thinkOpen, setThinkOpen] = useState(false);

  // Collect parts by type
  const toolParts = parts.filter((p) => isToolPart(p));
  const textParts = parts.filter((p) => p.type === "text");
  const reasoningParts = parts.filter((p) => p.type === "reasoning");

  // Combine text + reasoning into strings
  const fullText = textParts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  const hasText = fullText.trim().length > 0;

  const thinkingText = reasoningParts
    .map((p) => ("reasoning" in p ? (p as { reasoning: string }).reasoning : ""))
    .join("");
  const hasThinking = thinkingText.trim().length > 0;

  return (
    <div
      className={cn(
        "group relative",
        isUser ? "flex justify-end px-2 py-2" : "px-2 py-2",
      )}
    >
      {isUser ? (
        /* ── User message ── */
        <div className="max-w-[80%] border border-[rgba(124,58,237,0.25)] bg-[rgba(124,58,237,0.06)] px-4 py-2.5">
          <div className="text-[13px] text-white/90" style={{ whiteSpace: "pre-wrap" }}>
            {fullText}
          </div>
        </div>
      ) : (
        /* ── Assistant message ── */
        <div className="flex gap-3">
          {/* Avatar */}
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--ave-accent)]/30 bg-[rgba(124,58,237,0.08)]">
            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[var(--ave-accent-bright)]">
              AI
            </span>
          </div>

          <div className="min-w-0 flex-1">
            {/* Thinking block — collapsible */}
            {hasThinking && (
              <div className="mb-2">
                <button
                  onClick={() => setThinkOpen((v) => !v)}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-white/25 transition-colors hover:text-white/50"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    className={cn(
                      "transition-transform duration-150",
                      thinkOpen && "rotate-90",
                    )}
                  >
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                  Thinking
                </button>
                {thinkOpen && (
                  <div className="mt-1.5 border-l-2 border-[var(--ave-accent)]/15 pl-3 font-mono text-[11px] leading-relaxed text-white/30">
                    {thinkingText}
                  </div>
                )}
              </div>
            )}

            {/* Tool invocations */}
            {toolParts.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {toolParts.map((part, i) => (
                  <ToolChip key={i} part={part} />
                ))}
              </div>
            )}

            {/* Markdown content */}
            {hasText && (
              <div className="chat-markdown text-[13px] leading-relaxed text-white/85">
                <Markdown remarkPlugins={[remarkGfm]}>{fullText}</Markdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tool Chip                                                          */
/* ------------------------------------------------------------------ */

function ToolChip({ part }: { part: Record<string, unknown> }) {
  // AI SDK v6: static tool → type="tool-{name}", state on part directly
  //            dynamic tool → type="dynamic-tool", toolName on part directly
  const p = part as {
    type: string;
    toolName?: string;
    state?: string;
    toolInvocation?: { toolName?: string; state?: string };
  };

  let name: string;
  let state: string;

  if (p.type === "dynamic-tool") {
    name = p.toolName ?? "tool";
    state = p.state ?? "input-available";
  } else if (p.type.startsWith("tool-")) {
    name = p.type.replace(/^tool-/, "");
    state = p.state ?? "input-available";
  } else {
    name = p.toolInvocation?.toolName ?? "tool";
    state = p.toolInvocation?.state ?? "call";
  }

  const isComplete = state === "result" || state === "output-available";
  const isRunning =
    state === "call" ||
    state === "partial-call" ||
    state === "input-streaming" ||
    state === "input-available";
  const isError = state === "error";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors",
        isComplete
          ? "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400/60"
          : isError
            ? "border-red-500/20 bg-red-500/[0.05] text-red-400/60"
            : isRunning
              ? "border-[rgba(124,58,237,0.25)] bg-[rgba(124,58,237,0.06)] text-[var(--ave-accent-bright)]"
              : "border-[var(--card-border)] bg-white/[0.02] text-white/30",
      )}
    >
      {isRunning && (
        <div className="h-1 w-1 animate-pulse bg-[var(--ave-accent)]" />
      )}
      {isComplete && <span className="text-emerald-400/50">✓</span>}
      {isError && <span className="text-red-400/50">✗</span>}
      <span>{cleanToolName(name)}</span>
    </div>
  );
}

function cleanToolName(name: string): string {
  return name
    .replace(
      /^(ave_get_|ave_compute_|ave_|scanner_|signal_|token_|trade_|holder_|solana_|jupiter_|watchlist_)/,
      "",
    )
    .replace(/_/g, " ");
}
