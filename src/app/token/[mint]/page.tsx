"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { DetectedSignal } from "@/lib/signals/detector";
import type { TokenTimeline as TokenTimelineType } from "@/lib/signals/timeline";
import {
  TokenTimeline,
  type TokenTimelineMeta,
} from "@/app/components/TokenTimeline";
import { TradeProposeDialog } from "@/app/components/TradeProposeDialog";
import { TokenTopBar } from "@/app/components/TokenTopBar";
import { CandlestickChart, type ChartSignalMarker } from "@/app/components/CandlestickChart";
import { SignalPanel } from "@/app/components/SignalPanel";
import { StatsGrid } from "@/app/components/StatsGrid";
import {
  SignalHistoryTable,
  type SignalHistoryItem,
} from "@/app/components/SignalHistoryTable";
import { RiskOverview } from "@/app/components/RiskOverview";

interface TokenPageData {
  snapshot: AveSnapshot;
  signal: DetectedSignal | null;
  timeline: TokenTimelineType | null;
  meta?: TokenTimelineMeta;
}

export default function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = use(params);
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58();

  const [data, setData] = useState<TokenPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [addingWatch, setAddingWatch] = useState(false);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryItem[]>([]);
  const [fullKlines, setFullKlines] = useState<Array<{ t: number; o: number; h: number; l: number; c: number; vol: number }>>([]);
  const [klinesLoading, setKlinesLoading] = useState(true);


  /* ---- Fetchers ---- */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/token/${encodeURIComponent(mint)}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [mint]);

  const loadWatchlist = useCallback(async () => {
    if (!owner) return;
    try {
      const res = await fetch(`/api/watchlist?owner=${encodeURIComponent(owner)}`);
      const json = await res.json();
      const items = (json.items ?? []) as Array<{ tokenMint: string }>;
      setInWatchlist(items.some((i) => i.tokenMint === mint));
    } catch {
      // ignore
    }
  }, [owner, mint]);

  const loadKlines = useCallback(async () => {
    setKlinesLoading(true);
    try {
      const res = await fetch(
        `/api/token/${encodeURIComponent(mint)}/klines?interval=60`,
      );
      const json = await res.json();
      setFullKlines(json.klines ?? []);
    } catch {
      // fallback to snapshot klines
    } finally {
      setKlinesLoading(false);
    }
  }, [mint]);

  const loadSignalHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/signals?mint=${encodeURIComponent(mint)}&limit=50`,
      );
      const json = await res.json();
      setSignalHistory(json.signals ?? []);
    } catch {
      // ignore
    }
  }, [mint]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadKlines();
  }, [loadKlines]);
  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);
  useEffect(() => {
    loadSignalHistory();
  }, [loadSignalHistory]);

  /* ---- Actions ---- */

  async function toggleWatchlist() {
    if (!owner) {
      toast.error("Connect Phantom first");
      return;
    }
    setAddingWatch(true);
    try {
      if (inWatchlist) {
        const res = await fetch(
          `/api/watchlist?owner=${encodeURIComponent(owner)}&mint=${encodeURIComponent(mint)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("remove failed");
        setInWatchlist(false);
        toast.success("Removed from watchlist");
      } else {
        const res = await fetch(`/api/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, mint }),
        });
        if (!res.ok) throw new Error("add failed");
        setInWatchlist(true);
        toast.success("Added to watchlist");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "watchlist error");
    } finally {
      setAddingWatch(false);
    }
  }

  async function runDetection() {
    toast.loading("Detecting signal\u2026", { id: "detect" });
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      toast.success(
        `Signal #${json.detected.signal.number}: ${json.detected.signal.name}`,
        { id: "detect" },
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "detect failed", {
        id: "detect",
      });
    }
  }

  /* ---- Render ---- */

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-4 sm:px-6">
        <div className="skeleton h-16 w-full" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="skeleton h-[400px] lg:col-span-8" />
          <div className="skeleton h-[400px] lg:col-span-4" />
        </div>
        <div className="skeleton h-24 w-full" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 sm:px-6">
        <div className="ave-card border border-red-400/20 bg-red-400/5 p-6 text-sm text-red-400">
          {error}
        </div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 py-4 sm:px-6">
      {/* Section 1: Top Bar */}
      <TokenTopBar
        snapshot={data.snapshot}
        signal={data.signal}
        inWatchlist={inWatchlist}
        addingWatch={addingWatch}
        onToggleWatchlist={toggleWatchlist}
        onReDetect={runDetection}
        onProposeTrade={() => setDialogOpen(true)}
      />

      {/* Section 2+3: Chart + Signal/Collection Panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="ave-card overflow-hidden !p-0">
            {klinesLoading ? (
              <div className="skeleton min-h-[280px] w-full sm:min-h-[400px]" />
            ) : (
              <CandlestickChart
                klines={fullKlines.length > 0 ? fullKlines : data.snapshot.klines}
                totalSupply={data.snapshot.totalSupply}
                signals={signalHistory
                  .filter((s) => s.patternId !== 9)
                  .map((s): ChartSignalMarker => ({
                    time: Math.floor(new Date(s.detectedAt).getTime() / 1000),
                    patternId: s.patternId,
                    patternName: s.patternName,
                    action: s.confidence,
                  }))}
              />
            )}
          </div>
        </div>
        <div className="lg:col-span-4">
          {data.signal && data.signal.signal.number !== 9 ? (
            <SignalPanel
              signal={data.signal}
              onProposeTrade={() => setDialogOpen(true)}
            />
          ) : (
            <RiskOverview mint={mint} />
          )}
        </div>
      </div>

      {/* Section 4: Stats Grid */}
      <StatsGrid snapshot={data.snapshot} signals={signalHistory} />

      {/* Section 5+6: Signal History + Phase Timeline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SignalHistoryTable signals={signalHistory} />
        <TokenTimeline timeline={data.timeline} meta={data.meta} />
      </div>

      {/* Section 7: Risk Overview (when signal panel is shown above, risk goes here) */}
      {data.signal && data.signal.signal.number !== 9 && (
        <RiskOverview mint={mint} />
      )}

      {/* Trade Dialog */}
      <TradeProposeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tokenMint={mint}
        tokenSymbol={data.snapshot.symbol}
        side="buy"
      />
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[color:var(--muted-foreground)]">{label}</dt>
      <dd className="font-mono text-white/90">{value}</dd>
    </div>
  );
}
