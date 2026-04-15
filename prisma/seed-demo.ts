// Seed 3 demo research cards for the /terminal page.
// Run: npx tsx prisma/seed-demo.ts

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://ave_hack:ave_hack_dev@localhost:5432/ave_hackathon";

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEMO_TOKENS = [
  {
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    symbol: "POPCAT",
    name: "Popcat",
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "Bonk",
  },
  {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    symbol: "WIF",
    name: "dogwifhat",
  },
];

const DEMO_RESEARCH = [
  {
    // POPCAT — Strong Entry
    token: DEMO_TOKENS[0],
    patternId: 1,
    patternName: "Strong Entry",
    action: "ENTRY",
    score: 92.4,
    confidence: "HIGH",
    priceUsd: 0.00234,
    mcapUsd: 2_340_000,
    holderCount: 4_821,
    narrative:
      "Multiple large wallets have been steadily accumulating $POPCAT over the past hour while the top 10 concentration drops — classic distribution pattern. Holder count spiked +8.3% in the last 5 minutes with 47 new wallets above $10. Volume is running at 4.2× average. Twitter sentiment shows growing awareness with several crypto analysts flagging the holder growth pattern. The combination of whale distribution, organic retail inflow, and above-average volume makes this a textbook strong entry setup.",
    reasoning:
      "holders SPIKE +8.3% | top10 down -2.1% (distributing) | real money +47 wallets | volume 4.2× avg | price up +12.6%",
    dimensions: {
      holderGrowth: 0.083,
      top10Concentration: -0.021,
      realMoney: 0.047,
      volume: 0.042,
      price: 0.126,
    },
    tweets: [
      {
        id: "1891234567890123456",
        text: "$POPCAT holder count going absolutely vertical right now. 4800+ holders and climbing fast. Whale wallets distributing to retail — this is what organic growth looks like. Not financial advice but I'm watching closely.",
        authorUsername: "sol_tracker",
        likes: 847,
        createdAt: "2h ago",
      },
      {
        id: "1891234567890123457",
        text: "Just noticed $POPCAT volume spiked 4x in the last hour. Top wallets are selling into strength while smaller wallets keep buying. Classic accumulation pattern before a bigger move.",
        authorUsername: "defi_sage",
        likes: 312,
        createdAt: "3h ago",
      },
      {
        id: "1891234567890123458",
        text: "The on-chain data for $POPCAT is really interesting rn. New holders above $10 jumping fast, top10 concentration dropping. Looks like smart money is distributing before the next leg up.",
        authorUsername: "onchain_alpha",
        likes: 156,
        createdAt: "4h ago",
      },
    ],
  },
  {
    // BONK — Sneak Entry
    token: DEMO_TOKENS[1],
    patternId: 7,
    patternName: "Sneak Entry",
    action: "ENTRY",
    score: 78.6,
    confidence: "MEDIUM",
    priceUsd: 0.0000312,
    mcapUsd: 1_870_000,
    holderCount: 12_450,
    narrative:
      "A significant whale wallet has been quietly accumulating $BONK over the past few hours while the broader market isn't paying attention. Holder count remains stable but the top 10 wallet concentration has increased slightly, suggesting one or more large players are building positions. Volume is below average, which is actually bullish in this context — it means the accumulation is happening under the radar without triggering retail FOMO. This is a classic sneak entry pattern: smart money positioning before the crowd notices.",
    reasoning:
      "holders stable +0.4% | top10 UP +1.8% (whale loading) | real money +12 wallets | volume 0.7× avg (quiet) | price flat +1.2%",
    dimensions: {
      holderGrowth: 0.004,
      top10Concentration: 0.018,
      realMoney: 0.012,
      volume: -0.003,
      price: 0.012,
    },
    tweets: [
      {
        id: "1891334567890123456",
        text: "Someone is loading a massive $BONK bag. Checked the top wallets — new address in top 10 that wasn't there yesterday. They're buying in small chunks to avoid moving the price. Smart.",
        authorUsername: "whale_watcher",
        likes: 523,
        createdAt: "1h ago",
      },
      {
        id: "1891334567890123457",
        text: "$BONK flying under the radar right now. Volume is low but on-chain shows quiet accumulation from large wallets. Last time this happened it pumped 3x in a week.",
        authorUsername: "crypto_detective",
        likes: 189,
        createdAt: "5h ago",
      },
    ],
  },
  {
    // WIF — Early Entry
    token: DEMO_TOKENS[2],
    patternId: 11,
    patternName: "Early Entry",
    action: "ENTRY",
    score: 85.1,
    confidence: "HIGH",
    priceUsd: 0.00189,
    mcapUsd: 3_120_000,
    holderCount: 8_234,
    narrative:
      "Early accumulation phase detected for $WIF. Holder count has been growing steadily at +3.2% per 5 minutes for the last 30 minutes with no corresponding price spike yet — suggesting quiet buying before broader market awareness. Real money wallets (>$10 balance) up by 28 in the last window. Volume is moderate at 1.8× average, enough to confirm interest but not enough to signal FOMO. The top 10 concentration is stable, meaning whales haven't started distributing yet. This is the early bird phase — holders are accumulating but the price hasn't moved significantly, creating an asymmetric opportunity.",
    reasoning:
      "holders GROW +3.2% (steady) | top10 stable -0.3% | real money +28 wallets | volume 1.8× avg (moderate) | price up +4.1%",
    dimensions: {
      holderGrowth: 0.032,
      top10Concentration: -0.003,
      realMoney: 0.028,
      volume: 0.018,
      price: 0.041,
    },
    tweets: [
      {
        id: "1891434567890123456",
        text: "Been watching $WIF holder growth all day. Steady climb without the usual pump-and-dump pattern. This looks like genuine organic accumulation. Setting alerts for a breakout.",
        authorUsername: "solana_signals",
        likes: 672,
        createdAt: "45m ago",
      },
      {
        id: "1891434567890123457",
        text: "$WIF on-chain metrics looking pristine. New holders flowing in, volume building slowly, price barely moved. This is what early looks like. NFA but I'm positioned.",
        authorUsername: "degen_research",
        likes: 445,
        createdAt: "2h ago",
      },
      {
        id: "1891434567890123458",
        text: "Interesting that $WIF is getting steady inflows of wallets with real money (>$10) while most memecoins are bleeding. Divergence from the pack usually means something.",
        authorUsername: "memecoin_thesis",
        likes: 201,
        createdAt: "3h ago",
      },
    ],
  },
];

