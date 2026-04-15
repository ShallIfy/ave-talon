// Ave.ai Internal API client — TypeScript port of aveai/ave_internal.py.
//
// Two categories:
//  - No auth: holder endpoints (ratio, stats, early holders)
//  - Auth required (X-Auth: ave_token): kline, token detail, dev/best, txs, rugpull, pump
//
// Uses native fetch (Next.js 16 / Node 20+).

import {
  AVE_INTERNAL_BASE,
  DEFAULT_CHAIN,
  AVE_TOKEN,
  internalHeaders,
} from "./config";

// =============================================================================
// SHARED TYPES
// =============================================================================

export interface AveResponse<T> {
  status: number; // 1 = ok, 0 = error
  msg?: string;
  data?: T;
}

export interface HolderRatioPoint {
  time: number; // unix seconds
  holders_count: number;
  HoldersAbove10Usd: number;
  top10_ratio: number;   // raw: 0-1 fraction. After cleanHolderSeries: 0-100 percentage.
  top50_ratio: number;
  top100_ratio: number;
}

export interface HolderDetail {
  account_address: string;
  balance?: number;
  balance_usd?: number;
  sol?: number;
  pnl?: number;
  pnl_usd?: number;
  tag?: string;
  tag_type?: string;
  new_tags?: string[];
  // ...many more fields (42 total per ave_internal.py)
  [key: string]: unknown;
}

export interface EarlyHolder {
  account_address: string;
  tag?: string;
  tag_type?: string;
  new_tags?: string[];
  [key: string]: unknown;
}

export interface KlineCandle {
  t: number;   // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
  tag?: string;
}

export interface TokenDetail {
  token?: {
    token?: string;
    symbol?: string;
    name?: string;
    total?: string | number;
    decimal?: number;
    current_price_usd?: number | string;
    price_change_1d?: number;
    logo_url?: string;
    [k: string]: unknown;
  };
  pairs?: Array<Record<string, unknown>>;
  volumes?: Array<Record<string, unknown>>;
  liquidities?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface DevInfo {
  token?: string;
  name?: string;
  symbol?: string;
  market_cap?: number;
  all_time_high?: number;
  tvl?: number;
  holders?: number;
  migrated?: boolean;
  dev_address?: string;
  dev_balance_ratio_cur?: number;
  holders_top10_ratio?: number;
  risk_score?: number;
  kol_tag_count?: number;
  [k: string]: unknown;
}

export interface RugPullRate {
  insider_rate: number | null;
  phishing_rate: number | null;
  cabal_rate: number | null;
  bundle_rate: number | null;
  all_tag_rate: number | null;
  rugged: boolean;
  total: number;
}

export interface GraduatedToken {
  token?: string;
  chain?: string;
  symbol?: string;
  name?: string;
  market_cap?: number;
  holders?: number;
  volume_u_24h?: number;
  dev_balance_ratio_cur?: number;
  holders_top10_ratio?: number;
  tvl?: number;
  risk_score?: number;
  kol_tag_count?: number;
  smart_money_tx_count_24h?: number;
  logo_url?: string;
  [k: string]: unknown;
}

// =============================================================================
// HTTP HELPERS
// =============================================================================

async function _get<T>(
  url: string,
  params: Record<string, string | number | boolean | undefined> = {},
  needAuth = false,
): Promise<AveResponse<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const full = qs.size > 0 ? `${url}?${qs.toString()}` : url;

  const r = await fetch(full, {
    headers: internalHeaders(needAuth),
    cache: "no-store",
  });

  if (r.status === 403 && needAuth) {
    // Token expired — try auto-refresh once, then retry.
    const { refreshAveToken } = await import("./auth");
    const refreshed = await refreshAveToken();
    if (refreshed) {
      const retry = await fetch(full, {
        headers: internalHeaders(true),
        cache: "no-store",
      });
      if (retry.ok) {
        return (await retry.json()) as AveResponse<T>;
      }
    }
    throw new Error(
      `ave internal 403 (token expired, auto-refresh failed): ${full}`,
    );
  }
  if (!r.ok) {
    const body = await r.text();
    throw new Error(
      `ave internal ${r.status}: ${full} → ${body.slice(0, 200)}`,
    );
  }
  return (await r.json()) as AveResponse<T>;
}

function _requireAuth() {
  if (!AVE_TOKEN) {
    throw new Error(
      "AVE_TOKEN not set — auth-required endpoint cannot proceed. " +
        "Set AVE_TOKEN in .env.local.",
    );
  }
}

// =============================================================================
// NO-AUTH: HOLDER ENDPOINTS
// =============================================================================

const HOLDER_V2 = `${AVE_INTERNAL_BASE}/v2api/holders/v1/token`;
const HOLDER_V1 = `${AVE_INTERNAL_BASE}/v1api/v3/stats`;

export type HolderInterval = "1m" | "5m" | "1h" | "4h";

/**
 * ALL-IN-ONE holder time-series: count + >$10 + top10/50/100 ratio.
 * Best endpoint for signal matrix dimensions 1-3.
 *
 * Intervals: 1m (~7h window), 5m (~37h), 1h (~14d), 4h (~14d)
 */
