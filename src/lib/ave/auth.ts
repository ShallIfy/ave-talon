/**
 * Ave token auto-refresh — TypeScript port of ave_auth.py.
 *
 * Flow:
 *  1. Generate fingerprint hash (MD5 of hostname+arch)
 *  2. Build plaintext: {fingerprint}$web$1.0.0$r1r${timestamp_ms}
 *  3. Encrypt with RSA-OAEP + SHA-256 using Ave's public key
 *  4. POST to /v1api/v1/captcha/requestToken
 *  5. Server returns ave_token
 *  6. Update in-memory AVE_TOKEN via setAveToken()
 */

import { publicEncrypt, constants, createHash } from "crypto";
import { hostname, arch } from "os";
import { AVE_INTERNAL_BASE, setAveToken, INTERNAL_HEADERS_BASE } from "./config";

// Ave.ai RSA public key (SPKI/DER, base64 — extracted from vemachine.js)
const AVE_RSA_PUBKEY_B64 = [
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp7rxCs+UF5QjAZWY63Ow",
  "1rNY4prtorIRawALlqGcWrDP2TKqC6XLybJCwOZ8HCGYzzHdQJFBLb8wlbaAJxg2",
  "/G+glwN/Hp1xNuYw6uJ7LTFMZCFsU5ReLxZ83uVs/uG80vyrpaiN+eU58B9j12+",
  "w4VbIv4dd0a5ILAQMLjJQiUgiGfD4JI9ic8qCNwOo2su3wdKthMeg5WYhYXtKJyU",
  "BJMn5odKd7XOQO7KmsuHy+dEbutSPuC2kTY+y2bzHUdTYeUp6U/GUZCjHirZCUC",
  "QyCBPE8nWoCRjhP9+ewSKSRPaTOG/uicrN1cUZC5Oal9PPigGAJ8gkKTPDgZHFPX",
  "TKuQIDAQAB",
].join("");

// Convert SPKI base64 to PEM format for Node.js crypto
const AVE_RSA_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  ...AVE_RSA_PUBKEY_B64.match(/.{1,64}/g)!,
  "-----END PUBLIC KEY-----",
].join("\n");

function generateFingerprint(): string {
  const raw = `${hostname()}-${arch()}-aveai-agent`;
  return createHash("md5").update(raw).digest("hex");
}

function encryptRequestId(fingerprint: string): string {
  const timestampMs = Date.now();
  const plaintext = `${fingerprint}$web$1.0.0$r1r$${timestampMs}`;

  const encrypted = publicEncrypt(
    {
      key: AVE_RSA_PEM,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(plaintext, "utf-8"),
  );

  return encrypted.toString("base64");
}

/**
 * Fetch a fresh ave_token from the captcha endpoint.
 * Returns the token string on success, throws on failure.
 */
export async function fetchAveToken(): Promise<string> {
  const fingerprint = generateFingerprint();
  const requestId = encryptRequestId(fingerprint);

  const res = await fetch(
    `${AVE_INTERNAL_BASE}/v1api/v1/captcha/requestToken`,
    {
      method: "POST",
      headers: {
        ...INTERNAL_HEADERS_BASE,
        "Content-Type": "application/json",
        "ave-platform": "web",
      },
      body: JSON.stringify({ request_id: requestId }),
    },
  );

  if (!res.ok) {
    throw new Error(`requestToken HTTP ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  if (body.status !== 1) {
    throw new Error(
      `requestToken failed: ${body.msg ?? "unknown"} (status=${body.status})`,
    );
  }

  const data = body.data;
  const token =
    typeof data === "object" && data !== null ? data.id ?? "" : String(data);

  if (!token) {
    throw new Error(`requestToken returned empty token: ${JSON.stringify(body)}`);
  }

  return token;
}

/**
 * Refresh the in-memory AVE_TOKEN. Returns true on success.
 */
export async function refreshAveToken(): Promise<boolean> {
  try {
    const token = await fetchAveToken();
    setAveToken(token);
    console.log(
      `[ave-auth] token refreshed: ${token.slice(0, 12)}…${token.slice(-6)} (${token.length} chars)`,
    );
    return true;
  } catch (err) {
    console.error("[ave-auth] refresh failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Periodic refresh loop
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background timer that refreshes the token every 30 minutes.
 * Also does an immediate refresh on first call.
 * Safe to call multiple times — only one timer will run.
 */
export function startTokenRefreshLoop(): void {
  if (intervalId) return; // already running

  // Immediate refresh on boot
  refreshAveToken();

  intervalId = setInterval(() => {
    refreshAveToken();
  }, REFRESH_INTERVAL_MS);

  // Don't block Node.js shutdown
  if (intervalId && typeof intervalId === "object" && "unref" in intervalId) {
    intervalId.unref();
  }

  console.log(
    `[ave-auth] token refresh loop started (every ${REFRESH_INTERVAL_MS / 60_000}min)`,
  );
}
