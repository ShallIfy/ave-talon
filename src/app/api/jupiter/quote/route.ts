// GET /api/jupiter/quote?inputMint=..&outputMint=..&amount=..&slippageBps=500
// Proxy to Jupiter v6 quote endpoint via lib/solana/jupiter.

import { NextRequest, NextResponse } from "next/server";
import { getJupiterQuote } from "@/lib/solana/jupiter";
import { DEFAULT_SLIPPAGE_BPS } from "@/lib/solana/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const inputMint = params.get("inputMint");
  const outputMint = params.get("outputMint");
  const amount = params.get("amount");
  const slippageBps = parseInt(
    params.get("slippageBps") ?? String(DEFAULT_SLIPPAGE_BPS),
    10,
  );

  if (!inputMint || !outputMint || !amount) {
    return NextResponse.json(
      { error: "inputMint, outputMint, and amount are required" },
      { status: 400 },
    );
  }

  try {
    const quote = await getJupiterQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });
    return NextResponse.json(quote, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
