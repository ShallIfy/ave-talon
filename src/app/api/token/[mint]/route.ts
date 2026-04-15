// GET /api/token/[mint]?chain=solana
// Full token deep-dive: snapshot + detected signal in one call.

import { NextRequest, NextResponse } from "next/server";
import { buildAveSnapshot } from "@/lib/ave/snapshot";
import { detectSignalFromSnapshot } from "@/lib/signals/detector";
import {
  buildPhaseTimeline,
  type CapturedSignal,
} from "@/lib/signals/timeline";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const chain = req.nextUrl.searchParams.get("chain") ?? "solana";

  if (!mint) {
    return NextResponse.json({ error: "mint required" }, { status: 400 });
  }

  try {
    const [snapshot, dbSignals] = await Promise.all([
      // Auto-pick holder interval based on token age so Phase Timeline
      // covers the token's whole life while preserving the signal-matrix
      // 5-min effective delta needed for entry/exit hunting:
      //   <5h old → 1m × lookback=5  (HD ~7h coverage)
      //   ≥5h old → 5m × lookback=1  (medium ~37h coverage)
      buildAveSnapshot(mint, { chain, holderIntervalAuto: true }),
      // Pull historical orchestrator catches for this mint. These are the
      // source of truth for "did this token ever hit pattern #X?" since the
      // orchestrator locks them in at the exact moment they fire.
      prisma.signal.findMany({
        where: { tokenMint: mint },
        orderBy: { detectedAt: "asc" },
        take: 200,
      }),
    ]);
    const lookback = snapshot.detectorLookback;
    const signal = detectSignalFromSnapshot(snapshot, lookback);

    const capturedSignals: CapturedSignal[] = dbSignals
      .filter((s) => s.patternId !== 9) // #9 No Signal is noise
      .map((s) => ({
        id: s.id,
        detectedAt: Math.floor(s.detectedAt.getTime() / 1000),
        patternId: s.patternId,
        patternName: s.patternName,
        confidence: s.confidence as CapturedSignal["confidence"],
        score: s.score,
        source: s.source,
        cycleId: s.cycleId,
      }));

    const timeline = buildPhaseTimeline(snapshot, capturedSignals, lookback);
    return NextResponse.json(
      {
        snapshot,
        signal,
        timeline,
        meta: {
          intervalUsed: snapshot.holderIntervalUsed,
          lookbackUsed: lookback,
          ageHours: snapshot.tokenAgeHours,
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=20" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
