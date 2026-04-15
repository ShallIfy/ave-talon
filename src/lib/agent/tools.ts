// AVE AI — Claude tool definitions for the chat route.
// 22 tools across 4 layers: Core data, Signal engine, Scanner, Watchlist/Trade.
//
// Each tool uses `tool()` + zod schema (AI SDK v6 pattern) and calls into
// src/lib/ave/* or src/lib/signals/* directly (no HTTP round-trip).

import { tool } from "ai";
import { z } from "zod";

import {
  getHolderRatio,
  getHolderDetails,
  getTokenDetail,
  getKline,
  getDevInfo,
  getPumpTokens,
  type PumpCategory,
} from "@/lib/ave/internal";
import { getCompositeRisk } from "@/lib/ave/dev";
import { buildAveSnapshot } from "@/lib/ave/snapshot";
import { detectSignalFromSnapshot } from "@/lib/signals/detector";
import { getSolBalance } from "@/lib/solana/connection";
import {
  getJupiterQuote,
  buildJupiterSwap,
  quoteSolToToken,
} from "@/lib/solana/jupiter";
import {
  SOL_MINT,
  LAMPORTS_PER_SOL,
  DEFAULT_SLIPPAGE_BPS,
} from "@/lib/solana/config";
import { prisma } from "@/lib/db/client";

const chainDefault = z.string().optional().default("solana");

function pickPrimaryPair(detail: Record<string, unknown>): string | null {
  const pairs = (detail as { pairs?: Array<Record<string, unknown>> }).pairs;
  if (!pairs || pairs.length === 0) return null;
  const first = pairs[0];
  return (
    (first.pair as string | undefined) ||
    (first.pair_address as string | undefined) ||
    (first.pair_id as string | undefined) ||
    null
  );
}

// ═══════════════════════════════════════════════
// LAYER 1 — Core data access (8 tools)
// ═══════════════════════════════════════════════

const coreTools = {
  ave_get_token_detail: tool({
    description:
      "Fetch Ave token detail: symbol, name, total supply, decimals, primary pair ID, holders, and pair metadata.",
    inputSchema: z.object({
      mint: z.string().describe("Solana token mint address"),
      chain: chainDefault,
    }),
    execute: async ({ mint, chain }) => {
      const detail = await getTokenDetail(mint, chain);
      const t = detail.token ?? {};
      return {
        mint,
        symbol: t.symbol ?? null,
        name: t.name ?? null,
        totalSupply: t.total ?? null,
        decimals: t.decimal ?? null,
        logoUrl: t.logo_url ?? null,
        primaryPairId: pickPrimaryPair(detail),
        rawPairsCount: detail.pairs?.length ?? 0,
      };
    },
  }),

  ave_get_holders: tool({
    description:
      "Get a ranked list of top holders for a Solana token, including balance, USD value, and concentration.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
      limit: z.number().int().min(1).max(100).optional().default(20),
    }),
    execute: async ({ mint, chain, limit }) => {
      const holders = await getHolderDetails(mint, chain);
      return { mint, holders: holders.slice(0, limit), total: holders.length };
    },
  }),

  ave_get_holder_timeseries: tool({
    description:
      "Get time-series of holder counts + top10 concentration + >$10 USD holder count. Used for growth/health trend analysis.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
      interval: z.enum(["1m", "5m", "1h", "4h"]).optional().default("1m"),
    }),
    execute: async ({ mint, chain, interval }) => {
      const series = await getHolderRatio(mint, chain, interval);
      const cleaned = series.filter(
        (p) =>
          (p.holders_count ?? -1) >= 0 &&
          (p.HoldersAbove10Usd ?? -1) >= 0 &&
          (p.top10_ratio ?? -1) >= 0,
      );
      return {
        mint,
        interval,
        points: cleaned.length,
        series: cleaned.slice(-50), // last 50 points to keep token count reasonable
      };
    },
  }),

  ave_get_kline: tool({
    description:
      "Fetch OHLCV candles for a token via its primary pair. Resolves pair ID from token detail if needed.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
      intervalMinutes: z
        .enum(["1", "5", "15", "30", "60", "900"])
        .optional()
        .default("60"),
      minutesBack: z.number().int().min(10).max(1440).optional().default(120),
    }),
    execute: async ({ mint, chain, intervalMinutes, minutesBack }) => {
      const detail = await getTokenDetail(mint, chain);
      const pairId = pickPrimaryPair(detail);
      if (!pairId) return { error: "no pair found for token" };
      const interval = parseInt(intervalMinutes) as 1 | 5 | 15 | 30 | 60 | 900;
      const candles = await getKline(pairId, chain, interval, minutesBack);
      return { mint, pairId, candles };
    },
  }),

  ave_get_dev_info: tool({
    description:
      "Get developer wallet info for a token: prior rugs, balance ratio, holder count, KOL flags.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
    }),
    execute: async ({ mint, chain }) => {
      const dev = await getDevInfo(mint, chain);
      return { mint, dev };
    },
  }),

  ave_get_risk_score: tool({
    description:
      "Composite risk score 0-100 combining dev info + rug pull rate. Higher = riskier.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
    }),
    execute: async ({ mint, chain }) => {
      const risk = await getCompositeRisk(mint, chain);
      return { mint, ...risk };
    },
  }),

  ave_compute_mcap: tool({
    description:
      "Compute market cap = totalSupply × latest close price, using Ave detail + latest kline candle.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
    }),
    execute: async ({ mint, chain }) => {
      const snap = await buildAveSnapshot(mint, { chain, includeRisk: false });
      const latestClose = snap.klines.at(-1)?.c ?? null;
      const mcap =
        snap.totalSupply && latestClose ? snap.totalSupply * latestClose : null;
      return {
        mint,
        symbol: snap.symbol,
        totalSupply: snap.totalSupply,
        latestClose,
        mcapUsd: mcap,
      };
    },
  }),

  solana_wallet_balances: tool({
    description:
      "Get SOL balance for a wallet address. SPL token balances are not yet enumerated.",
    inputSchema: z.object({
      address: z.string().describe("Solana wallet address (base58)"),
    }),
    execute: async ({ address }) => {
      const solBalance = await getSolBalance(address);
      return { address, solBalance };
    },
  }),
};

