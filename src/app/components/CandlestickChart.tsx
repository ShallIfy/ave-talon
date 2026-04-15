"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { KlineCandle } from "@/lib/ave/internal";

export interface ChartSignalMarker {
  /** unix seconds */
  time: number;
  patternId: number;
  patternName: string;
  action: string;
}

const MARKER_CFG: Record<number, { label: string; entry: boolean }> = {
  1:  { label: "Strong",   entry: true },
  2:  { label: "Wait",     entry: false },
  3:  { label: "FOMO",     entry: true },
  4:  { label: "Shake",    entry: false },
  5:  { label: "W.Exit",   entry: false },
  6:  { label: "Dump",     entry: false },
  7:  { label: "Sneak",    entry: true },
  8:  { label: "Div",      entry: false },
  10: { label: "P&W",      entry: true },
  11: { label: "Early",    entry: true },
};

export function CandlestickChart({
  klines,
  totalSupply,
  signals,
  className,
}: {
  klines: KlineCandle[];
  totalSupply?: number | null;
  signals?: ChartSignalMarker[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const mul = totalSupply && totalSupply > 0 ? totalSupply : 1;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0c0c0f" },
        textColor: "rgba(255, 255, 255, 0.48)",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(124, 58, 237, 0.4)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#7c3aed",
        },
        horzLine: {
          color: "rgba(124, 58, 237, 0.4)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#7c3aed",
        },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.08)",
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#7c3aed",
      downColor: "#ef4444",
      borderUpColor: "#a777c2",
      borderDownColor: "#ef4444",
      wickUpColor: "#a777c2",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;

    // Set data — multiply by totalSupply to show mcap instead of price
    const sorted = [...klines].sort((a, b) => a.t - b.t);
    candleSeries.setData(
      sorted.map((k) => ({
        time: k.t as UTCTimestamp,
        open: k.o * mul,
        high: k.h * mul,
        low: k.l * mul,
        close: k.c * mul,
      })),
    );
    volumeSeries.setData(
      sorted.map((k) => ({
        time: k.t as UTCTimestamp,
        value: k.vol,
        color:
          k.c >= k.o
            ? "rgba(124, 58, 237, 0.25)"
            : "rgba(239, 68, 68, 0.25)",
      })),
    );

    // Add signal markers
    if (signals && signals.length > 0) {
      // Build a set of valid candle timestamps for snapping
      const candleTimes = new Set(sorted.map((k) => k.t));

      const markers = signals
        .map((sig) => {
          // Snap signal time to nearest candle
          let snapTime = sig.time;
          if (!candleTimes.has(snapTime)) {
            let best = sorted[0]?.t ?? snapTime;
            let bestDiff = Math.abs(best - snapTime);
            for (const k of sorted) {
              const diff = Math.abs(k.t - snapTime);
              if (diff < bestDiff) {
                best = k.t;
                bestDiff = diff;
              }
            }
            snapTime = best;
          }

          const cfg = MARKER_CFG[sig.patternId];
          const isEntry = cfg?.entry ?? false;
          const label = cfg?.label ?? sig.patternName.slice(0, 4);

          return {
            time: snapTime as UTCTimestamp,
            position: isEntry ? ("belowBar" as const) : ("aboveBar" as const),
            shape: isEntry ? ("arrowUp" as const) : ("arrowDown" as const),
            color: isEntry ? "#22c55e" : "#ef4444",
            text: label,
            size: 1,
          };
        })
        .sort((a, b) => (a.time as number) - (b.time as number));

      createSeriesMarkers(candleSeries, markers);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [klines, totalSupply, signals]);

  if (klines.length === 0) {
    return (
      <div
        className={`flex min-h-[400px] items-center justify-center text-xs text-[color:var(--muted-foreground)] ${className ?? ""}`}
      >
        No price data available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`min-h-[280px] w-full sm:min-h-[400px] ${className ?? ""}`}
    />
  );
}
