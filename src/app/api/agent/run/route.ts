// POST /api/agent/run { mint, strategyOverride? }
// Run one OBSERVE → DECIDE → ACT cycle on a single token.

import { NextResponse } from "next/server";
import { runAgentCycle } from "@/lib/agent/loop";
import { DEFAULT_STRATEGY } from "@/lib/agent/safety";
import type { StrategyConfig } from "@/lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mint = body.mint as string | undefined;

  if (!mint) {
    return NextResponse.json({ error: "mint required" }, { status: 400 });
  }

  const strategy: StrategyConfig = {
    ...DEFAULT_STRATEGY,
    ...(body.strategyOverride ?? {}),
  };

  try {
    const result = await runAgentCycle(mint, strategy);

    // Return a slimmed-down response (drop full klines/holder series from snapshot)
    const { snapshot, ...rest } = result;
    return NextResponse.json({
      ...rest,
      snapshotSummary: {
        symbol: snapshot.symbol,
        mint: snapshot.token,
        latestPriceUsd: snapshot.latestPriceUsd,
        priceChangePct: snapshot.priceChangePct,
        holderDelta: snapshot.holderDelta,
        riskScore: snapshot.risk?.riskScore ?? null,
        errors: snapshot.metadata.errors,
        collectionTimeMs: snapshot.metadata.collectionTimeMs,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent cycle failed" },
      { status: 500 },
    );
  }
}
