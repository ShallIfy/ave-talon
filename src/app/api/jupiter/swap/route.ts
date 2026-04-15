// POST /api/jupiter/swap
// Body: { quoteResponse, userPublicKey }
// Returns an unsigned base64 transaction for the client to sign in Phantom.

import { NextRequest, NextResponse } from "next/server";
import { buildJupiterSwap } from "@/lib/solana/jupiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.quoteResponse || !body.userPublicKey) {
    return NextResponse.json(
      { error: "quoteResponse and userPublicKey required" },
      { status: 400 },
    );
  }

  try {
    const swap = await buildJupiterSwap({
      quoteResponse: body.quoteResponse,
      userPublicKey: body.userPublicKey,
      wrapAndUnwrapSol: body.wrapAndUnwrapSol ?? true,
      dynamicComputeUnitLimit: true,
    });

    return NextResponse.json({
      unsignedTxB64: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
      prioritizationFeeLamports: swap.prioritizationFeeLamports,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