export async function getHolderRatio(
  token: string,
  chain: string = DEFAULT_CHAIN,
  interval: HolderInterval = "1m",
): Promise<HolderRatioPoint[]> {
  const url = `${HOLDER_V2}/top_holders/ratio`;
  const body = await _get<HolderRatioPoint[]>(
    url,
    { token, chain, interval },
    false,
  );
  if (body.status !== 1) return [];
  return body.data ?? [];
}

/**
 * Top 100 holder details: balance, SOL, PnL, tags, funding source (42 fields each).
 */
export async function getHolderDetails(
  token: string,
  chain: string = DEFAULT_CHAIN,
): Promise<HolderDetail[]> {
  const url = `${HOLDER_V1}/holders`;
  const body = await _get<{ holderStats?: HolderDetail[] }>(
    url,
    { token_id: `${token}-${chain}` },
    false,
  );
  if (body.status !== 1) return [];
  return body.data?.holderStats ?? [];
}

/**
 * Top 50 earliest holders with tags.
 */
export async function getEarlyHolders(
  token: string,
  chain: string = DEFAULT_CHAIN,
): Promise<EarlyHolder[]> {
  const url = `${HOLDER_V1}/earlyholders`;
  const body = await _get<EarlyHolder[]>(
    url,
    { token_id: `${token}-${chain}` },
    false,
  );
  if (body.status !== 1) return [];
  return Array.isArray(body.data) ? body.data : [];
}

// =============================================================================
// AUTH-REQUIRED ENDPOINTS
// =============================================================================

/**
 * OHLCV candlestick data. Source for signal matrix dimensions 4-5.
 *
 * @param pairId PAIR address (NOT token address)
 * @param interval Candle size in seconds: 1, 5, 15, 30, 60, 900
 * @param minutesBack How many minutes of history to fetch
 */
export async function getKline(
  pairId: string,
  chain: string = DEFAULT_CHAIN,
  interval: 1 | 5 | 15 | 30 | 60 | 900 = 60,
  minutesBack: number = 30,
): Promise<KlineCandle[]> {
  _requireAuth();
  const now = Math.floor(Date.now() / 1000);
  const url = `${AVE_INTERNAL_BASE}/v2api/token_info/v1/kline`;
  const body = await _get<{ kline_data?: KlineCandle[] }>(
    url,
    {
      interval,
      from: now - minutesBack * 60,
      to: now,
      pair_id: `${pairId}-${chain}`,
      category: "u",
    },
    true,
  );
  if (body.status !== 1) return [];
  return body.data?.kline_data ?? [];
}

/**
 * OHLCV candlestick data fetched by TOKEN address (not pair).
 * Useful as fallback when pair address is unknown (e.g. pump.fun tokens
 * that haven't been matched to a pair in token detail).
 */
export async function getKlineByToken(
  token: string,
  chain: string = DEFAULT_CHAIN,
  interval: 1 | 5 | 15 | 30 | 60 | 900 = 60,
  minutesBack: number = 30,
): Promise<KlineCandle[]> {
  _requireAuth();
  const now = Math.floor(Date.now() / 1000);
  const url = `${AVE_INTERNAL_BASE}/v2api/token_info/v1/kline`;
  const body = await _get<{ kline_data?: KlineCandle[] }>(
    url,
    {
      interval,
      from: now - minutesBack * 60,
      to: now,
      token_id: `${token}-${chain}`,
      category: "u",
    },
    true,
  );
  if (body.status !== 1) return [];
  return body.data?.kline_data ?? [];
}

/** Kline with explicit from/to (unix seconds). Max 200 candles per call. */
export async function getKlineRange(
  token: string,
  fromSec: number,
  toSec: number,
  chain: string = DEFAULT_CHAIN,
  interval: 1 | 5 | 15 | 30 | 60 | 900 = 60,
): Promise<KlineCandle[]> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v2api/token_info/v1/kline`;
  const body = await _get<{ kline_data?: KlineCandle[] }>(
    url,
    {
      interval,
      from: fromSec,
      to: toSec,
      token_id: `${token}-${chain}`,
      category: "u",
    },
    true,
  );
  if (body.status !== 1) return [];
  return body.data?.kline_data ?? [];
}

/**
 * Full token info: supply, price, pairs, volumes, liquidities.
 */
export async function getTokenDetail(
  token: string,
  chain: string = DEFAULT_CHAIN,
): Promise<TokenDetail> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v1api/v3/tokens/${token}-${chain}`;
  const body = await _get<TokenDetail>(url, {}, true);
  if (body.status !== 1) return {};
  return body.data ?? {};
}

/**
 * Dev info with explicit market_cap, ATH, TVL, holders, migrated status.
 */
