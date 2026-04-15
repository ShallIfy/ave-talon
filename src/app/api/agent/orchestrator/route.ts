// GET  /api/agent/orchestrator            → status snapshot
// POST /api/agent/orchestrator { action }  → kick (force cycle) | stop
// GET  /api/agent/orchestrator/stream?since=<seq> handled via ?stream=1 param below

import { NextRequest, NextResponse } from "next/server";
import {
  ensureOrchestratorStarted,
  getOrchestratorStatus,
  kickCycle,
  stopOrchestrator,
} from "@/lib/orchestrator/scheduler";
import {
  getOrchestratorLines,
  getLatestSeq,
} from "@/lib/orchestrator/terminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Ensure orchestrator is running so first GET auto-boots it
  ensureOrchestratorStarted();

  const params = req.nextUrl.searchParams;
  if (params.get("stream") === "1") {
    const sinceSeq = parseInt(params.get("since") ?? "0", 10) || 0;
    const lines = getOrchestratorLines(sinceSeq, 200);
    return NextResponse.json({
      latestSeq: getLatestSeq(),
      lines,
    });
  }

  return NextResponse.json(getOrchestratorStatus());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = (body.action as string | undefined) ?? "kick";

  if (action === "kick") {
    ensureOrchestratorStarted();
    const res = await kickCycle();
    return NextResponse.json({
      ok: true,
      action: "kick",
      cycle: res
        ? {
            id: res.id,
            scanned: res.scanned,
            detected: res.detected,
            persisted: res.persisted,
            durationMs: res.durationMs,
          }
        : null,
    });
  }

  if (action === "stop") {
    stopOrchestrator();
    return NextResponse.json({ ok: true, action: "stop" });
  }

  if (action === "start") {
    ensureOrchestratorStarted();
    return NextResponse.json({ ok: true, action: "start" });
  }

  return NextResponse.json(
    { error: `unknown action: ${action}` },
    { status: 400 },
  );
}
