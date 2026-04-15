// Telegram Bot API integration — sends signal alerts to a Telegram channel.
// Uses plain fetch() against https://api.telegram.org, zero dependencies.
// Message format mimics professional trader channel posts.

const TG_API = "https://api.telegram.org";

function getBotToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

function getChatId(): string {
  return process.env.TELEGRAM_CHAT_ID ?? "";
}

// ── Auto-discover chat_id from /getUpdates ───���──────────────────────

let discoveredChatId: string | null = null;

async function discoverChatId(token: string): Promise<string | null> {
  if (discoveredChatId) return discoveredChatId;
  try {
    const res = await fetch(`${TG_API}/bot${token}/getUpdates?limit=10`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok: boolean;
      result: Array<{
        message?: { chat?: { id: number } };
        channel_post?: { chat?: { id: number } };
      }>;
    };
    const first = data.result?.[0];
    const chatId =
      first?.message?.chat?.id ?? first?.channel_post?.chat?.id;
    if (chatId) {
      discoveredChatId = String(chatId);
      return discoveredChatId;
    }
  } catch {
    // ignore
  }
  return null;
}

// ── Escape MarkdownV2 special chars ─────────────────────────────────

function esc(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ── Format helpers ──────────���───────────────────────────────────────

function fmtPrice(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.0001) return `$${v.toExponential(2)}`;
  if (v < 1) return `$${v.toPrecision(3)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtMcap(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtDim(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function dimStatus(v: number, threshold: number): string {
  return Math.abs(v) >= threshold ? "✓" : "·";
}

function fmtTime(): string {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}

// ── Action tier mapping ─────────────────────────────────────────────

function actionTier(action: string, confidence: string): string {
  if (action === "ENTRY" && confidence === "HIGH") return "TIER 1";
  if (action === "ENTRY") return "TIER 2";
  if (action === "EXIT") return "EXIT";
  if (action === "DANGER") return "DANGER";
  if (action === "CAUTION") return "CAUTION";
  return "WATCH";
}

// ─�� Main export ───────────────────────────��─────────────────────────

export interface SignalAlertParams {
  symbol: string | null;
  mint: string;
  patternId: number;
  patternName: string;
  confidence: string;
  score: number;
  action: string;
  reasoning: string;
  priceUsd: number;
  mcapUsd: number;
  narrative?: string;
  dimensions?: {
    holderGrowth: number;
    top10Concentration: number;
    realMoney: number;
    volume: number;
    price: number;
  };
  holderCount?: number | null;
}

export async function sendSignalAlert(
  signal: SignalAlertParams,
): Promise<boolean> {
  const token = getBotToken();
  if (!token) return false;

  let chatId = getChatId();
  if (!chatId) {
    chatId = (await discoverChatId(token)) ?? "";
  }
  if (!chatId) return false;

  const sym = signal.symbol ?? signal.mint.slice(0, 6);
  const tier = actionTier(signal.action, signal.confidence);
  const time = fmtTime();
  const dm = signal.dimensions;

  // ── Build message in channel-post style ───────────────────────────

  const lines: string[] = [];

  // Header: TIER │ Confidence
  lines.push(
    `*${esc(tier)}* │ ${esc(signal.confidence)}`,
  );
  lines.push(
    `${esc(signal.action)}: ${esc(time)} @ ${esc(fmtPrice(signal.priceUsd))}`,
  );
  lines.push(``);

  // Token name + mint
  lines.push(`*$${esc(sym)}*`);
  lines.push(`\`${signal.mint}\``);
  lines.push(``);

  // Signal matrix with tree chars
  lines.push(`*Signal Matrix*`);
  if (dm) {
    lines.push(
      `├ Holders    ${esc(fmtDim(dm.holderGrowth))} ${esc(dimStatus(dm.holderGrowth, 0.3))}`,
    );
    lines.push(
      `├ Top10      ${esc(fmtDim(dm.top10Concentration))} ${esc(dimStatus(dm.top10Concentration, 0.2))}`,
    );
    lines.push(
      `├ Real \\$     ${esc(fmtDim(dm.realMoney))} ${esc(dimStatus(dm.realMoney, 0.3))}`,
    );
    lines.push(
      `├ Volume     ${esc(fmtDim(dm.volume))} ${esc(dimStatus(dm.volume, 0.5))}`,
    );
    lines.push(
      `└ Price      ${esc(fmtDim(dm.price))} ${esc(dimStatus(dm.price, 0.3))}`,
    );
  } else {
    // Fallback: use reasoning text
    lines.push(`└ ${esc(signal.reasoning.slice(0, 120))}`);
  }
  lines.push(``);

  // Stats line
  const statParts: string[] = [];
  statParts.push(`MCap ${fmtMcap(signal.mcapUsd)}`);
  statParts.push(`Score ${signal.score.toFixed(1)}`);
  if (signal.holderCount) {
    statParts.push(`Holders ${signal.holderCount.toLocaleString("en-US")}`);
  }
  lines.push(esc(statParts.join(" │ ")));
  lines.push(`\\#${esc(String(signal.patternId))} ${esc(signal.patternName)}`);

  // Narrative (Twitter research)
  if (signal.narrative) {
    lines.push(``);
    lines.push(esc(signal.narrative.slice(0, 280)));
  }

  // Link
  lines.push(``);
  lines.push(
    `[View on AVE](http://72\\.61\\.209\\.138:8000/token/${signal.mint})`,
  );

  const text = lines.join("\n");

  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[telegram] sendMessage failed:", res.status, err);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] sendMessage error:", err);
    return false;
  }
}
