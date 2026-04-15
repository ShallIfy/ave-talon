"use client";

// Propose trade modal: fetch Jupiter quote → show route preview → user clicks
// "Sign with Phantom" → server builds unsigned tx → wallet signs + sends.
// Observer mode: server NEVER holds the private key.

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { toast } from "sonner";
import {
  SOL_MINT,
  LAMPORTS_PER_SOL,
  DEFAULT_SLIPPAGE_BPS,
  MAX_PER_TRADE_SOL,
  solscanTx,
} from "@/lib/solana/config";
import { cn } from "@/lib/utils";

interface JupiterRoute {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label?: string } }>;
}

export function TradeProposeDialog({
  open,
  onClose,
  tokenMint,
  tokenSymbol,
  side = "buy",
}: {
  open: boolean;
  onClose: () => void;
  tokenMint: string;
  tokenSymbol?: string | null;
  side?: "buy" | "sell";
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [amountSol, setAmountSol] = useState<number>(0.01);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<JupiterRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;

    async function loadQuote() {
      setLoading(true);
      setError(null);
      setQuote(null);
      try {
        const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
        const inputMint = side === "buy" ? SOL_MINT : tokenMint;
        const outputMint = side === "buy" ? tokenMint : SOL_MINT;
        const qs = new URLSearchParams({
          inputMint,
          outputMint,
          amount: String(lamports),
          slippageBps: String(slippageBps),
        });
        const res = await fetch(`/api/jupiter/quote?${qs}`);
        const data = await res.json();
        if (cancel) return;
        if (data.error) {
          setError(data.error);
        } else {
          setQuote(data);
        }
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "quote failed");
      } finally {
        if (!cancel) setLoading(false);
      }
    }

    const t = setTimeout(loadQuote, 250);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [open, amountSol, slippageBps, tokenMint, side]);

  async function handleSign() {
    if (!publicKey || !signTransaction || !quote) {
      toast.error("Connect Phantom first");
      return;
    }
    setSigning(true);
    try {
      const swapRes = await fetch("/api/jupiter/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: publicKey.toBase58(),
        }),
      });
      const swapData = await swapRes.json();
      if (swapData.error) {
        throw new Error(swapData.error);
      }
      const txBytes = Buffer.from(swapData.unsignedTxB64, "base64");
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      toast.success("Tx submitted", {
        description: sig.slice(0, 10) + "…",
        action: {
          label: "View",
          onClick: () => window.open(solscanTx(sig), "_blank"),
        },
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "sign failed";
      toast.error(msg);
      setError(msg);
    } finally {
      setSigning(false);
    }
  }

  if (!open) return null;

  const outAmount = quote ? Number(quote.outAmount) / 1_000_000 : null; // rough: assume 6 decimals
  const priceImpact = quote ? Number(quote.priceImpactPct) : null;
  const routeLabel =
    quote?.routePlan?.map((r) => r.swapInfo.label).filter(Boolean).join(" → ") ?? "—";

  const overLimit = amountSol > MAX_PER_TRADE_SOL;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="ave-card-premium w-full max-w-md animate-in !p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-white">
              Propose {side === "buy" ? "Buy" : "Sell"}
            </h3>
            <p className="text-xs text-[color:var(--muted-foreground)]">
              {tokenSymbol ?? tokenMint.slice(0, 8)} · via Jupiter v6
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[color:var(--muted-foreground)] hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
            aria-label="close"
          >
            ✕
          </button>
        </div>

        {/* Amount input */}
        <div className="space-y-3">
          <div>
            <label className="stat-label mb-1.5 block">Amount (SOL)</label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={amountSol}
              onChange={(e) => setAmountSol(Number(e.target.value))}
              className="w-full rounded-lg border border-[color:var(--card-border)] bg-black/30 px-3 py-2 font-mono text-sm text-white focus:border-[color:var(--ave-teal)] focus:outline-none"
            />
            {overLimit && (
              <p className="mt-1 text-[10px] text-yellow-400">
                ⚠ Exceeds safety limit ({MAX_PER_TRADE_SOL} SOL per trade)
              </p>
            )}
          </div>

          <div>
            <label className="stat-label mb-1.5 block">Slippage ({(slippageBps / 100).toFixed(1)}%)</label>
            <input
              type="range"
              min={50}
              max={1000}
              step={50}
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
              className="w-full accent-[color:var(--ave-teal)]"
            />
          </div>
        </div>

        {/* Quote preview */}
        <div className="mt-4 border border-[var(--card-border)] bg-[rgba(124,58,237,0.04)] p-4">
          <div className="stat-label mb-2">Jupiter route</div>
          {loading ? (
            <div className="skeleton h-16 w-full" />
          ) : error ? (
            <div className="text-xs text-red-400">{error}</div>
          ) : quote ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[color:var(--muted-foreground)]">You pay</span>
                <span className="font-mono text-white">
                  {amountSol} {side === "buy" ? "SOL" : tokenSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[color:var(--muted-foreground)]">You receive</span>
                <span className="font-mono text-[color:var(--ave-teal)]">
                  ≈ {outAmount?.toFixed(4)} {side === "buy" ? tokenSymbol : "SOL"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[color:var(--muted-foreground)]">Price impact</span>
                <span
                  className={cn(
                    "font-mono",
                    priceImpact && priceImpact > 1 ? "text-yellow-400" : "text-[color:var(--ave-teal)]",
                  )}
                >
                  {priceImpact?.toFixed(3)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[color:var(--muted-foreground)]">Route</span>
                <span className="truncate max-w-[200px] font-mono text-white/80">
                  {routeLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[color:var(--muted-foreground)]">
              Enter an amount to fetch a quote
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-[color:var(--card-border)] bg-transparent py-2.5 text-sm font-medium text-[color:var(--muted-foreground)] transition hover:border-[color:var(--card-border-hover)] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!connected || !quote || signing || loading}
            onClick={handleSign}
            className={cn(
              "btn-glow flex-[1.5]",
              (!connected || !quote || signing || loading) && "opacity-50 pointer-events-none",
            )}
          >
            {signing
              ? "Signing…"
              : !connected
                ? "Connect Phantom"
                : "Sign with Phantom"}
          </button>
        </div>

        <p className="mt-3 text-center text-[10px] text-[color:var(--muted-foreground)]">
          Observer mode · backend never holds your private key
        </p>
      </div>
    </div>
  );
}