// ═══════════════════════════════════════════════
// LAYER 2 — Signal engine (5 tools)
// ═══════════════════════════════════════════════

const signalTools = {
  signal_detect: tool({
    description:
      "Run full 10-pattern signal detection on a token. Builds a fresh snapshot and classifies.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
      lookback: z.number().int().min(1).max(20).optional().default(5),
    }),
    execute: async ({ mint, chain, lookback }) => {
      const snap = await buildAveSnapshot(mint, { chain });
      const detected = detectSignalFromSnapshot(snap, lookback);
      return {
        mint,
        symbol: snap.symbol,
        signal: detected.signal,
        score: detected.score,
        reasoning: detected.reasoning,
        dimension: detected.dimension,
        dimensionsNormalized: detected.dimensionsNormalized,
      };
    },
  }),

  signal_get_recent: tool({
    description:
      "Query recent signals from the local database, optionally filtered by confidence.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).optional().default(20),
      minConfidence: z.enum(["LOW", "MED", "HIGH"]).optional(),
    }),
    execute: async ({ limit, minConfidence }) => {
      const allowed = minConfidence
        ? minConfidence === "HIGH"
          ? ["HIGH"]
          : minConfidence === "MED"
            ? ["MED", "HIGH"]
            : ["LOW", "MED", "HIGH"]
        : undefined;
      const signals = await prisma.signal.findMany({
        where: allowed ? { confidence: { in: allowed } } : undefined,
        orderBy: { detectedAt: "desc" },
        take: limit,
        include: { token: true },
      });
      return { count: signals.length, signals };
    },
  }),

  signal_explain: tool({
    description:
      "Fetch a single signal from the DB and return its meta + reasoning.",
    inputSchema: z.object({
      signalId: z.string(),
    }),
    execute: async ({ signalId }) => {
      const sig = await prisma.signal.findUnique({
        where: { id: signalId },
        include: { token: true },
      });
      if (!sig) return { error: "signal not found" };
      return sig;
    },
  }),

  signal_score_dimensions: tool({
    description:
      "Compute the 5-dimensional signal vector (holder growth / top10 delta / real money / volume / price) for a token.",
    inputSchema: z.object({
      mint: z.string(),
      chain: chainDefault,
    }),
    execute: async ({ mint, chain }) => {
      const snap = await buildAveSnapshot(mint, { chain, includeRisk: false });
      const detected = detectSignalFromSnapshot(snap);
      return {
        mint,
        symbol: snap.symbol,
        score: detected.score,
        dimensions: detected.dimensionsNormalized,
        pattern: detected.signal.name,
      };
    },
  }),

  signal_compare: tool({
    description:
      "Build snapshots + signals for two tokens in parallel and compare them side-by-side.",
    inputSchema: z.object({
      mintA: z.string(),
      mintB: z.string(),
      chain: chainDefault,
    }),
    execute: async ({ mintA, mintB, chain }) => {
      const [a, b] = await Promise.all([
        buildAveSnapshot(mintA, { chain, includeRisk: false }),
        buildAveSnapshot(mintB, { chain, includeRisk: false }),
      ]);
      const sigA = detectSignalFromSnapshot(a);
      const sigB = detectSignalFromSnapshot(b);
      return {
        a: {
          mint: mintA,
          symbol: a.symbol,
          score: sigA.score,
          pattern: sigA.signal.name,
          reasoning: sigA.reasoning,
        },
        b: {
          mint: mintB,
          symbol: b.symbol,
          score: sigB.score,
          pattern: sigB.signal.name,
          reasoning: sigB.reasoning,
        },
      };
    },
  }),
};

