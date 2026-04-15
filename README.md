# Ave Talon

**Autonomous Solana Signal Agent — Ave/Claw Hackathon**

Ave Talon scans Solana tokens across 5 dimensions and detects 10 signal patterns in real-time, from strong entries to full dumps.

## What it does

Ave Talon runs a continuous autonomous loop:

```
SCAN → DETECT → RESEARCH → ALERT
```

1. **SCAN** — Fetches graduated pump.fun tokens from Ave API, builds snapshots (holder data, klines, volume)
2. **DETECT** — Classifies each token across 5 dimensions (holder growth, top10 concentration, real money, volume, price) into 10 signal patterns
3. **RESEARCH** — For ENTRY signals: searches Twitter/X via internal MCP for real tweets, generates AI narrative synthesis
4. **ALERT** — Persists research to DB, pushes to terminal feed, sends Telegram notifications

## Signal Matrix

| # | Pattern | Action | Description |
|---|---------|--------|-------------|
| 1 | Strong Entry | ENTRY | Whale distributing, price up, volume active |
| 11 | Early Entry | ENTRY | Quiet accumulation, moderate volume — pre-pump |
| 7 | Sneak Entry | ENTRY | Whale slow entry, holders stable — breakout potential |
| 2 | Wait (No Vol) | WAIT | Holders up but volume quiet |
| 3 | FOMO Pump | CAUTION | Price rising fast, retail FOMO |
| 4 | Shakeout | WAIT | Holders down but whales holding |
| 8 | Divergence | WAIT | Holders up, price down — mixed signals |
| 10 | Pump + Whale Load | CAUTION | Strong pump + whale loading |
| 5 | Whale Exit | EXIT | Whales exiting, high volume |
| 6 | Full Dump | DANGER | Everything dropping, whales exiting |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) |
| Chain Data | Ave API (internal + public) |
| Signal Detection | Custom 5-dim x 10-pattern classifier |
| Twitter Research | Internal MCP (real tweets) + AI narrative |
| Database | PostgreSQL via Prisma |
| Notifications | Telegram Bot API |
| UI | Tailwind CSS, Geist Mono |

## Architecture

```
src/
├── app/
│   ├── dashboard/         # Main dashboard
│   ├── terminal/          # AI research feed (card-based)
│   ├── chat/              # Chat interface with 22 tools
│   ├── api/               # REST endpoints
│   └── components/        # UI components
└── lib/
    ├── ave/               # Ave API client (snapshot, klines, holders)
    ├── signals/           # 5-dim signal detection + pattern classification
    ├── orchestrator/      # Autonomous scan loop (scheduler, engine, dedup)
    ├── twitter/           # Internal MCP client + narrative research
    ├── telegram/          # Alert notifications
    └── agent/             # AI reasoning engine + tools
```

## Quick Start

```bash
pnpm install

cp .env.local.example .env.local
# Fill in API keys

# Start PostgreSQL
docker compose up -d

# Run migrations
pnpm exec prisma migrate dev

# Start dev server
pnpm dev
```

## Features

- **Real-time signal detection** — 3-minute scan cycles, 5 dimensions, 10 patterns
- **Twitter research** — Real tweets via internal MCP with clickable @username links
- **AI narrative synthesis** — Generates crypto analyst-style summaries from signal + tweet data
- **Research persistence** — Unique per token (CA), survives server restarts
- **Terminal feed** — Card-based AI research feed with signal breakdowns
- **Telegram alerts** — Instant notifications for ENTRY signals
- **Observer-only** — No private keys, no trade execution, pure signal intelligence

## Built For

**Ave/Claw Hackathon** — autonomous signal detection agent built on Ave's on-chain data infrastructure.
