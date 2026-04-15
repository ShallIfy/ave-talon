// GET  /api/signals?limit=20&minConfidence=MED — recent signals from DB
// POST /api/signals { mint, chain? }              — run detection + persist

import { NextRequest, NextResponse } from "next/server";
import { buildAveSnapshot } from "@/lib/ave/snapshot";
import { detectSignalFromSnapshot } from "@/lib/signals/detector";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONF_RANK: Record<string, number> = { LOW: 0, MED: 1, HIGH: 2 };

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(params.get("limit") ?? "20", 10) || 20, 100);
  const minConfidence = params.get("minConfidence");

  const patterns = params.get("patterns");
  const since = params.get("since");
  const mint = params.get("mint");

  const where: Record<string, unknown> = {};
  if (mint) {
    where.tokenMint = mint;
  }
  if (minConfidence && CONF_RANK[minConfidence] !== undefined) {
    const allowed = Object.keys(CONF_RANK).filter(
      (c) => CONF_RANK[c] >= CONF_RANK[minConfidence],
    );
    where.confidence = { in: allowed };
  }
  if (patterns) {
    const ids = patterns.split(",").map(Number).filter(Boolean);
    if (ids.length > 0) where.patternId = { in: ids };
  }
  if (since) {
    where.detectedAt = { gte: new Date(since) };
  }

  const signals = await prisma.signal.findMany({
    where,
    orderBy: { detectedAt: "desc" },
    take: limit,
    include: {
      token: { select: { symbol: true, logoUrl: true, riskScore: true } },
      snapshot: {
        select: {
          mcapUsd: true,
          priceUsd: true,
          priceAt1h: true,
          priceAt4h: true,
          priceAt24h: true,
          outcomeScore: true,
        },
      },
    },
  });

  return NextResponse.json({ count: signals.length, signals });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mint = body.mint as string | undefined;
  const chain = (body.chain as string | undefined) ?? "solana";

  if (!mint) {
    return NextResponse.json({ error: "mint required" }, { status: 400 });
  }

  try {
    const snap = await buildAveSnapshot(mint, { chain });
    const detected = detectSignalFromSnapshot(snap);

    // Upsert the token
    await prisma.token.upsert({
      where: { mint },
      update: {
        lastScannedAt: new Date(),
        symbol: snap.symbol ?? undefined,
        name: snap.name ?? undefined,
        decimals: snap.decimals ?? undefined,
        riskScore: snap.risk?.riskScore ?? null,
        logoUrl: snap.logoUrl ?? undefined,
      },
      create: {
        mint,
        symbol: snap.symbol,
        name: snap.name,
        decimals: snap.decimals ?? 9,
        riskScore: snap.risk?.riskScore ?? null,
        logoUrl: snap.logoUrl ?? null,
      },
    });

    // Persist the signal (all patterns, including #9 "No Signal" for audit trail)
    const signalRow = await prisma.signal.create({
      data: {
        tokenMint: mint,
        patternId: detected.signal.number,
        patternName: detected.signal.name,
        dimension: detected.dimension,
        confidence: detected.signal.confidence,
        score: detected.score,
        meta: {
          reasoning: detected.reasoning,
          dimensionsNormalized: detected.dimensionsNormalized,
          signal: detected.signal,
        } as object,
      },
    });

    // Persist a token snapshot row
    const latestCandle = snap.klines.at(-1);
    await prisma.tokenSnapshot.create({
      data: {
        tokenMint: mint,
        priceUsd: latestCandle?.c ?? 0,
        mcapUsd:
          snap.totalSupply && latestCandle?.c
            ? snap.totalSupply * latestCandle.c
            : 0,
        volume1h: snap.volume1hAvg,
        holderCount: snap.holderDelta?.holdersCountEnd ?? null,
        top10Ratio: snap.holderDelta?.top10RatioEnd ?? null,
        holdersGt10: snap.holderDelta?.holdersAbove10End ?? null,
        raw: {
          symbol: snap.symbol,
          primaryPairId: snap.primaryPairId,
          priceChangePct: snap.priceChangePct,
        } as object,
      },
    });

    return NextResponse.json({
      signalId: signalRow.id,
      detected,
      snapshot: {
        symbol: snap.symbol,
        price: latestCandle?.c ?? null,
        mcap:
          snap.totalSupply && latestCandle?.c
            ? snap.totalSupply * latestCandle.c
            : null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
