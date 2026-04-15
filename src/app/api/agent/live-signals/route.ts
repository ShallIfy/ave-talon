// GET /api/agent/live-signals?limit=5&offset=0&minConfidence=MED
//
// In-memory live signal feed served from the OrchestratorScheduler's cycle
// history. Zero DB round-trips — reads straight from the module-level
// singleton populated by the running scheduler loop. Ideal for truly
// realtime dashboards: the response reflects whatever the orchestrator has
// seen in its most recent cycles, refreshed as soon as a cycle finishes.

import { NextRequest, NextResponse } from "next/server";
import {
  ensureOrchestratorStarted,
  getRecentSignals,
} from "@/lib/orchestrator/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Idempotent — keeps the loop alive if the page is the only consumer.
  ensureOrchestratorStarted();

  const params = req.nextUrl.searchParams;
  const limit = Math.max(
    1,
    Math.min(parseInt(params.get("limit") ?? "5", 10) || 5, 100),
  );
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  const minConfidence = params.get("minConfidence") ?? undefined;
  const includeNoSignal = params.get("includeNoSignal") === "1";

  const page = getRecentSignals(limit, offset, {
    includeNoSignal,
    minConfidence: minConfidence ?? undefined,
  });

  return NextResponse.json(page, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
