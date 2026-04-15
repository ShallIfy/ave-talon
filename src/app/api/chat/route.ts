// POST /api/chat — Claude Sonnet 4.6 chat with AVE AI 22-tool set.

import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { buildAveTools } from "@/lib/agent/tools";
import { getChatSystemPrompt } from "@/lib/agent/prompts";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const rawMessages = (body.messages ?? []) as Array<Record<string, unknown>>;
  const walletAddress = (body.walletAddress as string | undefined) ?? "";

  // Convert UI messages to model messages, preserving tool call/result context
  // for multi-turn conversations.
  let messages;
  try {
    messages = await convertToModelMessages(
      rawMessages as Parameters<typeof convertToModelMessages>[0],
    );
  } catch {
    // Fallback: extract text only (for simple messages or incompatible formats)
    messages = rawMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        (m.parts as Array<{ type: string; text?: string }> | undefined)
          ?.filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("") ??
        (m.content as string) ??
        "",
    }));
  }

  const anthropic = createAnthropic({
    baseURL: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    apiKey: process.env.AVE_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY,
  });

  const systemPrompt = `${getChatSystemPrompt()}

## Tool Usage Rules

1. ALWAYS call tools for factual claims about tokens (prices, holders, mcap, signals). NEVER answer from memory.
2. For "is this token healthy?" → call \`signal_detect\` and summarize the result.
3. For "scan for X" → call \`scanner_trending\` or \`scanner_filter\`.
4. For "compare token A vs B" → call \`signal_compare\`.
5. For propose-trade requests → call \`trade_propose\` and return the unsigned tx; explain the user signs in Phantom.
6. If a tool errors, explain the error and suggest one alternative. DO NOT retry the same failing tool more than once.
7. Wallet address is ${walletAddress || "(not connected)"}. If a tool needs a wallet and none is set, tell the user to connect Phantom.

## Response Style

- Lead with numbers: price, mcap, holder delta, signal score.
- Use tables or bullet lists for multi-token comparisons.
- Always cite which signal pattern (#1..#10) was detected when surfacing a trading decision.
- Keep responses tight. The user wants data, not essays.`;

  const tools = buildAveTools(walletAddress);

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: systemPrompt,
    messages,
    tools,
    maxOutputTokens: 16000,
    stopWhen: stepCountIs(15),
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
      },
    },
  });

  return result.toUIMessageStreamResponse();
}
