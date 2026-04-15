// xpoz MCP client singleton — connects to xpoz.ai for real Twitter search.
//
// Uses @modelcontextprotocol/sdk to speak MCP over HTTP. Lazy-initializes
// on first use, reuses the connection for subsequent calls. Falls back
// gracefully if XPOZ_BEARER_TOKEN is unset.
//
// IMPORTANT: Uses globalThis to survive Turbopack HMR module reloads
// (same pattern as terminal.ts / scheduler.ts).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const XPOZ_URL = "https://mcp.xpoz.ai/mcp";

// ── Types ────────────────────────────────────────────────────────────

export interface XpozTweet {
  id: string;
  text: string;
  authorUsername: string;
  likeCount: number;
  retweetCount: number;
  createdAtDate: string;
}

// ── globalThis-backed singleton ──────────────────────────────────────

const CLIENT_KEY = "__ave_xpoz_client__" as const;
const CONNECTING_KEY = "__ave_xpoz_connecting__" as const;

function getStoredClient(): Client | null {
  return ((globalThis as Record<string, unknown>)[CLIENT_KEY] as Client) ?? null;
}

function setStoredClient(c: Client | null) {
  (globalThis as Record<string, unknown>)[CLIENT_KEY] = c;
}

function getConnecting(): Promise<Client> | null {
  return (
    ((globalThis as Record<string, unknown>)[CONNECTING_KEY] as Promise<Client>) ??
    null
  );
}

function setConnecting(p: Promise<Client> | null) {
  (globalThis as Record<string, unknown>)[CONNECTING_KEY] = p;
}

async function initClient(): Promise<Client> {
  const token = process.env.XPOZ_BEARER_TOKEN;
  if (!token) throw new Error("XPOZ_BEARER_TOKEN not set");

  const c = new Client({ name: "ave-orchestrator", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(XPOZ_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  await c.connect(transport);
  return c;
}

async function getClient(): Promise<Client> {
  const existing = getStoredClient();
  if (existing) return existing;

  const inflight = getConnecting();
  if (inflight) return inflight;

  const promise = initClient()
    .then((c) => {
      setStoredClient(c);
      setConnecting(null);
      return c;
    })
    .catch((err) => {
      setConnecting(null);
      throw err;
    });

  setConnecting(promise);
  return promise;
}

/** Reset the cached client (e.g. after a connection error). */
function resetClient() {
  setStoredClient(null);
  setConnecting(null);
}

export interface XpozResult {
  tweets: XpozTweet[];
  rawText: string; // full response text — useful for Claude narrative
}

// ── Parse xpoz tool result ──────────────────────────────────────────
//
// xpoz "fast" mode returns structured text (NOT JSON):
//
//   success: true
//   data:
//     results[5]{id,text,authorUsername,impressionCount,lang,createdAtDate}:
//       "2044...",tweet text here,Username,"124",en,"2026-04-15T00:00:00.000Z"
//       "2044...","quoted tweet, with commas",User2,"8",en,"2026-04-15T00:00:00.000Z"
//
// We parse the header for field names, then extract rows with CSV-aware logic.

function parseResult(result: unknown): XpozResult {
  const res = result as {
    content?: Array<{ type: string; text?: string }>;
  };

  if (!res?.content?.length) return { tweets: [], rawText: "" };

  // Concatenate all text blocks
  const rawText = res.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");

  // Try JSON first (in case xpoz changes format)
  const jsonTweets = tryParseJson(rawText);
  if (jsonTweets.length > 0) return { tweets: jsonTweets, rawText };

  // Parse the structured text format
  const tweets = parseFastText(rawText);
  return { tweets, rawText };
}

/** Try parsing as JSON (legacy/future format). */
function tryParseJson(text: string): XpozTweet[] {
  try {
    const parsed = JSON.parse(text);
    const items: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.results)
        ? parsed.results
        : [];
    return items
      .map((item) => {
        const t = item as Record<string, unknown>;
        if (!t.id && !t.tweetId) return null;
        return {
          id: String(t.id ?? t.tweetId ?? ""),
          text: String(t.text ?? t.content ?? "").slice(0, 280),
          authorUsername: String(
            t.authorUsername ?? t.author_username ?? t.username ?? "unknown",
          ),
          likeCount: Number(t.likeCount ?? t.like_count ?? t.impressionCount ?? 0),
          retweetCount: Number(t.retweetCount ?? t.retweet_count ?? 0),
          createdAtDate: String(t.createdAtDate ?? t.created_at ?? ""),
        };
      })
      .filter((t): t is XpozTweet => t !== null);
  } catch {
    return [];
  }
}

/** Parse xpoz fast-mode structured text. */
function parseFastText(text: string): XpozTweet[] {
  // 1. Find the header: results[N]{field1,field2,...}:
  const headerMatch = text.match(/results\[\d+\]\{([^}]+)\}:/);
  if (!headerMatch) return [];

  const fields = headerMatch[1].split(",").map((f) => f.trim());
  const fieldCount = fields.length;

  // 2. Find data section — everything after the header line
  const headerIdx = text.indexOf(headerMatch[0]);
  const afterHeader = text.slice(headerIdx + headerMatch[0].length);

  // 3. Split into rows. Each row starts with 4+ spaces + "digit
  //    Use a lookahead split to handle multi-line quoted fields.
  const rowTexts = splitRows(afterHeader);

  const tweets: XpozTweet[] = [];

  for (const row of rowTexts) {
    const values = parseCSVRow(row.trim(), fieldCount);
    if (values.length !== fieldCount) continue;

    // Build record from field names → values
    const rec: Record<string, string> = {};
    for (let i = 0; i < fieldCount; i++) {
      rec[fields[i]] = values[i];
    }

    tweets.push({
      id: rec.id ?? "",
      text: (rec.text ?? "").slice(0, 280),
      authorUsername: (rec.authorUsername ?? "unknown").replace(/^@/, ""),
      likeCount: Number(rec.likeCount ?? rec.impressionCount ?? 0),
      retweetCount: Number(rec.retweetCount ?? 0),
      createdAtDate: rec.createdAtDate ?? "",
    });
  }

  return tweets;
}

/** Split the data section into individual row strings. */
function splitRows(data: string): string[] {
  // Rows start with a quoted tweet ID.  Use regex to find each row start.
  const rows: string[] = [];
  const re = /(?:^|\n)\s*"(\d{10,25})"/g;
  let match: RegExpExecArray | null;
  const starts: number[] = [];

  while ((match = re.exec(data)) !== null) {
    starts.push(match.index);
  }

  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : data.indexOf("\n  count:", starts[i]);
    const row = data.slice(starts[i], end > starts[i] ? end : undefined).trim();
    // Stop at metadata lines
    if (row.startsWith("count:") || row.startsWith("query:")) break;
    rows.push(row);
  }

  return rows;
}

