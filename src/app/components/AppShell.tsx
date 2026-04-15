"use client";

// Agent terminal shell: narrow icon rail + flat main column.
// Pure black surface, sharp borders — no rounding, no glow.

import Link from "next/link";
import { Menu } from "lucide-react";
import { LeftNav } from "./LeftNav";
import { AgentRail } from "./AgentRail";
import { OrchestratorBridge } from "./OrchestratorBridge";

interface AppShellProps {
  children: React.ReactNode;
  rightRail?: React.ReactNode;
  hideRail?: boolean;
}

export function AppShell({ children, rightRail, hideRail = false }: AppShellProps) {
  const rail = rightRail ?? (hideRail ? null : <AgentRail />);
  return (
    <div className="relative flex min-h-screen w-full bg-[var(--background)]">
      {/* Invisible orchestrator event poller — mounts once for whole app */}
      <OrchestratorBridge />

      {/* Icon-only left rail (lg+) */}
      <LeftNav />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--card-border)] bg-[var(--background)] px-4 lg:hidden">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-white"
          >
            <span className="inline-block h-4 w-4 border border-[var(--ave-accent)] bg-[rgba(124,58,237,0.15)]" />
            AVE TALON
          </Link>
          <button
            type="button"
            aria-label="Open menu"
            className="flex h-8 w-8 items-center justify-center border border-[var(--card-border)] text-white/60 transition-colors hover:text-white"
          >
            <Menu size={14} />
          </button>
        </header>

        {/* Content + optional right rail */}
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>

          {rail && (
            <aside className="hidden xl:sticky xl:top-0 xl:flex xl:h-screen xl:w-[288px] xl:shrink-0 xl:flex-col xl:overflow-y-auto xl:border-l xl:border-[var(--card-border)] xl:bg-[var(--background)]">
              {rail}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
