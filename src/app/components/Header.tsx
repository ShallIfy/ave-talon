"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/scanner", label: "Scanner" },
  { href: "/signals", label: "Signals" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/chat", label: "Chat" },
  { href: "/wallet", label: "Wallet" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--card-border)] bg-[color:var(--background)]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-[#14F195] to-[#9945FF] shadow-[0_0_12px_rgba(20,241,149,0.4)]" />
          <span className="brand-wordmark">AVE&nbsp;AI</span>
          <span className="brand-badge hidden sm:inline">SOLANA</span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium tracking-tight transition-colors",
                  active
                    ? "bg-[rgba(20,241,149,0.08)] text-[color:var(--ave-teal)]"
                    : "text-[color:var(--muted-foreground)] hover:bg-[rgba(255,255,255,0.03)] hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="hidden items-center gap-1.5 text-[11px] text-[color:var(--muted-foreground)] md:flex">
            <span className="pulse-dot" />
            live
          </span>
          <WalletMultiButton
            style={{
              background: "linear-gradient(135deg, #14F195, #9945FF)",
              color: "#050a07",
              fontSize: 12,
              fontWeight: 700,
              height: 34,
              borderRadius: 10,
              padding: "0 14px",
              lineHeight: 1,
            }}
          />
        </div>
      </div>
    </header>
  );
}
