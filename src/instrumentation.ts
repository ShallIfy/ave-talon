// Next.js instrumentation hook — runs once per server instance on boot.
// Used to lazy-init the orchestrator loop.

export async function register() {
  // Only run in Node.js runtime (skip edge runtime + build-time eval).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Avoid booting during build/compile sweeps — only at actual server start.
  // NEXT_PHASE is set by next/dist/shared/lib/constants
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { ensureOrchestratorStarted } = await import(
      "@/lib/orchestrator/scheduler"
    );
    ensureOrchestratorStarted();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[instrumentation] failed to boot orchestrator:", err);
  }

  try {
    const { ensureOutcomeTrackerStarted } = await import(
      "@/lib/orchestrator/outcome-tracker"
    );
    ensureOutcomeTrackerStarted();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[instrumentation] failed to boot outcome tracker:", err);
  }

  try {
    const { startTokenRefreshLoop } = await import("@/lib/ave/auth");
    startTokenRefreshLoop();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[instrumentation] failed to start ave token refresh:", err);
  }
}
