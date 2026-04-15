// GET /api/snapshot?mint=<mint>&chain=solana
// Returns a full AveSnapshot for a single token.

import { NextRequest, NextResponse } from "next/server";
import { buildAveSnapshot } from "@/lib/ave/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  const chain = req.nextUrl.searchParams.get("chain") ?? "solana";

  if (!mint) {
    return NextResponse.json(
      { error: "mint parameter required" },
      { status: 400 },
    );
  }

  try {
    const snapshot = await buildAveSnapshot(mint, { chain });
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "public, s-maxage=30" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
