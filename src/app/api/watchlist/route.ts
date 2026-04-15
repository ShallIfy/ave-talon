// GET    /api/watchlist?owner=<wallet>          — list items
// POST   /api/watchlist { owner, mint, note? }  — add
// DELETE /api/watchlist?owner=<wallet>&mint=<m> — remove

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function watchlistId(owner: string) {
  return `default-${owner}`;
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner");
  if (!owner) {
    return NextResponse.json({ error: "owner required" }, { status: 400 });
  }
  const wl = await prisma.watchlist.findUnique({
    where: { id: watchlistId(owner) },
    include: { items: { include: { token: true } } },
  });
  return NextResponse.json({
    owner,
    count: wl?.items.length ?? 0,
    items: wl?.items ?? [],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const owner = body.owner as string | undefined;
  const mint = body.mint as string | undefined;
  const note = body.note as string | undefined;

  if (!owner || !mint) {
    return NextResponse.json(
      { error: "owner and mint required" },
      { status: 400 },
    );
  }

  await prisma.token.upsert({
    where: { mint },
    update: {},
    create: { mint },
  });

  const wl = await prisma.watchlist.upsert({
    where: { id: watchlistId(owner) },
    update: {},
    create: { id: watchlistId(owner), owner, name: "Default" },
  });

  const item = await prisma.watchlistItem.upsert({
    where: {
      watchlistId_tokenMint: { watchlistId: wl.id, tokenMint: mint },
    },
    update: { note: note ?? null },
    create: { watchlistId: wl.id, tokenMint: mint, note: note ?? null },
  });

  return NextResponse.json({ added: true, item });
}

export async function DELETE(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner");
  const mint = req.nextUrl.searchParams.get("mint");
  if (!owner || !mint) {
    return NextResponse.json(
      { error: "owner and mint required" },
      { status: 400 },
    );
  }

  const wl = await prisma.watchlist.findUnique({
    where: { id: watchlistId(owner) },
  });
  if (!wl) {
    return NextResponse.json({ removed: false, reason: "no watchlist" });
  }

  await prisma.watchlistItem
    .delete({
      where: {
        watchlistId_tokenMint: { watchlistId: wl.id, tokenMint: mint },
      },
    })
    .catch(() => null);

  return NextResponse.json({ removed: true });
}
