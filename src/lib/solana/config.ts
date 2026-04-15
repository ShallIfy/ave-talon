// Solana constants & config — shared between server + client code.

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export const NEXT_PUBLIC_SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_RPC_URL;

export const SOLANA_COMMITMENT = (process.env.SOLANA_COMMITMENT ||
  "confirmed") as "processed" | "confirmed" | "finalized";

export const JUPITER_API_BASE =
  process.env.JUPITER_API_BASE || "https://lite-api.jup.ag/swap/v1";

// Trading safety limits (Observer mode defaults)
export const MAX_PER_TRADE_SOL = Number(process.env.MAX_PER_TRADE_SOL ?? "0.1");
export const DAILY_LIMIT_SOL = Number(process.env.DAILY_LIMIT_SOL ?? "0.5");
export const DEFAULT_SLIPPAGE_BPS = Number(
  process.env.DEFAULT_SLIPPAGE_BPS ?? "500",
);
export const MIN_SOL_FOR_GAS = 0.01;

export const DEFAULT_CHAIN = "solana";

// Explorer links
export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}
export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}
export function solscanAccount(addr: string): string {
  return `https://solscan.io/account/${addr}`;
}
