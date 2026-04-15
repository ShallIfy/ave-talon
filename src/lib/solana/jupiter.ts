// Jupiter v6 quote + swap builder.
// Observer mode: we NEVER sign. We build the unsigned swap tx and return
// base64 so the browser (Phantom) can sign it.

import { JUPITER_API_BASE, SOL_MINT, LAMPORTS_PER_SOL } from "./config";

export interface JupiterRoutePlanStep {
  swapInfo: {
    ammKey: string;
    label?: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount?: string;
    feeMint?: string;
  };
  percent: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlanStep[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string; // base64 versioned tx
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

/**
 * Fetch a Jupiter v6 quote.
 *
 * @param inputMint base58 SPL mint (use SOL_MINT for native SOL)
 * @param outputMint base58 SPL mint
 * @param amount amount in smallest unit (lamports if input=SOL)
 * @param slippageBps default 500 (5%)
 */
export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: number | string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
  onlyDirectRoutes?: boolean;
}): Promise<JupiterQuoteResponse> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(params.slippageBps ?? 500),
    swapMode: params.swapMode ?? "ExactIn",
    onlyDirectRoutes: String(params.onlyDirectRoutes ?? false),
  });

  const r = await fetch(`${JUPITER_API_BASE}/quote?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Jupiter quote ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()) as JupiterQuoteResponse;
}

/**
 * Build an unsigned swap transaction for a given quote + user wallet.
 * Returns base64-encoded versioned transaction that the browser should sign.
 */
export async function buildJupiterSwap(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  prioritizationFeeLamports?: number | "auto";
  dynamicComputeUnitLimit?: boolean;
}): Promise<JupiterSwapResponse> {
  const body = {
    quoteResponse: params.quoteResponse,
    userPublicKey: params.userPublicKey,
    wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
    prioritizationFeeLamports: params.prioritizationFeeLamports ?? "auto",
    dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
  };

  const r = await fetch(`${JUPITER_API_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Jupiter swap ${r.status}: ${t.slice(0, 200)}`);
  }
  return (await r.json()) as JupiterSwapResponse;
}

/**
 * Convenience: quote SOL → token.
 */
export function quoteSolToToken(
  outputMint: string,
  amountSol: number,
  slippageBps = 500,
) {
  return getJupiterQuote({
    inputMint: SOL_MINT,
    outputMint,
    amount: Math.floor(amountSol * LAMPORTS_PER_SOL),
    slippageBps,
  });
}

/**
 * Convenience: quote token → SOL.
 * amountTokenRaw must be in smallest unit already (applyDecimals before calling).
 */
export function quoteTokenToSol(
  inputMint: string,
  amountTokenRaw: number | string,
  slippageBps = 500,
) {
  return getJupiterQuote({
    inputMint,
    outputMint: SOL_MINT,
    amount: amountTokenRaw,
    slippageBps,
  });
}