// ═══════════════════════════════════════════════
// LAYER 3 — Scanner (3 tools)
// ═══════════════════════════════════════════════

const scannerTools = {
  scanner_trending: tool({
    description:
      "Scan pump.fun / moonshot tokens by category: graduated (already graduated, likely liquid) or new (fresh launches).",
    inputSchema: z.object({
      source: z
        .enum(["graduated", "new"])
        .optional()
        .default("graduated"),
      platforms: z
        .string()
        .optional()
        .default("pump,moonshot")
        .describe("Comma-separated platforms"),
      limit: z.number().int().min(1).max(50).optional().default(20),
    }),
    execute: async ({ source, platforms, limit }) => {
      const tokens = await getPumpTokens(source as PumpCategory, {
        limit,
        platforms,
      });
      return { source, platforms, count: tokens.length, tokens };
    },
  }),

  scanner_filter: tool({
    description:
      "Filter scan results by mcap range, min volume, or min holder count. Runs against the latest graduated token fetch.",
    inputSchema: z.object({
      minMcap: z.number().optional(),
      maxMcap: z.number().optional(),
      minVolume: z.number().optional(),
      minHolders: z.number().int().optional(),
      limit: z.number().int().min(1).max(50).optional().default(20),
    }),
    execute: async ({ minMcap, maxMcap, minVolume, minHolders, limit }) => {
      const tokens = await getPumpTokens("graduated", { limit: 100 });
      const filtered = tokens.filter((t) => {
        const mcap = (t.market_cap as number | undefined) ?? 0;
        const vol = (t.volume_u_24h as number | undefined) ?? 0;
        const holders = (t.holders as number | undefined) ?? 0;
        if (minMcap !== undefined && mcap < minMcap) return false;
        if (maxMcap !== undefined && mcap > maxMcap) return false;
        if (minVolume !== undefined && vol < minVolume) return false;
        if (minHolders !== undefined && holders < minHolders) return false;
        return true;
      });
      return { matched: filtered.length, tokens: filtered.slice(0, limit) };
    },
  }),

  scanner_refresh: tool({
    description:
      "Force re-fetch of pump tokens and persist them as ScanResult rows in the DB.",
    inputSchema: z.object({
      source: z
        .enum(["graduated", "new"])
        .optional()
        .default("graduated"),
      limit: z.number().int().min(1).max(50).optional().default(20),
    }),
    execute: async ({ source, limit }) => {
      const tokens = await getPumpTokens(source as PumpCategory, { limit });
      let persisted = 0;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const mint =
          (t.address as string | undefined) ??
          (t.token_address as string | undefined);
        if (!mint) continue;
        try {
          await prisma.token.upsert({
            where: { mint },
            update: { lastScannedAt: new Date() },
            create: {
              mint,
              symbol: (t.symbol as string | undefined) ?? null,
              name: (t.name as string | undefined) ?? null,
            },
          });
          await prisma.scanResult.create({
            data: {
              source,
              tokenMint: mint,
              rank: i + 1,
              meta: t as object,
            },
          });
          persisted++;
        } catch {
          // skip bad row
        }
      }
      return { source, fetched: tokens.length, persisted };
    },
  }),
};

// ═══════════════════════════════════════════════
// LAYER 4 — Watchlist & trade (6 tools)
// ═══════════════════════════════════════════════

