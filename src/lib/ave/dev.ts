// Composite risk assembler.
//
// Merges data from three upstream endpoints:
//   - /v2api/token_info/v1/token/detail   → risk_score, dev_balance_ratio_cur
//   - /v1api/v3/stats/rugpullrate          → insider/phishing/cabal/bundle rates
//   - /v2api/token_info/v1/token/dev/best  → migrated flag, holders, market_cap
//
// top10Ratio is NOT on any of these; it must be filled in later by the
// snapshot builder from `holderSeries[last].top10_ratio`.

import type { DevInfo, RugPullRate } from "./internal";
import { getDevInfo, getRugPullRate, getTokenDetailV2 } from "./internal";

export interface CompositeRisk {
  riskScore: number | null;         // 0-100, upstream Ave composite
  insiderRate: number | null;        // percentage (e.g. 2.5 = 2.5%)
  phishingRate: number | null;       // percentage (e.g. 7.8 = 7.8%)
  cabalRate: number | null;          // percentage
  bundleRate: number | null;         // percentage
  devBalanceRatio: number | null;    // 0-1 fraction still held by dev
  top10Ratio: number | null;         // 0-100 percentage — filled by snapshot.ts
  holders: number | null;
  marketCap: number | null;
  migrated: boolean;
  kolTagCount: number | null;
  rawDetail: Record<string, unknown>;
  rawDev: DevInfo;
  rawRug: RugPullRate;
}

function num(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function getCompositeRisk(
  token: string,
  chain = "solana",
): Promise<CompositeRisk> {
  const [detailRes, rugRes, devRes] = await Promise.allSettled([
    getTokenDetailV2(token, chain),
    getRugPullRate(token, chain),
    getDevInfo(token, chain),
  ]);

  const detail: Record<string, unknown> =
    detailRes.status === "fulfilled" ? detailRes.value : {};
  const rug: RugPullRate =
    rugRes.status === "fulfilled"
      ? rugRes.value
      : {
          insider_rate: null,
          phishing_rate: null,
          cabal_rate: null,
          bundle_rate: null,
          all_tag_rate: null,
          rugged: false,
          total: 0,
        };
  const dev: DevInfo = devRes.status === "fulfilled" ? devRes.value : {};

  return {
    riskScore: num(detail.risk_score) ?? num(dev.risk_score),
    insiderRate: rug.insider_rate,
    phishingRate: rug.phishing_rate,
    cabalRate: rug.cabal_rate,
    bundleRate: rug.bundle_rate,
    devBalanceRatio: num(detail.dev_balance_ratio_cur),
    top10Ratio: null, // filled in by snapshot.ts from holderSeries
    holders: num(detail.holders) ?? num(dev.holders),
    marketCap: num(detail.market_cap) ?? num(dev.market_cap),
    migrated: Boolean(dev.migrated),
    kolTagCount: num(dev.kol_tag_count),
    rawDetail: detail,
    rawDev: dev,
    rawRug: rug,
  };
}
