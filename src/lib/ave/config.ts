// Ave API config — shared by claw (public) + internal clients.

export const AVE_CLAW_BASE =
  process.env.AVE_CLAW_BASE || "https://prod.ave-api.com/v2";
export const AVE_API_KEY = process.env.AVE_API_KEY || "";

// Internal API domains (rotate on failure).
export const AVE_INTERNAL_DOMAINS = [
  process.env.AVE_INTERNAL_BASE || "https://mayeas023.com",
  "https://eavnlr.com",
  "https://bpuak.com",
  "https://hmcljd.com",
  "https://api.eskegs.com",
  "https://api.agacve.com",
  "https://api.gejbckf.com",
  "https://nkdoym.com",
  "https://api.avegac.com",
];
export const AVE_INTERNAL_BASE = AVE_INTERNAL_DOMAINS[0];

export const AVE_WS_URL =
  process.env.AVE_WS_URL || "wss://mayeas023.com/ws";

// Auth token for X-Auth header. Set via env; TODO: implement auto-refresh
// via RSA-OAEP captcha flow (port of ave_auth.py) for long-lived deployments.
export let AVE_TOKEN = process.env.AVE_TOKEN || "";

export function setAveToken(newToken: string) {
  AVE_TOKEN = newToken;
}

export const INTERNAL_HEADERS_BASE: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Referer: "https://ave.ai/",
  Accept: "application/json",
};

export function internalHeaders(needAuth = false): Record<string, string> {
  const h: Record<string, string> = { ...INTERNAL_HEADERS_BASE };
  if (needAuth && AVE_TOKEN) h["X-Auth"] = AVE_TOKEN;
  return h;
}

export function clawHeaders(): Record<string, string> {
  return {
    "X-API-KEY": AVE_API_KEY,
    Accept: "application/json",
  };
}

export const DEFAULT_CHAIN = "solana";