function buildWatchlistTools(ownerWallet: string) {
  return {
    watchlist_add: tool({
      description:
        "Add a token to the user's watchlist. Creates a default watchlist if none exists.",
      inputSchema: z.object({
        mint: z.string(),
        note: z.string().optional(),
      }),
      execute: async ({ mint, note }) => {
        if (!ownerWallet) return { error: "no wallet connected" };
        await prisma.token.upsert({
          where: { mint },
          update: {},
          create: { mint },
        });
        const wl = await prisma.watchlist.upsert({
          where: { id: `default-${ownerWallet}` },
          update: {},
          create: {
            id: `default-${ownerWallet}`,
            owner: ownerWallet,
            name: "Default",
          },
        });
        const item = await prisma.watchlistItem.upsert({
          where: {
            watchlistId_tokenMint: { watchlistId: wl.id, tokenMint: mint },
          },
          update: { note: note ?? null },
          create: { watchlistId: wl.id, tokenMint: mint, note: note ?? null },
        });
        return { added: true, item };
      },
    }),

    watchlist_remove: tool({
      description: "Remove a token from the user's default watchlist.",
      inputSchema: z.object({ mint: z.string() }),
      execute: async ({ mint }) => {
        if (!ownerWallet) return { error: "no wallet connected" };
        const wl = await prisma.watchlist.findUnique({
          where: { id: `default-${ownerWallet}` },
        });
        if (!wl) return { removed: false, reason: "no watchlist" };
        await prisma.watchlistItem
          .delete({
            where: {
              watchlistId_tokenMint: { watchlistId: wl.id, tokenMint: mint },
            },
          })
          .catch(() => null);
        return { removed: true };
      },
    }),

    watchlist_list: tool({
      description: "List all tokens in the user's default watchlist.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ownerWallet) return { error: "no wallet connected" };
        const wl = await prisma.watchlist.findUnique({
          where: { id: `default-${ownerWallet}` },
          include: { items: { include: { token: true } } },
        });
        return { count: wl?.items.length ?? 0, items: wl?.items ?? [] };
      },
    }),

    jupiter_quote: tool({
      description:
        "Get a Jupiter v6 swap quote. Returns route plan, output amount, price impact, and quoteResponse for later tx building.",
      inputSchema: z.object({
        inputMint: z.string().describe("Input token mint (use SOL mint for native)"),
        outputMint: z.string(),
        amount: z
          .string()
          .describe("Raw amount in smallest unit (e.g. lamports for SOL)"),
        slippageBps: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(DEFAULT_SLIPPAGE_BPS),
      }),
      execute: async ({ inputMint, outputMint, amount, slippageBps }) => {
        const quote = await getJupiterQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
        });
        return {
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          slippageBps: quote.slippageBps,
          routePlan: quote.routePlan,
          quoteResponse: quote,
        };
      },
    }),

    trade_propose: tool({
      description:
        "Propose a buy or sell trade. Builds an unsigned Jupiter swap transaction (base64) for the user to sign in Phantom. This is observer mode — backend never signs.",
      inputSchema: z.object({
        mint: z.string().describe("Target token mint"),
        side: z.enum(["buy", "sell"]),
        amountSol: z
          .number()
          .positive()
          .describe("Amount in SOL (for buy: SOL in, for sell: SOL out)"),
        slippageBps: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(DEFAULT_SLIPPAGE_BPS),
      }),
      execute: async ({ mint, side, amountSol, slippageBps }) => {
        if (!ownerWallet) return { error: "no wallet connected" };
        if (side === "sell") {
          return {
            error:
              "sell not yet supported — need token balance lookup (post-hackathon)",
          };
        }
        const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
        const quote = await quoteSolToToken(mint, amountSol, slippageBps);
        const swap = await buildJupiterSwap({
          quoteResponse: quote,
          userPublicKey: ownerWallet,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        });
        return {
          type: "trade_proposal",
          side,
          mint,
          amountSol,
          slippageBps,
          lamports,
          unsignedTxB64: swap.swapTransaction,
          expectedOut: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          warnings: [
            `This is a BUY proposal. You will sign it in Phantom.`,
            `Price impact: ${quote.priceImpactPct}%.`,
            `Max slippage: ${slippageBps / 100}%.`,
          ],
        };
      },
    }),

    trade_history: tool({
      description: "List the user's recent trade proposals / executions.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      execute: async ({ limit }) => {
        if (!ownerWallet) return { error: "no wallet connected" };
        const trades = await prisma.trade.findMany({
          where: { owner: ownerWallet },
          orderBy: { proposedAt: "desc" },
          take: limit,
          include: { token: true },
        });
        return { count: trades.length, trades };
      },
    }),
  };
}

// ═══════════════════════════════════════════════
// Assemble
// ═══════════════════════════════════════════════

export function buildAveTools(walletAddress: string) {
  return {
    ...coreTools,
    ...signalTools,
    ...scannerTools,
    ...buildWatchlistTools(walletAddress),
  };
}

// Exported SOL mint constant for convenience when tools need it.
export { SOL_MINT };
