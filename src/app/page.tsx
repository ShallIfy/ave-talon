import Link from "next/link";

export default function Home() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-16">
      {/* subtle grid pattern */}
      <div className="pointer-events-none absolute inset-0 grid-pattern opacity-40" />

      <div className="relative z-10 mx-auto max-w-3xl space-y-8 text-center">
        <div className="inline-flex items-center gap-2 border border-[rgba(124,58,237,0.3)] bg-[rgba(124,58,237,0.06)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ave-accent-bright)]">
          <span className="pulse-dot" />
          autonomous solana signals
        </div>

        <h1 className="font-mono text-4xl font-medium uppercase leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
          <span className="text-white">DATA OVER HYPE.</span>
          <br />
          <span className="text-white/60">HOLDERS BEFORE PRICE.</span>
        </h1>

        <p className="mx-auto max-w-xl text-sm leading-relaxed text-white/55">
          Ave Talon scans Solana tokens across 5 dimensions — holder growth, whale
          concentration, real-money flows, volume, and price — then detects 10
          signal patterns from strong entries to full dumps.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/dashboard" className="btn-glow inline-block">
            OPEN DASHBOARD →
          </Link>
          <Link href="/scanner" className="btn-ghost inline-block">
            BROWSE SCANNER
          </Link>
          <Link href="/chat" className="btn-ghost inline-block">
            ASK THE AGENT
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-12 text-left sm:grid-cols-4">
          {[
            { label: "Signal Patterns", value: "10" },
            { label: "Data Dimensions", value: "5" },
            { label: "Chains", value: "Solana" },
            { label: "Mode", value: "Observer" },
          ].map((s) => (
            <div key={s.label} className="ave-card !p-4">
              <div className="stat-label">{s.label}</div>
              <div className="mt-1 font-mono text-lg font-medium text-white">
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
