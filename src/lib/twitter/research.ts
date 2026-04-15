// Twitter narrative research — two-layer approach:
//   1. Primary: xpoz MCP real tweets → Claude narrative synthesis
//   2. Fallback: Claude-only narrative generation (no real tweets)
//
// Returns real tweet data (id, authorUsername, text, likes) for clickable
// links in the terminal research feed, plus a Claude-generated narrative.

import { searchTweets, isXpozConfigured, type XpozResult } from "./xpoz-client";

// ── Types ────────────────────────────────────────────────────────────

export interface TweetData {
  id: string;
  text: string;
  authorUsername: string;
  likes: number;
  createdAt: string;
}

export interface NarrativeResult {
  narrative: string;
  tweets: TweetData[];
  source: "xpoz" | "ai";
}

// ── In-memory cache (30 min TTL) ────────────────────────────────────

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map<string, { result: NarrativeResult; at: number }>();

function getCached(mint: string): NarrativeResult | null {
  const entry = cache.get(mint);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL) {
    cache.delete(mint);
    return null;
  }
  return entry.result;
}

function setCache(mint: string, result: NarrativeResult) {
  cache.set(mint, { result, at: Date.now() });
  if (cache.size > 200) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, 50);
    for (const [k] of oldest) cache.delete(k);
  }
}

// ── Main export ─────────────────────────────────────────────────────

export async function researchTokenNarrative(params: {
  symbol: string | null;
  mint: string;
  patternName: string;
  action: string;
  priceUsd: number;
  mcapUsd: number;
}): Promise<NarrativeResult> {
  const cached = getCached(params.mint);
  if (cached) return cached;

  let result: NarrativeResult;

  // Try xpoz (real tweets) first, fall back to Claude-only
  if (isXpozConfigured()) {
    try {
      result = await researchViaXpoz(params);
    } catch (err) {
      console.error("[twitter-research] xpoz failed, falling back to Claude:", err);
      result = await researchViaClaude(params);
    }
  } else {
    result = await researchViaClaude(params);
  }

  setCache(params.mint, result);
  return result;
}

// ── Layer 1: xpoz real tweets → Claude narrative ─────────────────────

async function researchViaXpoz(params: {
  symbol: string | null;
  mint: string;
  patternName: string;
  action: string;
  priceUsd: number;
  mcapUsd: number;
}): Promise<NarrativeResult> {
  const sym = params.symbol ?? params.mint.slice(0, 8);

  // Search for tweets about this token
  const query = `${sym} OR "$${sym}" solana OR ${params.mint.slice(0, 8)}`;
  const xpozResult: XpozResult = await searchTweets(query, 20);

  // Sort by impressions/likes descending, take top 5
  const topTweets = xpozResult.tweets
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 5);

  const tweets: TweetData[] = topTweets.map((t) => ({
    id: t.id,
    text: t.text,
    authorUsername: t.authorUsername,
    likes: t.likeCount,
    createdAt: t.createdAtDate,
  }));

  // Generate narrative using Claude, passing raw xpoz text for full context
  const narrative = await generateNarrativeFromTweets(
    params,
    tweets,
    xpozResult.rawText,
  );

  return { narrative, tweets, source: "xpoz" };
}

// ── Claude narrative from real tweets ────────────────────────────────

async function generateNarrativeFromTweets(
  params: {
    symbol: string | null;
    mint: string;
    patternName: string;
    action: string;
    priceUsd: number;
    mcapUsd: number;
  },
  tweets: TweetData[],
  rawXpozText: string,
): Promise<string> {
  const apiKey = process.env.AVE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackNarrativeText(params);

  const sym = params.symbol ?? params.mint.slice(0, 8);
  const mcapStr =
    params.mcapUsd >= 1_000_000
      ? `$${(params.mcapUsd / 1_000_000).toFixed(1)}M`
      : `$${(params.mcapUsd / 1_000).toFixed(1)}k`;

  // Use the raw xpoz text directly — it contains the full tweet data
  // that Claude can extract meaning from, even if our CSV parser missed some.
  const tweetSection = rawXpozText
    ? `Raw Twitter search results:\n${rawXpozText.slice(0, 2000)}`
    : tweets.length > 0
      ? tweets
          .map(
            (t, i) =>
              `Tweet ${i + 1} by @${t.authorUsername} (${t.likes} impressions): "${t.text.slice(0, 200)}"`,
          )
          .join("\n")
      : "No relevant tweets found.";

  const prompt = `You are a crypto analyst summarizing Twitter/X discussion about $${sym} on Solana. Based on the signal data and real tweets below, write a 2-3 sentence narrative about what CT (crypto Twitter) is saying about this token. Reference specific @usernames and tweet content when relevant.

Signal data:
- Token: $${sym}
- Signal: ${params.patternName} → ${params.action}
- Price: $${params.priceUsd < 0.01 ? params.priceUsd.toExponential(2) : params.priceUsd.toFixed(4)}
- MCap: ${mcapStr}

${tweetSection}

Rules:
- 2-3 sentences max, full English only
- Reference specific @usernames and metrics from the tweets
- Use natural crypto Twitter (CT) degen slang
- No emojis, no hashtags
- Sound like a human analyst summarizing real Twitter discussion

Write the narrative:`;

  try {
    const text = await callClaude(prompt, apiKey);
    return text.trim();
  } catch (err) {
    console.error("[twitter-research] Claude narrative from tweets failed:", err);
    return fallbackNarrativeText(params);
  }
}

