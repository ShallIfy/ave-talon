import { NextRequest, NextResponse } from "next/server";
import { getKlineRange, getTokenDetail } from "@/lib/ave/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANDLES_PER_REQ = 200;
const MAX_CANDLES = 2000; // safety cap

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const sp = req.nextUrl.searchParams;
  const interval = Math.max(
    1,
    parseInt(sp.get("interval") ?? "60", 10) || 60,
  ) as 1 | 5 | 15 | 30 | 60 | 900;

  // Get token detail to find publishAt (birth timestamp)
  const detail = await getTokenDetail(mint, "solana");
  const publishAt = (detail.token?.publish_at as number | undefined) ?? null;

  const now = Math.floor(Date.now() / 1000);
  const earliest = publishAt ?? now - 24 * 3600; // fallback: 24h ago

  // Paginate backwards from now to earliest
  const allCandles: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    vol: number;
  }> = [];
  let cursor = now;

  while (cursor > earliest && allCandles.length < MAX_CANDLES) {
    const windowSize = CANDLES_PER_REQ * interval;
    const from = Math.max(cursor - windowSize, earliest);
    const batch = await getKlineRange(mint, from, cursor, "solana", interval);

    if (batch.length === 0) break;

    // Prepend (batch is older data)
    allCandles.unshift(...batch);
    cursor = from;

    // If batch returned less than expected, no more data
    if (batch.length < CANDLES_PER_REQ) break;
  }

  // Deduplicate by timestamp (overlapping edges)
  const seen = new Set<number>();
  const deduped = allCandles.filter((c) => {
    if (seen.has(c.t)) return false;
    seen.add(c.t);
    return true;
  });

  // Sort ascending
  deduped.sort((a, b) => a.t - b.t);

  return NextResponse.json({
    count: deduped.length,
    interval,
    from: deduped[0]?.t ?? null,
    to: deduped.at(-1)?.t ?? null,
    klines: deduped,
  });
}
