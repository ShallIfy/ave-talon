// GET /api/agent/logs?limit=20
// Returns recent agent cycle results (from in-memory log).

import { NextRequest, NextResponse } from "next/server";
import { getAgentLog } from "@/lib/agent/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

  const logs = getAgentLog(limit).map((entry) => ({
    cycleId: entry.cycleId,
    timestamp: entry.timestamp,
    decision: entry.decision,
    signal: entry.signal,
    phases: entry.phases,
    proposedTransactions: entry.proposedTransactions,
    snapshotSummary: {
      symbol: entry.snapshot.symbol,
      mint: entry.snapshot.token,
      latestPriceUsd: entry.snapshot.latestPriceUsd,
      priceChangePct: entry.snapshot.priceChangePct,
      holderDelta: entry.snapshot.holderDelta,
      riskScore: entry.snapshot.risk?.riskScore ?? null,
    },
  }));

  return NextResponse.json({ logs });
}
