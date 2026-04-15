// Ave Claw public API client (https://prod.ave-api.com/v2).
// Requires AVE_API_KEY header. If not set, these functions throw.
//
// Used as fallback / alternative to the internal API for search, trending, and risk.

import { AVE_CLAW_BASE, AVE_API_KEY, clawHeaders, DEFAULT_CHAIN } from "./config";

function _requireClawKey() {
  if (!AVE_API_KEY) {
    throw new Error(
      "AVE_API_KEY not set — Ave Claw public API unavailable. " +
        "Set AVE_API_KEY in .env.local or rely on internal API.",
    );
  }
}

async function _get<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  _requireClawKey();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = qs.size > 0
    ? `${AVE_CLAW_BASE}${path}?${qs.toString()}`
    : `${AVE_CLAW_BASE}${path}`;

  const r = await fetch(url, { headers: clawHeaders(), cache: "no-store" });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`ave claw ${r.status}: ${url} → ${body.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

export interface ClawSearchResult {
  token?: string;
  chain?: string;
  symbol?: string;
  name?: string;
  logo_url?: string;
  [k: string]: unknown;
}

export async function clawSearchTokens(keyword: string) {
  return _get<{ status: number; data: ClawSearchResult[] }>(`/tokens/search`, {
    keyword,
  });
}

export async function clawGetTrending(chain: string = DEFAULT_CHAIN) {
  return _get<{ status: number; data: Record<string, unknown>[] }>(
    `/tokens/trending`,
    { chain },
  );
}

export async function clawGetTokenRisk(chain: string, address: string) {
  return _get<{ status: number; data: Record<string, unknown> }>(
    `/tokens/${chain}/${address}/risk`,
    {},
  );
}
