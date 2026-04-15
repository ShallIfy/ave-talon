"use client";

// App-wide client providers: Solana wallet adapter + connection.
// Phantom is the only auto-registered wallet (others appear via the standard
// Wallet Standard if the user has them installed).

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { NEXT_PUBLIC_SOLANA_RPC_URL, SOLANA_COMMITMENT } from "@/lib/solana/config";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = NEXT_PUBLIC_SOLANA_RPC_URL;
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider
      endpoint={endpoint}
      config={{ commitment: SOLANA_COMMITMENT }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
