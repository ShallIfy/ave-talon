"use client";

// WatchlistPulse — dashboard card showing tracked tokens that have recently
// triggered a signal. Three states:
//   - not connected → CONNECT_PHANTOM CTA
//   - connected but empty → ADD_FROM_SCANNER hint
//   - has items → list with most-recent-signal badge per token

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { cn } from "@/lib/utils";
import { resolveLogo } from "@/lib/utils/token-logo";

interface WatchItem {
  id: string;
  tokenMint: string;
  token?: { symbol: string | null; riskScore: number | null; logoUrl: string | null } | null;
}

interface SignalLite {
  id: string;
  tokenMint: string;
  patternName: string;
  confidence: string;
  score: number;
  detectedAt: string;
}

interface PulseRow {
  mint: string;
  symbol: string;
  logo: string | null;
  latestSignal: SignalLite | null;
}

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function WatchlistPulse() {
  const { publicKey, connected } = useWallet();
  const owner = publicKey?.toBase58();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [signals, setSignals] = useState<SignalLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!owner) return;
    let cancel = false;
    async function load() {
      setLoading(true);
      try {
        const [wlRes, sigRes] = await Promise.all([
          fetch(`/api/watchlist?owner=${encodeURIComponent(owner!)}`),
          fetch(`/api/signals?limit=100`),
        ]);
        const wlJson = await wlRes.json();
        const sigJson = await sigRes.json();
        if (!cancel) {
          setItems(wlJson.items ?? []);
          setSignals(sigJson.signals ?? []);
        }
      } catch {
        // noop
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 20_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [owner]);

  // Join watchlist items with most recent signal
  const rows: PulseRow[] = items.map((w) => {
    const latest =
      signals.find((s) => s.tokenMint === w.tokenMint) ?? null;
    return {
      mint: w.tokenMint,
      symbol: w.token?.symbol ?? w.tokenMint.slice(0, 6),
      logo: resolveLogo(w.token?.logoUrl),
      latestSignal: latest,
    };
  });

  return (
    <div className="ave-card-premium flex h-full flex-col !p-4">
      <div className="flex items-baseline justify-between border-b border-[var(--card-border)] pb-2">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-white/90">
          Watchlist
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {connected ? `${items.length} tracked` : "Not Connected"}
        </span>
      </div>

      {!connected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            Connect wallet to track tokens
          </p>
          {mounted && (
            <WalletMultiButton
              style={{
                background: "#7c3aed",
                color: "#ffffff",
                fontWeight: 500,
                borderRadius: 0,
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontSize: 11,
                padding: "8px 16px",
              }}
            />
          )}
        </div>
      ) : loading && items.length === 0 ? (
        <div className="mt-2 space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            Watchlist is empty
          </p>
          <Link
            href="/scanner"
            className="border border-[rgba(124,58,237,0.4)] bg-[rgba(124,58,237,0.06)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ave-accent-bright)] hover:bg-[rgba(124,58,237,0.12)]"
          >
            Add from Scanner →
          </Link>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--card-border)] border-t border-[var(--card-border)]">
          {rows.slice(0, 5).map((r) => {
            const sig = r.latestSignal;
            const confColor =
              sig?.confidence === "HIGH"
                ? "text-[var(--ave-accent-bright)]"
                : sig?.confidence === "MED"
                  ? "text-yellow-400/80"
                  : "text-white/40";
            return (
              <li key={r.mint}>
                <Link
                  href={`/token/${r.mint}`}
                  className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_50px] items-center gap-2 px-1 py-2 transition-colors hover:bg-white/[0.015]"
                >
                  {r.logo ? (
                    <img
                      src={r.logo}
                      alt=""
                      width={22}
                      height={22}
                      className="h-[22px] w-[22px] shrink-0 rounded-full border border-[color:var(--card-border)]"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] bg-[rgba(124,58,237,0.15)] font-mono text-[8px] font-medium text-white/60">
                      {r.symbol.slice(0, 2)}
                    </div>
                  )}
                  <div className="truncate font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-white">
                    {r.symbol}
                  </div>
                  <div className="min-w-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                    {sig ? (
                      <span className="truncate">{sig.patternName}</span>
                    ) : (
                      <span className="text-white/20">no signal</span>
                    )}
                  </div>
                  <div className={cn("text-right font-mono text-[9px] uppercase tracking-[0.12em]", confColor)}>
                    {sig ? `${sig.confidence} · ${relTime(sig.detectedAt)}` : "—"}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
