"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { MomentumFeed } from "@/app/components/MomentumFeed";
import { PulseStrip } from "@/app/components/PulseStrip";
import { PatternHeatmap } from "@/app/components/PatternHeatmap";
import { AgentNarrative } from "@/app/components/AgentNarrative";
import { WatchlistPulse } from "@/app/components/WatchlistPulse";
import { RecentGraduates } from "@/app/components/RecentGraduates";
import { ActionBanner } from "@/app/components/ActionBanner";

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58();

  return (
    <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 px-4 py-6 sm:px-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--card-border)] pb-4">
        <div>
          <h1 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/90">
            ave_dashboard
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            solana token signal scanner
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {owner ? (
            <span>
              {owner.slice(0, 6)}…{owner.slice(-4)}
            </span>
          ) : (
            "wallet not connected"
          )}
        </div>
      </div>

      {/* Row 1 — Pulse strip */}
      <PulseStrip />

      {/* Action alert — top ENTRY/EXIT signal for beginners */}
      <ActionBanner />

      {/* Row 2 — Agent narrative (most readable for beginners) */}
      <AgentNarrative />

      {/* Row 3 — Momentum feed (8) + Pattern heatmap (4), matched height */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <div className="ave-card-premium flex flex-col !p-5 lg:col-span-8 lg:max-h-[520px]">
          <MomentumFeed />
        </div>
        <div className="lg:col-span-4">
          <PatternHeatmap />
        </div>
      </div>

      {/* Row 4 — Watchlist pulse (6) + Recent graduates (6) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <WatchlistPulse />
        </div>
        <div className="lg:col-span-6">
          <RecentGraduates />
        </div>
      </div>
    </main>
  );
}