/** CSV-aware row parser — handles quoted fields with commas/newlines. */
function parseCSVRow(row: string, expectedFields: number): string[] {
  const values: string[] = [];
  let i = 0;
  const len = row.length;

  while (i < len && values.length < expectedFields) {
    if (row[i] === '"') {
      // Quoted field — scan until closing quote (handle escaped quotes "")
      i++; // skip opening quote
      let val = "";
      while (i < len) {
        if (row[i] === '"') {
          if (i + 1 < len && row[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += row[i];
          i++;
        }
      }
      values.push(val);
      // Skip comma separator
      if (i < len && row[i] === ",") i++;
    } else {
      // Unquoted field — scan until next comma
      // But if this is the second-to-last expected field (text), grab until
      // we can satisfy the remaining field count from the end
      const remaining = expectedFields - values.length;
      if (remaining > 1) {
        // Try to find where the rest of the fields start from the end
        const commaIdx = row.indexOf(",", i);
        if (commaIdx === -1) {
          values.push(row.slice(i));
          break;
        }
        values.push(row.slice(i, commaIdx));
        i = commaIdx + 1;
      } else {
        values.push(row.slice(i));
        break;
      }
    }
  }

  return values;
}

// ── Public API ───────────────────────────────────────────────────────

export async function searchTweets(
  query: string,
  maxResults = 10,
): Promise<XpozResult> {
  const c = await getClient();

  try {
    const result = await c.callTool({
      name: "getTwitterPostsByKeywords",
      arguments: {
        query,
        userPrompt: `Find recent tweets about this crypto token: ${query}`,
        limit: maxResults,
        filterOutRetweets: true,
        fields: ["id", "text", "authorUsername", "createdAtDate", "likeCount", "impressionCount"],
      },
    });

    return parseResult(result);
  } catch (err) {
    // Connection may have dropped — reset and let next call reconnect
    console.error("[xpoz-client] callTool failed, resetting client:", err);
    resetClient();
    throw err;
  }
}

/** Check whether xpoz is configured (token present). */
export function isXpozConfigured(): boolean {
  return !!process.env.XPOZ_BEARER_TOKEN;
}