export async function getDevInfo(
  token: string,
  chain: string = DEFAULT_CHAIN,
): Promise<DevInfo> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v2api/token_info/v1/token/dev/best`;
  const body = await _get<DevInfo>(
    url,
    { token_id: `${token}-${chain}` },
    true,
  );
  if (body.status !== 1) return {};
  return body.data ?? {};
}

/**
 * Full token detail via v2 endpoint. Richer than v1 — includes
 * `risk_score` and `dev_balance_ratio_cur` on `data.token`.
 */
export async function getTokenDetailV2(
  token: string,
  chain: string = DEFAULT_CHAIN,
): Promise<Record<string, unknown>> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v2api/token_info/v1/token/detail`;
  const body = await _get<{ token?: Record<string, unknown> }>(
    url,
    { token_id: `${token}-${chain}` },
    true,
  );
  if (body.status !== 1) return {};
  return (body.data?.token ?? {}) as Record<string, unknown>;
}

/**
 * Rug pull risk rates. Upstream returns nested `data.rates.rateList[]`
 * keyed by icon name ("Insider11.png", "Phishing11.png", ...).
 * We flatten into a typed shape for downstream consumers.
 */
export async function getRugPullRate(
  token: string,
  chain: string = DEFAULT_CHAIN,
): Promise<RugPullRate> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v1api/v3/stats/rugpullrate`;
  const body = await _get<{
    rates?: {
      rateList?: Array<{ icon?: string; rate?: number }>;
      rugged?: number | boolean;
      rugged_rate?: number;
      total?: number;
    };
  }>(url, { token_id: `${token}-${chain}` }, true);

  const empty: RugPullRate = {
    insider_rate: null,
    phishing_rate: null,
    cabal_rate: null,
    bundle_rate: null,
    all_tag_rate: null,
    rugged: false,
    total: 0,
  };
  if (body.status !== 1 || !body.data?.rates) return empty;

  const rates = body.data.rates;
  const list = Array.isArray(rates.rateList) ? rates.rateList : [];
  const find = (needle: string): number | null => {
    const row = list.find(
      (r) =>
        typeof r.icon === "string" &&
        r.icon.toLowerCase().includes(needle.toLowerCase()),
    );
    return typeof row?.rate === "number" ? row.rate : null;
  };

  return {
    insider_rate: find("insider"),
    phishing_rate: find("phishing"),
    cabal_rate: find("cabal"),
    bundle_rate: find("bundle"),
    all_tag_rate: find("all_tag_rate"),
    rugged: Boolean(rates.rugged),
    total: typeof rates.total === "number" ? rates.total : 0,
  };
}

/**
 * Recent swap transactions for a pair.
 */
export async function getTransactions(
  pair: string,
  chain: string = DEFAULT_CHAIN,
  limit: number = 50,
): Promise<Record<string, unknown>[]> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v1api/v5/pairs/${pair}-${chain}/txs`;
  const body = await _get<Record<string, unknown>[]>(url, { limit }, true);
  if (body.status !== 1) return [];
  return Array.isArray(body.data) ? body.data : [];
}

// =============================================================================
// PUMP.FUN SCANNER
// =============================================================================

export type PumpCategory = "graduated" | "new";

export interface PumpScanOptions {
  chain?: string;
  platforms?: string; // e.g. "pump,moonshot"
  marketCapMin?: number;
  marketCapMax?: number;
  volumeU24hMin?: number;
  holderMin?: number;
  devBalanceRatioCurMax?: number;
  holdersTop10RatioMax?: number;
  smartMoneyTxCount24hMin?: number;
  devSaleOut?: number;
  limit?: number;
}

/**
 * Fetch pump.fun tokens with rich filters.
 */
export async function getPumpTokens(
  category: PumpCategory = "graduated",
  opts: PumpScanOptions = {},
): Promise<GraduatedToken[]> {
  _requireAuth();
  const url = `${AVE_INTERNAL_BASE}/v2api/pump/v1/all`;

  const params: Record<string, string | number> = {
    category,
    chain: opts.chain ?? DEFAULT_CHAIN,
    platforms: opts.platforms ?? "pump,moonshot",
  };
  if (opts.marketCapMin !== undefined) params.market_cap_min = opts.marketCapMin;
  if (opts.marketCapMax !== undefined) params.market_cap_max = opts.marketCapMax;
  if (opts.volumeU24hMin !== undefined) params.volume_u_24h_min = opts.volumeU24hMin;
  if (opts.holderMin !== undefined) params.holder_min = opts.holderMin;
  if (opts.devBalanceRatioCurMax !== undefined)
    params.dev_balance_ratio_cur_max = opts.devBalanceRatioCurMax;
  if (opts.holdersTop10RatioMax !== undefined)
    params.holders_top10_ratio_max = opts.holdersTop10RatioMax;
  if (opts.smartMoneyTxCount24hMin !== undefined)
    params.smart_money_tx_count_24h_min = opts.smartMoneyTxCount24hMin;
  if (opts.devSaleOut !== undefined) params.dev_sale_out = opts.devSaleOut;
  params.limit = opts.limit ?? 50;

  const body = await _get<GraduatedToken[] | { list?: GraduatedToken[]; items?: GraduatedToken[] }>(
    url,
    params,
    true,
  );
  if (body.status !== 1) return [];
  const data = body.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.list ?? data.items ?? [];
}