// ── Layer 2: Claude-only narrative (no real tweets) ──────────────────

async function researchViaClaude(params: {
  symbol: string | null;
  mint: string;
  patternName: string;
  action: string;
  priceUsd: number;
  mcapUsd: number;
}): Promise<NarrativeResult> {
  const apiKey = process.env.AVE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      narrative: fallbackNarrativeText(params),
      tweets: [],
      source: "ai",
    };
  }

  const sym = params.symbol ?? params.mint.slice(0, 8);
  const mcapStr =
    params.mcapUsd >= 1_000_000
      ? `$${(params.mcapUsd / 1_000_000).toFixed(1)}M`
      : `$${(params.mcapUsd / 1_000).toFixed(1)}k`;

  const prompt = `You are a crypto analyst researching token $${sym} on Solana. Based on the following signal data, write a brief 2-3 sentence "Twitter narrative" — what the crypto community (CT) would likely be saying about this token right now. Write as if you found this from scanning Twitter/X. Be specific, reference the token by name, and mention the signal pattern. Use degen/CT slang naturally.

Signal data:
- Token: $${sym} (${params.mint.slice(0, 8)}…)
- Signal: ${params.patternName} → ${params.action}
- Price: $${params.priceUsd < 0.01 ? params.priceUsd.toExponential(2) : params.priceUsd.toFixed(4)}
- MCap: ${mcapStr}

Rules:
- 2-3 sentences max, full English only
- Reference specific metrics (holder growth, volume, etc) as if from Twitter discussion
- Use natural crypto Twitter (CT) degen slang
- No emojis, no hashtags
- Sound like a summary of real tweets, not AI-generated

Write the narrative:`;

  try {
    const text = await callClaude(prompt, apiKey);
    return {
      narrative: text.trim(),
      tweets: [],
      source: "ai",
    };
  } catch (err) {
    console.error("[twitter-research] Claude generateText failed:", err);
    return {
      narrative: fallbackNarrativeText(params),
      tweets: [],
      source: "ai",
    };
  }
}

// ── Direct Claude API call (bypasses SDK header issues with proxy) ───

async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const baseURL =
    process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1";
  const url = `${baseURL.replace(/\/+$/, "")}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 200,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  return text;
}

// ── Deterministic fallback ──────────────────────────────────────────

function fallbackNarrativeText(params: {
  symbol: string | null;
  patternName: string;
  action: string;
  mcapUsd?: number;
}): string {
  const sym = params.symbol ?? "token";
  const mcap = params.mcapUsd
    ? params.mcapUsd >= 1_000_000
      ? `${(params.mcapUsd / 1_000_000).toFixed(1)}M`
      : `${(params.mcapUsd / 1_000).toFixed(0)}k`
    : null;
  const mcapRef = mcap ? ` at ${mcap} mcap` : "";

  const templates: Record<string, string[]> = {
    ENTRY: [
      `$${sym} getting flagged by multiple on-chain watchers${mcapRef}. Holder count spiking while top wallets are distributing — classic smart money accumulation pattern. Volume starting to confirm the move.`,
      `Interesting activity on $${sym}${mcapRef} — whale distribution combined with retail inflow. The ${params.patternName} signal is hitting on all cylinders. Early movers are positioning before the breakout.`,
      `$${sym} just triggered ${params.patternName}${mcapRef}. Holder growth accelerating, real money wallets increasing, and top10 concentration declining. This setup has historically been bullish for pump fun tokens.`,
    ],
    EXIT: [
      `$${sym} showing classic exit signals. Smart money rotating out while retail is still holding. Volume declining and price momentum fading — distribution phase is likely underway.`,
      `The smart money is done with $${sym}. Top holders reducing positions, volume dropping off. Classic distribution pattern playing out.`,
    ],
    CAUTION: [
      `Mixed signals on $${sym}. Some metrics look bullish but concentration is raising flags. Not a clear entry or exit — watchlist material for now.`,
    ],
    DANGER: [
      `Red flags on $${sym} — unusual top holder movement suggesting potential dump setup. Multiple risk indicators firing simultaneously. Proceed with extreme caution.`,
    ],
    WAIT: [
      `$${sym} in consolidation mode. Metrics are flat across the board — no clear direction yet. Waiting for volume or holder momentum to pick a side.`,
    ],
  };

  const arr = templates[params.action] ?? [
    `$${sym} detected via ${params.patternName}${mcapRef} — monitoring for further confirmation.`,
  ];
  // Pick a pseudo-random template based on symbol hash
  const hash = sym.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return arr[hash % arr.length];
}
