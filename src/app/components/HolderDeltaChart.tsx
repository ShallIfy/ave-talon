"use client";

// Tiny inline sparkline for holder count over time.
// Zero-dep SVG — no recharts needed at this scale.

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface HolderPoint {
  time: number;
  holders_count?: number | null;
}

export function HolderDeltaChart({
  series,
  width = 160,
  height = 40,
  className,
}: {
  series: HolderPoint[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const { path, area, trend, first, last } = useMemo(() => {
    const pts = series
      .map((p) => p.holders_count ?? 0)
      .filter((v) => typeof v === "number");
    if (pts.length < 2) {
      return { path: "", area: "", trend: 0, first: 0, last: 0 };
    }
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const step = width / (pts.length - 1);
    const toY = (v: number) => height - ((v - min) / range) * (height - 4) - 2;

    let line = "";
    pts.forEach((v, i) => {
      const x = i * step;
      const y = toY(v);
      line += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    const areaPath = `${line} L ${width} ${height} L 0 ${height} Z`;
    return {
      path: line,
      area: areaPath,
      trend: pts[pts.length - 1] - pts[0],
      first: pts[0],
      last: pts[pts.length - 1],
    };
  }, [series, width, height]);

  if (!path) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-[10px] text-[color:var(--muted-foreground)]",
          className,
        )}
        style={{ width, height }}
      >
        no data
      </div>
    );
  }

  const isUp = trend >= 0;
  const stroke = isUp ? "#a777c2" : "#ef4444";
  const fill = isUp ? "rgba(124,58,237,0.15)" : "rgba(239,68,68,0.15)";

  return (
    <div className={cn("relative", className)} style={{ width, height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        <path d={area} fill={fill} />
        <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute inset-x-0 -bottom-4 flex justify-between font-mono text-[9px] text-[color:var(--muted-foreground)]">
        <span>{first.toLocaleString()}</span>
        <span className={isUp ? "text-[color:var(--ave-teal)]" : "text-red-400"}>
          {last.toLocaleString()} ({isUp ? "+" : ""}
          {trend.toLocaleString()})
        </span>
      </div>
    </div>
  );
}
