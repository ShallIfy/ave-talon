// GET /api/scan?source=graduated&limit=20
// Fetch pump.fun / moonshot scanner results, optionally persist to DB.

import { NextRequest, NextResponse } from "next/server";
import { getPumpTokens, type PumpCategory } from "@/lib/ave/internal";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SOURCES: PumpCategory[] = ["graduated", "new"];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const source = (params.get("source") ?? "graduated") as PumpCategory;
  const platforms = params.get("platforms") ?? "pump,moonshot";
  const limit = Math.min(parseInt(params.get("limit") ?? "20", 10) || 20, 50);
  const persist = params.get("persist") === "true";

  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `invalid source. one of: ${VALID_SOURCES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const tokens = await getPumpTokens(source, { limit, platforms });

    if (persist) {
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i] as Record<string, unknown>;
        const mint =
          (t.target_token as string | undefined) ??
          (t.token1_address as string | undefined) ??
          (t.token0_address as string | undefined) ??
          (t.address as string | undefined) ??
          (t.token_address as string | undefined);
        if (!mint) continue;
        // target_token can be either token0 or token1 — pick the matching side
        const isToken0 = mint === (t.token0_address as string | undefined);
        const symbol = isToken0
          ? ((t.token0_symbol as string | undefined) ??
             (t.symbol_en as string | undefined) ??
             (t.token1_symbol as string | undefined) ??
             (t.symbol as string | undefined) ??
             null)
          : ((t.token1_symbol as string | undefined) ??
             (t.symbol_en as string | undefined) ??
             (t.token0_symbol as string | undefined) ??
             (t.symbol as string | undefined) ??
             null);
        const name = isToken0
          ? ((t.token0_name as string | undefined) ??
             (t.name_en as string | undefined) ??
             (t.token1_name as string | undefined) ??
             (t.name as string | undefined) ??
             null)
          : ((t.token1_name as string | undefined) ??
             (t.name_en as string | undefined) ??
             (t.token0_name as string | undefined) ??
             (t.name as string | undefined) ??
             null);
        try {
          await prisma.token.upsert({
            where: { mint },
            update: { lastScannedAt: new Date(), symbol, name },
            create: { mint, symbol, name },
          });
          await prisma.scanResult.create({
            data: {
              source,
              tokenMint: mint,
              rank: i + 1,
              meta: t as object,
            },
          });
        } catch {
          // continue on per-row failure
        }
      }
    }

    return NextResponse.json({
      source,
      count: tokens.length,
      tokens,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
