"use client";

// Signal Guide — traffic-light grouped view (BUY / WAIT / AVOID).
// Patterns grouped by action for quick scanning; expand to see detail.

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface LiveSignalRow {
  mint: string;
  patternId: number;
  patternName: string;
  action: string;
}

interface LiveSignalsPage {
  signals: LiveSignalRow[];
  total: number;
}

interface Pattern {
  id: number;
  name: string;
  desc: string;
}

interface SignalGroup {
  key: string;
  label: string;
  sublabel: string;
  badgeClass: string;
  countColor: string;
  borderAccent: string;
  patterns: Pattern[];
}

const GROUPS: SignalGroup[] = [
  {
    key: "buy",
    label: "BUY",
    sublabel: "Active buy signals",
    badgeClass: "badge badge-purple",
    countColor: "text-[var(--ave-accent-bright)]",
    borderAccent: "border-[rgba(124,58,237,0.15)]",
    patterns: [
      { id: 1,  name: "Strong Entry",  desc: "Heavy whale distribution, price up, volume active" },
      { id: 11, name: "Early Entry",   desc: "Quiet accumulation, moderate volume — pre-pump" },
      { id: 7,  name: "Sneak Entry",   desc: "Whale slow entry, holders stable — breakout potential" },
    ],
  },
  {
    key: "wait",
    label: "WAIT",
    sublabel: "Unclear, keep watching",
    badgeClass: "badge badge-yellow",
    countColor: "text-[#eab308]",
    borderAccent: "border-[rgba(234,179,8,0.12)]",
    patterns: [
      { id: 2,  name: "Wait (No Vol)",     desc: "Holders up but volume quiet" },
      { id: 3,  name: "FOMO Pump",         desc: "Price rising fast — watch for FOMO" },
      { id: 4,  name: "Shakeout",          desc: "Holders down but whales holding" },
      { id: 8,  name: "Divergence",        desc: "Holders up, price down — mixed signals" },
      { id: 10, name: "Pump + Whale Load", desc: "Strong pump + whale loading — could continue or dump" },
    ],
  },
  {
    key: "avoid",
    label: "AVOID",
    sublabel: "Do not buy",
    badgeClass: "badge badge-red",
    countColor: "text-[#ef4444]",
    borderAccent: "border-[rgba(239,68,68,0.12)]",
    patterns: [
      { id: 5, name: "Whale Exit", desc: "Whales exiting, high volume" },
      { id: 6, name: "Full Dump",  desc: "Everything dropping, whales exiting too" },
    ],
  },
];

export function PatternHeatmap({
  pollMs = 4_000,
}: {
  pollMs?: number;
} = {}) {
  const [rows, setRows] = useState<LiveSignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancel = false;
    async function load(silent: boolean) {
      try {
        const res = await fetch("/api/agent/live-signals?limit=100&offset=0", {
          cache: "no-store",
        });
        const data = (await res.json()) as LiveSignalsPage;
        if (!cancel) setRows(data.signals ?? []);
      } catch {
        // noop
      } finally {
        if (!cancel && !silent) setLoading(false);
      }
    }
    void load(false);
    const id = setInterval(() => void load(true), pollMs);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [pollMs]);

  const countByPattern = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) {
      m.set(r.patternId, (m.get(r.patternId) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  function groupCount(g: SignalGroup): number {
    let total = 0;
    for (const p of g.patterns) total += countByPattern.get(p.id) ?? 0;
    return total;
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeCount = rows.filter((r) => r.patternId !== 9).length;

  return (
    <div className="ave-card-premium flex h-full flex-col !p-4">
      {/* header */}
      <div className="flex items-baseline justify-between border-b border-[var(--card-border)] pb-2">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/90">
          Signal Guide
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {activeCount} active
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="mt-3 flex-1 skeleton" />
      ) : (
        <div className="mt-2 flex flex-1 flex-col gap-0 overflow-y-auto">
          {GROUPS.map((g) => {
            const count = groupCount(g);
            const isOpen = expanded.has(g.key);

            return (
              <div key={g.key} className={cn("border-b border-[var(--card-border)]", isOpen && g.borderAccent)}>
                {/* group header — clickable */}
                <button
                  onClick={() => toggle(g.key)}
                  className="data-row flex w-full items-center gap-2.5 px-2 py-2.5"
                >
                  {/* badge label */}
                  <span className={g.badgeClass}>{g.label}</span>

                  {/* sublabel */}
                  <span className="flex-1 truncate text-left font-mono text-[8px] tracking-[0.02em] text-white/30">
                    {g.sublabel}
                  </span>

                  {/* count */}
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[11px] font-medium",
                      "tabular-nums",
                      count > 0 ? g.countColor : "text-white/15",
                    )}
                  >
                    {count}
                  </span>

                  {/* chevron */}
                  <svg
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 text-white/20 transition-transform duration-150",
                      isOpen && "rotate-180",
                    )}
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 4.5L6 7.5L9 4.5" />
                  </svg>
                </button>

                {/* expanded patterns */}
                {isOpen && (
                  <div className="border-t border-[var(--card-border)] px-2 pb-2 pt-1">
                    {g.patterns.map((p) => {
                      const pCount = countByPattern.get(p.id) ?? 0;
                      return (
                        <div
                          key={p.id}
                          className="flex items-baseline gap-2 py-1 pl-[calc(0.5rem+0.18rem+1rem)]"
                        >
                          <span className="font-mono text-[8px] font-medium uppercase tracking-[0.06em] text-white/50">
                            {p.name}
                          </span>
                          {pCount > 0 && (
                            <span className={cn("font-mono text-[8px] font-medium tabular-nums", g.countColor)}>
                              {pCount}
                            </span>
                          )}
                          <span className="ml-auto font-mono text-[7px] tracking-[0.02em] text-white/20">
                            {p.desc}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* No Signal — dimmed footer */}
          {(countByPattern.get(9) ?? 0) > 0 && (
            <div className="mt-auto flex items-center gap-2.5 px-2 py-2">
              <span className="badge badge-slate">—</span>
              <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-white/25">
                No Signal
              </span>
              <span className="ml-auto font-mono text-[9px] tabular-nums text-white/20">
                {countByPattern.get(9)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