async function main() {
  console.log("Seeding 3 demo research entries...\n");

  for (const demo of DEMO_RESEARCH) {
    const { token, tweets, dimensions, ...researchData } = demo;

    // 1. Upsert token
    await prisma.token.upsert({
      where: { mint: token.mint },
      update: {
        symbol: token.symbol,
        name: token.name,
        graduated: true,
      },
      create: {
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        graduated: true,
      },
    });

    // 2. Upsert research (unique per mint)
    await prisma.research.upsert({
      where: { mint: token.mint },
      update: {
        symbol: token.symbol,
        patternId: researchData.patternId,
        patternName: researchData.patternName,
        action: researchData.action,
        score: researchData.score,
        confidence: researchData.confidence,
        narrative: researchData.narrative,
        tweets: tweets as unknown as object,
        source: "ai",
        priceUsd: researchData.priceUsd,
        mcapUsd: researchData.mcapUsd,
        reasoning: researchData.reasoning,
        dimensions: dimensions as unknown as object,
        holderCount: researchData.holderCount,
        telegramSent: true,
      },
      create: {
        mint: token.mint,
        symbol: token.symbol,
        patternId: researchData.patternId,
        patternName: researchData.patternName,
        action: researchData.action,
        score: researchData.score,
        confidence: researchData.confidence,
        narrative: researchData.narrative,
        tweets: tweets as unknown as object,
        source: "ai",
        priceUsd: researchData.priceUsd,
        mcapUsd: researchData.mcapUsd,
        reasoning: researchData.reasoning,
        dimensions: dimensions as unknown as object,
        holderCount: researchData.holderCount,
        telegramSent: true,
      },
    });

    console.log(`  ✓ ${token.symbol} — #${researchData.patternId} ${researchData.patternName} (score ${researchData.score})`);
  }

  console.log("\nDone! Restart the dev server to load research cards into /terminal.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
