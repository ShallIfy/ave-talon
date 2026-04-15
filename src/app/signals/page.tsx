"use client";

import { useState } from "react";
import { SignalFeed } from "@/app/components/SignalFeed";
import { cn } from "@/lib/utils";

type Conf = "LOW" | "MED" | "HIGH" | "ALL";

const FILTERS: Array<{ value: Conf; label: string; desc: string }> = [
  { value: "ALL", label: "All", desc: "Every pattern" },
  { value: "LOW", label: "Low+", desc: "Low confidence and above" },
  { value: "MED", label: "Med+", desc: "Medium confidence and above" },
  { value: "HIGH", label: "High", desc: "High confidence only" },
];

export default function SignalsPage() {
  const [filter, setFilter] = useState<Conf>("ALL");

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-end justify-between border-b border-[var(--card-border)] pb-4">
        <div>
          <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
            Signal Feed
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">
            Detected patterns ranked by confidence and time
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-px rounded-sm bg-white/[0.03] p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              title={f.desc}
              className={cn(
                "px-3 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-all",
                filter === f.value
                  ? "bg-[var(--ave-accent)]/20 text-[var(--ave-accent-bright)]"
                  : "text-white/25 hover:text-white/50",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <SignalFeed
        limit={50}
        minConfidence={filter === "ALL" ? undefined : filter}
      />
    </main>
  );
}
