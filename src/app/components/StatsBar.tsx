"use client";

// Top-of-dashboard KPI strip. Fetches fresh counts from /api endpoints.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Stats {
  totalSignalsToday: number;
  highConfidence: number;
  watchlistCount: number;
  openPositions: number;
}

export function StatsBar({ owner }: { owner?: string }) {
  const [stats, setStats] = useState<Stats>({
    totalSignalsToday: 0,
    highConfidence: 0,
    watchlistCount: 0,
    openPositions: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const [sigsRes, highRes, wlRes] = await Promise.all([
          fetch("/api/signals?limit=100").then((r) => r.json()),
          fetch("/api/signals?limit=100&minConfidence=HIGH").then((r) => r.json()),
          owner
            ? fetch(`/api/watchlist?owner=${encodeURIComponent(owner)}`).then((r) => r.json())
            : Promise.resolve({ items: [] }),
        ]);
        if (cancel) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStart = today.getTime();

        const signals = (sigsRes.signals ?? []) as Array<{ detectedAt: string }>;
        const todaySignals = signals.filter(
          (s) => new Date(s.detectedAt).getTime() >= todayStart,
        );

        setStats({
          totalSignalsToday: todaySignals.length,
          highConfidence: (highRes.signals ?? []).length,
          watchlistCount: (wlRes.items ?? []).length,
          openPositions: 0, // observer-only MVP
        });
      } catch {
        // ignore
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [owner]);

  const items: Array<{
    label: string;
    value: string | number;
    accent?: "teal" | "purple" | "default";
    primary?: boolean;
  }> = [
    {
      label: "Signals today",
      value: loading ? "—" : stats.totalSignalsToday,
      accent: "teal",
      primary: true,
    },
    { label: "High confidence", value: loading ? "—" : stats.highConfidence, accent: "teal" },
    { label: "Watchlist", value: loading ? "—" : stats.watchlistCount, accent: "purple" },
    { label: "Open positions", value: loading ? "—" : stats.openPositions, accent: "default" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            "stat-card animate-in",
            item.primary && "stat-card-primary",
            `stagger-${i + 1}`,
          )}
        >
          <div className="stat-label">{item.label}</div>
          <div
            className={cn(
              "stat-value mt-1 font-mono",
              item.accent === "teal" && "stat-value-teal",
              item.accent === "purple" && "stat-value-purple",
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
