// Ave WebSocket stream (wss://mayeas023.com/ws) — pricev2 subscription.
//
// Server-side usage: spawn a long-lived WS via `ws` package.
// Browser-side usage: instantiate WebSocket directly with NEXT_PUBLIC_AVE_WS_URL.
//
// For MVP we do a light, restart-on-error subscription; upgrade to persistent
// reconnecting client once we pipe events into Postgres.

import { AVE_WS_URL } from "./config";

export interface AveWsPriceEvent {
  type?: string;
  token?: string;
  pair?: string;
  price?: number;
  mcap?: number;
  volume?: number;
  t?: number;
  [k: string]: unknown;
}

export type AveWsHandler = (ev: AveWsPriceEvent) => void;

/**
 * Start a server-side WS subscription to Ave pricev2 stream.
 * Returns a stop() function. Auto-reconnects on close up to `maxRetries`.
 */
export async function startAveWs(opts: {
  tokens?: string[];       // mints to subscribe to
  chain?: string;
  onMessage: AveWsHandler;
  onError?: (err: unknown) => void;
  maxRetries?: number;
}): Promise<() => void> {
  // Dynamic import keeps `ws` out of the browser bundle.
  const { default: WebSocket } = await import("ws");

  let ws: InstanceType<typeof WebSocket> | null = null;
  let stopped = false;
  let retries = 0;
  const maxRetries = opts.maxRetries ?? 10;

  function connect() {
    if (stopped) return;
    ws = new WebSocket(AVE_WS_URL, {
      headers: {
        Origin: "https://ave.ai",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      },
    });

    ws.on("open", () => {
      retries = 0;
      // Subscribe to each token if provided
      if (opts.tokens && opts.tokens.length > 0 && ws) {
        for (const mint of opts.tokens) {
          const msg = {
            type: "subscribe",
            channel: "pricev2",
            token: mint,
            chain: opts.chain ?? "solana",
          };
          ws.send(JSON.stringify(msg));
        }
      }
    });

    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        opts.onMessage(parsed);
      } catch (err) {
        opts.onError?.(err);
      }
    });

    ws.on("error", (err) => {
      opts.onError?.(err);
    });

    ws.on("close", () => {
      if (!stopped && retries < maxRetries) {
        retries++;
        const delay = Math.min(30_000, 1000 * 2 ** retries);
        setTimeout(connect, delay);
      }
    });
  }

  connect();

  return () => {
    stopped = true;
    try {
      ws?.close();
    } catch {
      /* noop */
    }
  };
}
