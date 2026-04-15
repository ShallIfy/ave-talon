"use client";

// Narrow icon rail — premium agent terminal nav.
// 56px wide. Stacked icons, tooltip on hover, subtle surface states.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Star,
  MessageSquare,
  Wallet,
  Terminal,
  FileText,
  ShieldCheck,
  Layers,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/scanner", label: "Scanner", icon: Layers },
  { href: "/signals", label: "Signals", icon: Activity },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/terminal", label: "Terminal", icon: Terminal },
];

const SECONDARY: NavItem[] = [
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/docs", label: "Docs", icon: FileText },
  { href: "/risk", label: "Risk", icon: ShieldCheck },
];

function RailIcon({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center transition-all duration-150",
        active
          ? "text-white"
          : "text-white/30 hover:bg-white/[0.04] hover:text-white/70",
      )}
    >
      {/* Active background */}
      {active && (
        <span className="absolute inset-0 bg-[var(--ave-accent)]/[0.08]" />
      )}
      {/* Active left accent */}
      {active && (
        <span className="absolute inset-y-[6px] left-0 w-[2px] bg-[var(--ave-accent-bright)]" />
      )}
      <Icon size={15} className="relative z-10" />
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap bg-[#18181b] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/70 opacity-0 shadow-[0_2px_12px_rgba(0,0,0,0.5)] transition-opacity duration-100 group-hover:opacity-100">
        {item.label}
      </span>
    </Link>
  );
}

export function LeftNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-14 lg:shrink-0 lg:flex-col lg:items-center lg:border-r lg:border-white/[0.06] lg:bg-[var(--background)]">
      {/* Brand mark */}
      <Link
        href="/"
        className="group flex h-14 w-full items-center justify-center border-b border-white/[0.06]"
        aria-label="Ave Talon home"
      >
        <div className="flex h-7 w-7 items-center justify-center border border-[var(--ave-accent)]/40 bg-[var(--ave-accent)]/[0.08] transition-colors group-hover:border-[var(--ave-accent)]/60 group-hover:bg-[var(--ave-accent)]/[0.12]">
          <span className="font-mono text-[11px] font-bold tracking-tight text-[var(--ave-accent-bright)]">
            A
          </span>
        </div>
      </Link>

      {/* Primary nav */}
      <nav className="flex flex-col items-center gap-px px-[7px] pt-3 pb-2">
        {PRIMARY.map((item) => (
          <RailIcon key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-auto h-px w-5 bg-white/[0.06]" />

      {/* Secondary nav */}
      <nav className="flex flex-col items-center gap-px px-[7px] pt-2 pb-3">
        {SECONDARY.map((item) => (
          <RailIcon key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Version badge */}
      <div className="mb-3 font-mono text-[7px] uppercase tracking-[0.16em] text-white/15 [writing-mode:vertical-lr]">
        v0.1
      </div>
    </aside>
  );
}
