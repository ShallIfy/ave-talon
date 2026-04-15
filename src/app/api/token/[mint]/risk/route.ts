import { NextRequest, NextResponse } from "next/server";
import { getRugPullRate, getHolderDetails } from "@/lib/ave/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TagObj {
  type?: string;
  en?: string;
  icon?: string;
  color?: string;
}

interface WalletInfo {
  address: string;
  balanceUsd: number | null;
  pnl: number | null;
  sol: number | null;
}

interface CategoryResult {
  rate: number | null;
  count: number;
  wallets: WalletInfo[];
}

const TAG_MATCHERS: Record<string, (tag: string) => boolean> = {
  insider: (t) => /insider/i.test(t),
  phishing: (t) => /phishing/i.test(t),
  cabal: (t) => /cabal/i.test(t),
  bundle: (t) => /bundle/i.test(t),
};

function extractTags(holder: Record<string, unknown>): string[] {
  const tags: string[] = [];
  // new_tags can be string[] or object[] with { en } field
  const raw = holder.new_tags;
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (typeof t === "string") {
        tags.push(t);
      } else if (t && typeof t === "object" && "en" in t) {
        tags.push(String((t as TagObj).en ?? ""));
      }
    }
  }
  // Fallback: legacy single tag field
  if (typeof holder.tag === "string" && holder.tag) {
    tags.push(holder.tag);
  }
  return tags;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;

  const [rugResult, holdersResult] = await Promise.allSettled([
    getRugPullRate(mint, "solana"),
    getHolderDetails(mint, "solana"),
  ]);

  const rug =
    rugResult.status === "fulfilled"
      ? rugResult.value
      : {
          insider_rate: null,
          phishing_rate: null,
          cabal_rate: null,
          bundle_rate: null,
          all_tag_rate: null,
          rugged: false,
          total: 0,
        };

  const holders =
    holdersResult.status === "fulfilled" ? holdersResult.value : [];

  // Categorize holders by tags
  const categories: Record<string, CategoryResult> = {
    insider: { rate: rug.insider_rate, count: 0, wallets: [] },
    phishing: { rate: rug.phishing_rate, count: 0, wallets: [] },
    cabal: { rate: rug.cabal_rate, count: 0, wallets: [] },
    bundle: { rate: rug.bundle_rate, count: 0, wallets: [] },
  };

  let devAddress: string | null = null;

  for (const h of holders) {
    const raw = h as Record<string, unknown>;
    const tags = extractTags(raw);
    // API returns "holder" field, not "account_address"
    const addr = (raw.holder as string) ?? h.account_address;
    if (!addr) continue;

    const balUsd = raw.balance_usd;
    const profitRatio = raw.total_profit_ratio;
    const solBal = raw.main_coin_balance;
    const wallet: WalletInfo = {
      address: addr,
      balanceUsd: typeof balUsd === "number" ? balUsd : null,
      pnl: typeof profitRatio === "number" ? profitRatio * 100 : null,
      sol: typeof solBal === "number" ? solBal : null,
    };

    // Check DEV tag
    if (tags.some((t) => /\bDEV\b/i.test(t))) {
      devAddress = addr;
    }

    // Match against categories
    for (const [catKey, matcher] of Object.entries(TAG_MATCHERS)) {
      if (tags.some(matcher)) {
        categories[catKey].count++;
        if (categories[catKey].wallets.length < 10) {
          categories[catKey].wallets.push(wallet);
        }
      }
    }
  }

  return NextResponse.json({
    categories,
    dev: { address: devAddress },
    migrated: rug.rugged,
    totalAnalyzed: rug.total,
  });
}
