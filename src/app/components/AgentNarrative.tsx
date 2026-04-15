"use client";

// AgentNarrative — full-width AI-generated market narrative for the
// dashboard. Fetches /api/agent/narrative (server-cached 5min), shows
// generating skeleton on first load, typing cursor on display.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface NarrativePayload {
  text: string;
  generatedAt: number;
  source: "ai" | "fallback";
  cached: boolean;
  ageMs: number;
  stats?: {
    signals24h: number;
    highConf24h: number;
    scannedTokens: number;
  };
}

function ageLabel(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function AgentNarrative() {
  const [data, setData] = useState<NarrativePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const res = await fetch("/api/agent/narrative");
        const json = (await res.json()) as NarrativePayload;
        if (!cancel) setData(json);
      } catch {
        // noop
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    // Refresh every 5 minutes to match server cache TTL
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="relative border border-[rgba(124,58,237,0.35)] bg-[rgba(124,58,237,0.03)] px-5 py-4">
      {/* header */}
      <div className="mb-3 flex items-center justify-between border-b border-[rgba(124,58,237,0.2)] pb-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 bg-[var(--ave-accent-bright)]" />
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ave-accent-bright)]">
            Agent Narrative
          </h2>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {data ? ageLabel(data.ageMs) : "loading…"}
          {data?.cached && <span className="ml-1 text-white/30">· cached</span>}
        </div>
      </div>

      {/* body */}
      {loading && !data ? (
        <div className="space-y-2">
          <div className="h-3 w-full skeleton" />
          <div className="h-3 w-[85%] skeleton" />
          <div className="h-3 w-[60%] skeleton" />
        </div>
      ) : (
        <p className="font-mono text-[12px] leading-[1.65] tracking-[0.01em] text-white/85">
          {data?.text ?? "—"}
          <span className="ml-0.5 inline-block h-[12px] w-[6px] translate-y-[1px] animate-pulse bg-[var(--ave-accent-bright)]" />
        </p>
      )}

      {/* footer stats */}
      {data?.stats && (
        <div className="mt-3 flex gap-4 border-t border-[rgba(124,58,237,0.15)] pt-2 font-mono text-[8px] uppercase tracking-[0.14em] text-white/40">
          <span>
            <span className="text-white/25">24h Signals:</span> {data.stats.signals24h}
          </span>
          <span>
            <span className="text-white/25">High Conf:</span> {data.stats.highConf24h}
          </span>
          <span>
            <span className="text-white/25">Scanned:</span> {data.stats.scannedTokens}
          </span>
          {data.source === "ai" && (
            <span className="ml-auto text-[var(--ave-accent-bright)]/40" title="AI-generated narrative">
              AI
            </span>
          )}
        </div>
      )}
    </div>
  );
}
