export default function WatchlistPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6">
      <div className="flex items-end justify-between border-b border-[var(--card-border)] pb-4">
        <div>
          <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-white">
            Watchlist
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">
            Track tokens scoped per wallet
          </p>
        </div>
      </div>

      <div className="mt-24 flex flex-col items-center justify-center">
        <div className="flex h-20 w-20 items-center justify-center border border-[var(--card-border)] bg-white/[0.02]">
          <span className="font-mono text-3xl text-white/15">W</span>
        </div>

        <h2 className="mt-8 font-mono text-lg font-semibold uppercase tracking-[0.16em] text-white/50">
          Coming Soon
        </h2>
        <p className="mt-3 max-w-md text-center font-mono text-sm leading-relaxed text-white/20">
          We're crafting something worth the wait.
        </p>
      </div>
    </main>
  );
}
