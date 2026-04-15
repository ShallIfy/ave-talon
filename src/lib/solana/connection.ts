// Server-side Solana Connection singleton.
// For browser wallet usage, use the adapter from Providers instead.

import { Connection } from "@solana/web3.js";
import { SOLANA_RPC_URL, SOLANA_COMMITMENT } from "./config";

const globalForConn = globalThis as unknown as { solanaConn?: Connection };

export function getConnection(): Connection {
  if (!globalForConn.solanaConn) {
    globalForConn.solanaConn = new Connection(SOLANA_RPC_URL, SOLANA_COMMITMENT);
  }
  return globalForConn.solanaConn;
}

/**
 * Get native SOL balance for an address (in lamports).
 * Returns 0 on error (safe fallback for snapshot).
 */
export async function getSolBalance(address: string): Promise<number> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    const conn = getConnection();
    return await conn.getBalance(new PublicKey(address));
  } catch {
    return 0;
  }
}
