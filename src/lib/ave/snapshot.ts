// buildAveSnapshot — parallel collector for a single token using
// Promise.allSettled with per-collector error reporting.
//
// Shape is token-centric (not wallet-centric) because AVE AI is about
// token discovery, not portfolio management.

import {
  getHolderRatio,
  getTokenDetail,
  getKline,
  getKlineByToken,
  type HolderInterval,
  type HolderRatioPoint,
  type KlineCandle,
  type TokenDetail,
} from "./internal";
import { getCompositeRisk, type CompositeRisk } from "./dev";
import {
  computeMcapSeries,
  averageVolume,
  latestPrice,
  priceChangePct,
  type McapPoint,
} from "./kline";
import {
  summarizeHolderDeltas,
  cleanHolderSeries,
  type HolderDeltaSummary,
} from "./holders";

export interface AveSnapshot {
  timestamp: number;
  token: string;
  chain: string;

  // Token identity
  symbol: string | null;
  name: string | null;
  totalSupply: number | null;
  decimals: number | null;
  logoUrl: string | null;
  primaryPairId: string | null;

  // Token age (hours since launch). Used by Phase Timeline to pick the
  // right holder interval so the visible window covers the token's whole
  // life without losing per-5-min signal matrix correctness.
  tokenAgeHours: number | null;
  publishAt: number | null; // unix seconds, from Ave token detail

  // Holder series (dims 1-3)
  holderSeries: HolderRatioPoint[];
  holderDelta: HolderDeltaSummary | null;
  holderIntervalUsed: HolderInterval; // the interval that was actually fetched
  detectorLookback: number;            // matching lookback to keep 5-min delta

  // Price / volume series (dims 4-5)
  klines: KlineCandle[];
  mcapSeries: McapPoint[];
  latestPriceUsd: number;
  priceChangePct: number;
  volume1hAvg: number;

  // Risk composite
  risk: CompositeRisk | null;

  // Metadata
  metadata: {
    collectionTimeMs: number;
    errors: Array<{ source: string; message: string }>;
  };
}

/**
 * Pick the right holder sampling interval + detector lookback for a token of
 * the given age. Both options below preserve the "5-min delta" required by
 * the signal matrix:
 *
 *   { interval: "1m", lookback: 5 }  → curr vs t-5min  (HD, ~7h coverage)
 *   { interval: "5m", lookback: 1 }  → curr vs t-5min  (medium, ~37h coverage)
 *
 * Anything coarser (1h/4h) breaks the matrix and is reserved for the
 * dedicated backtest tool, not Phase Timeline / entry-exit hunting.
 */
export function pickHolderInterval(ageHours: number | null): {
  interval: HolderInterval;
  lookback: number;
} {
  // Unknown age → default to 1m (safest for new tokens, signal-matrix correct)
  if (ageHours == null || !Number.isFinite(ageHours)) {
    return { interval: "1m", lookback: 5 };
  }
  if (ageHours < 5) return { interval: "1m", lookback: 5 };
  return { interval: "5m", lookback: 1 };
}

function pickPrimaryPair(detail: TokenDetail): string | null {
  // First check token.main_pair (populated for most tokens including pump.fun)
  const mainPair = detail.token?.main_pair as string | undefined;
  if (mainPair) return mainPair;

  // Fallback: pick from pairs array
  const pairs = detail.pairs;
  if (!pairs || pairs.length === 0) return null;
  const first = pairs[0] as Record<string, unknown>;
  const pairAddr =
    (first.pair as string | undefined) ||
    (first.pair_address as string | undefined) ||
    (first.pair_id as string | undefined) ||
    null;
  return pairAddr;
}

