// Claude reasoning engine — analyzes an AveSnapshot + DetectedSignal and
// produces a structured AgentDecision JSON.

import Anthropic from "@anthropic-ai/sdk";
import { getAgentSystemPrompt } from "./prompts";
import type { AveSnapshot } from "@/lib/ave/snapshot";
import type { DetectedSignal } from "@/lib/signals/detector";
import type { AgentDecision, AgentAction, AgentActionType } from "@/lib/types";

const client = new Anthropic({
  apiKey: process.env.AVE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL
    ? process.env.ANTHROPIC_BASE_URL.replace(/\/v1$/, "")
    : "https://api.anthropic.com",
});

function formatSnapshotForClaude(
  snapshot: AveSnapshot,
  signal: DetectedSignal | null,
  previousDecision?: AgentDecision,
): string {
  const lines: string[] = [];

  lines.push(
    `## Token Snapshot (${new Date(snapshot.timestamp * 1000).toISOString()})`,
  );
  lines.push(`Chain: ${snapshot.chain}`);
  lines.push(
    `Token: ${snapshot.symbol ?? "unknown"} (${snapshot.name ?? "?"})`,
  );
  lines.push(`Mint: ${snapshot.token}`);
  if (snapshot.primaryPairId) lines.push(`Pair: ${snapshot.primaryPairId}`);
  lines.push("");

  lines.push("### Price / Volume");
  lines.push(`Latest price: $${snapshot.latestPriceUsd}`);
  lines.push(`Price change: ${snapshot.priceChangePct.toFixed(2)}%`);
  lines.push(`1h avg volume: ${snapshot.volume1hAvg.toFixed(2)}`);
  const latestMcap = snapshot.mcapSeries.at(-1)?.mcap_close;
  if (latestMcap) lines.push(`Market cap: $${latestMcap.toFixed(0)}`);
  lines.push("");

  if (snapshot.holderDelta) {
    lines.push("### Holder Delta");
    const d = snapshot.holderDelta;
    lines.push(
      `Window: ${d.window} samples, ${d.holdersCountStart} → ${d.holdersCountEnd} holders (${d.holderGrowthPct}%)`,
    );
    lines.push(
      `Top10 ratio: ${d.top10RatioStart.toFixed(2)} → ${d.top10RatioEnd.toFixed(2)} (Δ${d.top10RatioDelta.toFixed(2)})`,
    );
    lines.push(
      `>$10 holders: ${d.holdersAbove10Start} → ${d.holdersAbove10End} (Δ${d.holdersAbove10Delta})`,
    );
    lines.push("");
  }

  if (snapshot.risk) {
    lines.push("### Risk");
    lines.push(`Risk score: ${snapshot.risk.riskScore}/100`);
    lines.push(`Dev balance: ${snapshot.risk.devBalanceRatio}%`);
    lines.push(`Holders: ${snapshot.risk.holders}`);
    lines.push(`Migrated: ${snapshot.risk.migrated}`);
    lines.push("");
  }

  if (signal) {
    lines.push("### Detected Signal");
    lines.push(
      `#${signal.signal.number} ${signal.signal.name} — ${signal.signal.action} (${signal.signal.confidence} confidence)`,
    );
    lines.push(`Score: ${signal.score}/100`);
    lines.push(`Primary dimension: ${signal.dimension}`);
    lines.push(`Reasoning: ${signal.reasoning}`);
    lines.push("");
  }

  if (previousDecision) {
    lines.push("### Previous Decision");
    const prev = previousDecision.decision;
    lines.push(`Action: ${prev.action}, Confidence: ${prev.confidence}`);
    lines.push(`Summary: ${previousDecision.analysis.summary}`);
    lines.push("");
  }

  lines.push(
    "Analyze this state and respond ONLY with the JSON object matching the schema. No markdown, no code block.",
  );

  return lines.join("\n");
}

interface RawDecision {
  analysis?: {
    summary?: string;
    signalsDetected?: string[];
    risk_level?: string;
    [k: string]: unknown;
  };
  decision?: {
    action?: string;
    confidence?: number;
    urgency?: string;
    reasoning?: string;
  };
  actions?: Array<Record<string, unknown>>;
  user_message?: string;
}

function normalizeDecision(raw: RawDecision): AgentDecision {
  const summary = raw.analysis?.summary ?? "No summary provided.";
  const action = (raw.decision?.action ?? "hold") as AgentDecision["decision"]["action"];
  const confidence = raw.decision?.confidence ?? 0.5;
  const urgency = (raw.decision?.urgency ?? "none") as NonNullable<
    AgentDecision["decision"]["urgency"]
  >;
  const reasoning = raw.decision?.reasoning ?? "";

  const actions: AgentAction[] = (raw.actions ?? []).map((a) => ({
    type: ((a.type as string) ?? "none") as AgentActionType,
    tokenMint: (a.tokenMint as string | null) ?? null,
    symbol: (a.symbol as string | null) ?? null,
    amountSol: (a.amountSol as number | null) ?? null,
    slippageBps: (a.slippageBps as number | null) ?? null,
    reasoning: (a.reasoning as string | undefined) ?? "",
  }));

  return {
    analysis: {
      summary,
      signalsDetected: raw.analysis?.signalsDetected ?? [],
      risk_level: (raw.analysis?.risk_level ?? "medium") as
        | "low"
        | "medium"
        | "high",
    },
    decision: { action, confidence, urgency, reasoning },
    actions,
    user_message: raw.user_message ?? summary,
  };
}

export async function runReasoningEngine(
  snapshot: AveSnapshot,
  signal: DetectedSignal | null,
  previousDecision?: AgentDecision,
): Promise<AgentDecision> {
  const userMessage = formatSnapshotForClaude(snapshot, signal, previousDecision);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.messages.create as any)({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    thinking: { type: "enabled", budget_tokens: 5000 },
    temperature: 1,
    system: getAgentSystemPrompt(),
    messages: [{ role: "user", content: userMessage }],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thinkingBlock = response.content.find((b: any) => b.type === "thinking");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textBlock = response.content.find((b: any) => b.type === "text");
  const thinkingContent: string = thinkingBlock?.thinking ?? "";
  const text: string = textBlock?.text ?? "";

  // Parse JSON: handle code blocks or raw JSON
  let jsonStr = text.trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  try {
    JSON.parse(jsonStr);
  } catch {
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = text.substring(braceStart, braceEnd + 1);
    }
  }

  try {
    const raw = JSON.parse(jsonStr.trim()) as RawDecision;
    const decision = normalizeDecision(raw);
    if (thinkingContent) decision.thinking = thinkingContent;
    return decision;
  } catch {
    return {
      thinking: thinkingContent || undefined,
      analysis: {
        summary: "Failed to parse reasoning engine output. Holding.",
        risk_level: "low",
      },
      decision: {
        action: "hold",
        confidence: 0,
        urgency: "none",
        reasoning: `Raw output: ${text.substring(0, 500)}`,
      },
      actions: [],
      user_message: "Agent encountered a parsing issue this cycle. Standing by.",
    };
  }
}
