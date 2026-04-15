// GET /api/agent/stats?period=24h|7d
// Win-rate and signal performance stats derived from SignalSnapshot outcome data.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { ensureOutcomeTrackerStarted } from "@/lib/orchestrator/outcome-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTRY_PATTERNS = [1, 7, 11];

const PERIOD_MAP: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
};

interface PatternWR {
  patternId: number;
  name: string;
  total: number;
  wins: number;
  wr: number;
}

export async function GET(req: NextRequest) {
  ensureOutcomeTrackerStarted();

  const period = req.nextUrl.searchParams.get("period") ?? "24h";
  const interval = PERIOD_MAP[period] ?? PERIOD_MAP["24h"];

  try {
    // 1. WR per pattern within period
    const patternRows = await prisma.$queryRaw<
      Array<{
        patternId: number;
        patternName: string;
        total: bigint;
        wins: bigint;
      }>
    >`
      SELECT
        s."patternId",
        s."patternName",
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE GREATEST(
            COALESCE(ss."priceAt1h", 0),
            COALESCE(ss."priceAt4h", 0),
            COALESCE(ss."priceAt24h", 0)
          ) > ss."priceUsd" * 1.1
        )::bigint AS wins
      FROM "Signal" s
      JOIN "SignalSnapshot" ss ON ss."signalId" = s.id
      WHERE ss."priceAt1h" IS NOT NULL
        AND ss."priceUsd" > 0
        AND s."detectedAt" > NOW() - CAST(${interval} AS INTERVAL)
      GROUP BY s."patternId", s."patternName"
      ORDER BY s."patternId"
    `;

    const byPattern: PatternWR[] = patternRows.map((r) => ({
      patternId: r.patternId,
      name: r.patternName,
      total: Number(r.total),
      wins: Number(r.wins),
      wr: Number(r.total) > 0 ? (Number(r.wins) / Number(r.total)) * 100 : 0,
    }));

    const entryStats = byPattern.filter((p) =>
      ENTRY_PATTERNS.includes(p.patternId),
    );
    const overallTotal = entryStats.reduce((a, b) => a + b.total, 0);
    const overallWins = entryStats.reduce((a, b) => a + b.wins, 0);

    // 2. Hourly signal count (always last 24h for sparkline)
    const hourlyRows = await prisma.$queryRaw<
      Array<{ hour: number; count: bigint }>
    >`
      SELECT
        EXTRACT(HOUR FROM s."detectedAt")::int AS hour,
        COUNT(*)::bigint AS count
      FROM "Signal" s
      WHERE s."detectedAt" > NOW() - INTERVAL '24 hours'
        AND s."patternId" != 9
      GROUP BY EXTRACT(HOUR FROM s."detectedAt")
      ORDER BY hour
    `;

    const hourlyMap = new Map<number, number>();
    for (const r of hourlyRows) {
      hourlyMap.set(r.hour, Number(r.count));
    }
    const hourly: number[] = Array.from({ length: 24 }, (_, i) =>
      hourlyMap.get(i) ?? 0,
    );

    // 3. Outcome tracker fill counts
    let outcomeStats = { filled1h: 0, filled4h: 0, filled24h: 0, pending: 0 };
    try {
      const counts = await prisma.$queryRaw<
        Array<{
          filled1h: bigint;
          filled4h: bigint;
          filled24h: bigint;
          pending: bigint;
        }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE "priceAt1h" IS NOT NULL)::bigint AS "filled1h",
          COUNT(*) FILTER (WHERE "priceAt4h" IS NOT NULL)::bigint AS "filled4h",
          COUNT(*) FILTER (WHERE "priceAt24h" IS NOT NULL)::bigint AS "filled24h",
          COUNT(*) FILTER (WHERE "priceAt1h" IS NULL)::bigint AS pending
        FROM "SignalSnapshot"
        WHERE "priceUsd" > 0
      `;
      if (counts[0]) {
        outcomeStats = {
          filled1h: Number(counts[0].filled1h),
          filled4h: Number(counts[0].filled4h),
          filled24h: Number(counts[0].filled24h),
          pending: Number(counts[0].pending),
        };
      }
    } catch {
      // non-critical
    }

    return NextResponse.json({
      period,
      overall: {
        total: overallTotal,
        wins: overallWins,
        wr: overallTotal > 0 ? (overallWins / overallTotal) * 100 : 0,
      },
      byPattern,
      hourly,
      outcomeStats,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