function toNumber(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function readPublishAt(detail: TokenDetail): number | null {
  const t = detail.token as Record<string, unknown> | undefined;
  if (!t) return null;
  const v = t.publish_at ?? t.opening_at;
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function buildAveSnapshot(
  token: string,
  opts: {
    chain?: string;
    holderInterval?: HolderInterval;
    /**
     * When true, fetch token detail FIRST to read `publish_at`, then pick
     * the optimal holder interval (1m for fresh, 5m for ≥5h old) so the
     * Phase Timeline always covers the full token life. Adds one serial
     * step but still parallelizes risk + kline. Ignored when
     * `holderInterval` is set explicitly.
     */
    holderIntervalAuto?: boolean;
    klineInterval?: 1 | 5 | 15 | 30 | 60 | 900;
    klineMinutesBack?: number;
    includeRisk?: boolean;
  } = {},
): Promise<AveSnapshot> {
  const t0 = Date.now();
  const chain = opts.chain ?? "solana";
  const explicitInterval = opts.holderInterval ?? null;
  const auto = opts.holderIntervalAuto === true && explicitInterval == null;
  const klineInterval = opts.klineInterval ?? 60;
  const klineMinutesBack = opts.klineMinutesBack ?? 120;
  const includeRisk = opts.includeRisk ?? true;
  const errors: Array<{ source: string; message: string }> = [];

  let detail: TokenDetail = {};
  let publishAt: number | null = null;
  let tokenAgeHours: number | null = null;
  let holderInterval: HolderInterval;
  let detectorLookback: number;

  // ─────────────────────────────────────────────────────────────────────
  // Auto-interval mode: fetch detail FIRST to compute token age, then
  // pick { interval, lookback } so the signal-matrix-correct 5-min delta
  // is preserved at the right resolution for the token's life span.
  // ─────────────────────────────────────────────────────────────────────
  if (auto) {
    try {
      detail = await getTokenDetail(token, chain);
    } catch (err) {
      errors.push({ source: "getTokenDetail", message: String(err) });
    }
    publishAt = readPublishAt(detail);
    tokenAgeHours = publishAt
      ? (Date.now() / 1000 - publishAt) / 3600
      : null;
    const picked = pickHolderInterval(tokenAgeHours);
    holderInterval = picked.interval;
    detectorLookback = picked.lookback;
  } else {
    holderInterval = explicitInterval ?? "1m";
    detectorLookback = 5;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stage 1: parallel fetch of (detail when not auto), holders, risk.
  // In auto mode detail is already fetched above so we skip it here.
  // ─────────────────────────────────────────────────────────────────────
  const stage1: Array<Promise<unknown>> = [
    getHolderRatio(token, chain, holderInterval),
    includeRisk ? getCompositeRisk(token, chain) : Promise.resolve(null),
  ];
  if (!auto) {
    stage1.unshift(getTokenDetail(token, chain));
  }

  const stage1Results = await Promise.allSettled(stage1);
  let cursor = 0;
  if (!auto) {
    const detailRes = stage1Results[cursor++];
    if (detailRes.status === "fulfilled") {
      detail = detailRes.value as TokenDetail;
    } else {
      errors.push({
        source: "getTokenDetail",
        message: String(detailRes.reason),
      });
    }
    publishAt = readPublishAt(detail);
    tokenAgeHours = publishAt
      ? (Date.now() / 1000 - publishAt) / 3600
      : null;
  }
  const holderRes = stage1Results[cursor++];
  const riskRes = stage1Results[cursor++];

  let holderSeries: HolderRatioPoint[] = [];
  if (holderRes.status === "fulfilled") {
    holderSeries = cleanHolderSeries(holderRes.value as HolderRatioPoint[]);
  } else {
    errors.push({
      source: "getHolderRatio",
      message: String(holderRes.reason),
    });
  }

  let risk: CompositeRisk | null = null;
  if (riskRes.status === "fulfilled") {
    risk = riskRes.value as CompositeRisk | null;
  } else {
    errors.push({ source: "getCompositeRisk", message: String(riskRes.reason) });
  }

  // Backfill top10Ratio from the already-fetched holder time series
  // (this field isn't returned by any of the risk endpoints).
  if (risk && holderSeries.length > 0) {
    const latest = holderSeries[holderSeries.length - 1];
    const t10 = latest?.top10_ratio;
    if (typeof t10 === "number" && Number.isFinite(t10)) {
      risk.top10Ratio = t10;
    }
  }

  // Stage 2: Now that we have detail, fetch kline using primary pair id.
  // Fallback to token_id if no pair address is found (common for pump.fun tokens).
  const pairId = pickPrimaryPair(detail);
  let klines: KlineCandle[] = [];
  if (pairId) {
    try {
      klines = await getKline(pairId, chain, klineInterval, klineMinutesBack);
    } catch (err) {
      errors.push({ source: "getKline", message: String(err) });
    }
  }
  // Fallback: try by token_id when pair is missing or pair-based fetch returned 0 candles
  if (klines.length === 0) {
    try {
      klines = await getKlineByToken(token, chain, klineInterval, klineMinutesBack);
    } catch (err) {
      if (!pairId) {
        errors.push({ source: "getKlineByToken", message: String(err) });
      }
    }
  }

  const totalSupply = toNumber(detail.token?.total);
  const mcapSeries = totalSupply && klines.length > 0
    ? computeMcapSeries(totalSupply, klines)
    : [];

  return {
    timestamp: Math.floor(Date.now() / 1000),
    token,
    chain,

    symbol: (detail.token?.symbol as string | undefined) ?? null,
    name: (detail.token?.name as string | undefined) ?? null,
    totalSupply,
    decimals: (detail.token?.decimal as number | undefined) ?? null,
    logoUrl: (detail.token?.logo_url as string | undefined) ?? null,
    primaryPairId: pairId,

    tokenAgeHours,
    publishAt,

    holderSeries,
    holderDelta: summarizeHolderDeltas(holderSeries),
    holderIntervalUsed: holderInterval,
    detectorLookback,

    klines,
    mcapSeries,
    latestPriceUsd: latestPrice(klines),
    priceChangePct: priceChangePct(klines),
    volume1hAvg: averageVolume(klines, 60),

    risk,

    metadata: {
      collectionTimeMs: Date.now() - t0,
      errors,
    },
  };
}
