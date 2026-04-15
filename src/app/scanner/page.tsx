"use client";

import { ScannerTable } from "@/app/components/ScannerTable";

export default function ScannerPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 px-4 py-6 sm:px-6">
      <div className="flex items-end justify-between border-b border-[var(--card-border)] pb-4">
        <div>
          <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
            Token Scanner
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">
            Pump.fun + Moonshot · graduated and new launches · Solana
          </p>
        </div>
      </div>

      <ScannerTable initialSource="graduated" />
    </main>
  );
}
