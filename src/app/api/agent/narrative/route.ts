// GET /api/agent/narrative — AI-generated market narrative.
// Summarizes the last N signals + scan activity into a 2-3 sentence
// report for the dashboard. Cached in-memory for 5 minutes.
//
// If API key is missing / invalid, falls back to a deterministic
// template so the dashboard never shows a blank card.

import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedNarrative {
  text: string;
  generatedAt: number;
  stats: NarrativeStats;
  source: "ai" | "fallback";
}

interface NarrativeStats {
  signals24h: number;
  highConf24h: number;
  topPattern: { name: string; count: number } | null;
  dominantDimension: { name: string; avg: number } | null;
  topToken: { mint: string; symbol: string | null; score: number; pattern: string } | null;
  scannedTokens: number;
}

let cache: CachedNarrative | null = null;

export async function GET() {
  // Serve cached response if fresh
  if (cache && Date.now() - cache.generatedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      ...cache,
      cached: true,
      ageMs: Date.now() - cache.generatedAt,
    });
  }

  const stats = await collectStats();

  const text = await generateNarrative(stats).catch(() => null);
  const narrative: CachedNarrative = text
    ? { text, generatedAt: Date.now(), stats, source: "ai" }
    : { text: buildFallback(stats), generatedAt: Date.now(), stats, source: "fallback" };

  cache = narrative;

  return NextResponse.json({ ...narrative, cached: false, ageMs: 0 });
}

async function collectStats(): Promise<NarrativeStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [signals, scanCount] = await Promise.all([
    prisma.signal.findMany({
      where: { detectedAt: { gte: since } },
      orderBy: { detectedAt: "desc" },
      take: 100,
      include: { token: true },
    }),
    prisma.scanResult.count({ where: { scannedAt: { gte: since } } }),
  ]);

  const highConf24h = signals.filter((s) => s.confidence === "HIGH").length;

  // top pattern by count (excluding #9 No Signal)
  const patternCounts = new Map<string, number>();
  for (const s of signals) {
    if (s.patternId === 9) continue;
    patternCounts.set(s.patternName, (patternCounts.get(s.patternName) ?? 0) + 1);
  }
  const topPattern = [...patternCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([name, count]) => ({ name, count }))[0] ?? null;

  // dominant dimension — avg abs(normalized) across all signals
  const dimSums: Record<string, { sum: number; n: number }> = {
    holderGrowth: { sum: 0, n: 0 },
    top10Concentration: { sum: 0, n: 0 },
    realMoney: { sum: 0, n: 0 },
    volume: { sum: 0, n: 0 },
    price: { sum: 0, n: 0 },
  };
  for (const s of signals) {
    const meta = s.meta as { dimensionsNormalized?: Record<string, number> } | null;
    const d = meta?.dimensionsNormalized;
    if (!d) continue;
    for (const key of Object.keys(dimSums)) {
      const v = d[key];
      if (typeof v === "number") {
        dimSums[key].sum += Math.abs(v);
        dimSums[key].n += 1;
      }
    }
  }
  const dominantDimension = Object.entries(dimSums)
    .map(([name, { sum, n }]) => ({ name, avg: n > 0 ? sum / n : 0 }))
    .sort((a, b) => b.avg - a.avg)[0];

  // top token by score × confidence weight, excluding #9
  const CONF_W: Record<string, number> = { HIGH: 1, MED: 0.7, LOW: 0.4, NONE: 0.15 };
  const ranked = signals
    .filter((s) => s.patternId !== 9)
    .map((s) => ({
      mint: s.tokenMint,
      symbol: s.token?.symbol ?? null,
      score: s.score * (CONF_W[s.confidence] ?? 0.3),
      pattern: s.patternName,
    }))
    .sort((a, b) => b.score - a.score);
  const topToken = ranked[0] ?? null;

  return {
    signals24h: signals.length,
    highConf24h,
    topPattern,
    dominantDimension: dominantDimension && dominantDimension.avg > 0 ? dominantDimension : null,
    topToken,
    scannedTokens: scanCount,
  };
}

async function generateNarrative(stats: NarrativeStats): Promise<string> {
  const apiKey = process.env.AVE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("AI API key missing");
  }

  const anthropic = createAnthropic({
    baseURL: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    apiKey,
  });

  const prompt = `You are Ave Talon, a Solana trading signal agent. Write a concise 2-3 sentence market narrative for the dashboard, based on the telemetry below. Do NOT hallucinate token names or numbers not in the telemetry. Use terse, professional trader voice. No emojis. No headings. One short paragraph. English only.

Telemetry (last 24h):
- Signals detected: ${stats.signals24h} (${stats.highConf24h} HIGH confidence)
- Tokens scanned: ${stats.scannedTokens}
- Top pattern: ${stats.topPattern ? `${stats.topPattern.name} (${stats.topPattern.count}x)` : "none"}
- Dominant dimension: ${stats.dominantDimension ? `${stats.dominantDimension.name} (avg ${stats.dominantDimension.avg.toFixed(2)})` : "balanced"}
- Top-ranked token: ${stats.topToken ? `${stats.topToken.symbol ?? stats.topToken.mint.slice(0, 6)} via ${stats.topToken.pattern} (score ${stats.topToken.score.toFixed(1)})` : "none"}

Example voice:
"In the last hour agent scanned 142 graduated tokens. 3 triggered HoTP MED, 1 triggered Full Dump HIGH. Dominant dimension real_money (+0.67). Most prominent token $LUCAS score 8.4 — holders up 41% in 20 minutes."

Now write the narrative:`;

  const { text } = await generateText({
    model: anthropic("claude-opus-4-6"),
    prompt,
    maxOutputTokens: 180,
    temperature: 0.6,
  });

  return text.trim();
}

function buildFallback(stats: NarrativeStats): string {
  const parts: string[] = [];

  parts.push(
    `Agent tracked ${stats.signals24h} signal${stats.signals24h === 1 ? "" : "s"} across ${stats.scannedTokens} tokens in the last 24h.`,
  );

  if (stats.highConf24h > 0) {
    parts.push(`${stats.highConf24h} of them HIGH confidence.`);
  } else {
    parts.push(`No HIGH-conf alerts — market condition flat.`);
  }

  if (stats.topPattern) {
    parts.push(`Dominant pattern: ${stats.topPattern.name} (${stats.topPattern.count}x).`);
  }

  if (stats.dominantDimension) {
    parts.push(
      `Driving dimension: ${stats.dominantDimension.name} (avg ${stats.dominantDimension.avg.toFixed(2)}).`,
    );
  }

  if (stats.topToken) {
    const label = stats.topToken.symbol ?? stats.topToken.mint.slice(0, 6);
    parts.push(`Top-ranked: ${label} via ${stats.topToken.pattern}.`);
  }

  return parts.join(" ");
}
