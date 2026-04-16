// OrchestratorEngine — pure detection logic, portable to worker process.
//
// Dual-feed discovery:
//   Feed 1: Ave pump scanner API (graduated tokens, max 24h old)
//   Feed 2: DB re-scan (tokens with ENTRY signals in last 24h)
//
// For each candidate (bounded concurrency):
//   - buildAveSnapshot (holder series + klines already incl. history)
//   - detectSignalFromSnapshot (classify 1..11)
//   - dedup check (in-memory, TTL-bound, per pattern)
//   - if non-trivial signal → persist Signal + SignalSnapshot + upsert Token
//
// Re-scan enables EXIT/DUMP detection on tokens that previously got ENTRY signals.

import { buildAveSnapshot, type AveSnapshot } from "@/lib/ave/snapshot";
import { getPumpTokens } from "@/lib/ave/internal";
import {
  detectSignalFromSnapshot,
  type DetectedSignal,
} from "@/lib/signals/detector";
import { prisma } from "@/lib/db/client";
import { MemoryDedup, signalDedupKey, type DedupStore } from "./dedup";
import { pushOrchestratorLine } from "./terminal";
import {
  researchTokenNarrative,
  type TweetData,
} from "@/lib/twitter/research";
import { sendSignalAlert } from "@/lib/telegram/notify";

export interface OrchestratorConfig {
  intervalMs: number;            // base cycle interval (default 3min)
  sources: Array<"graduated" | "new">;
  limitPerSource: number;        // top N per source
  concurrency: number;           // parallel snapshot fetches
  dedupTtlMs: number;            // skip same pattern within this window
  persistNoSignal: boolean;      // if true persist pattern #9 for audit
  holderInterval: "1m" | "5m" | "1h" | "4h";
  rescanEntryTtlMs: number;     // re-scan tokens with ENTRY signals within this window
  maxTokenAgeMs: number;         // skip tokens older than this (0 = no limit)
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  intervalMs: 3 * 60 * 1000,
  sources: ["graduated"],
  limitPerSource: 20,
  concurrency: 4,
  dedupTtlMs: 10 * 60 * 1000,
  persistNoSignal: false,
  // 1m sampling + detector lookback=5 = compares t vs t-5min,
  // matching the architecture.md "per 5 minutes" signal matrix.
  // Using 5m sampling would compare t vs t-25min which is wrong.
  holderInterval: "1m",
  rescanEntryTtlMs: 24 * 60 * 60 * 1000, // 24h
  maxTokenAgeMs: 24 * 60 * 60 * 1000,    // 24h
};

export interface CycleSignalSummary {
  mint: string;
  symbol: string | null;
  patternId: number;
  patternName: string;
  confidence: string;
  score: number;
  dedup: boolean;
  // Extended fields for live signal feed (in-memory, no DB roundtrip).
  detectedAt: number; // unix ms — moment processOne captured this signal
  dimension: string; // primary dominant dimension
  dimensionsNormalized: {
    holderGrowth: number;
    top10Concentration: number;
    realMoney: number;
    volume: number;
    price: number;
  };
  discoverySource: string; // graduated | rescan
  logoUrl: string | null;
  // Newbie-friendly fields (surfaced on dashboard)
  action: string;      // ENTRY | EXIT | WAIT | CAUTION | DANGER | NO_SIGNAL
  reasoning: string;   // e.g. "holders SPIKE +52% | top10 down -1.6% | ..."
  priceUsd: number;    // latest candle close price
  mcapUsd: number;     // total_supply * price
}

export interface CycleResult {
  id: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  sources: string[];
  candidates: number;
  scanned: number;
  detected: number;
  persisted: number;
  dedupSkipped: number;
  errors: Array<{ mint: string; message: string }>;
  signals: CycleSignalSummary[];
}

interface CandidateToken {
  mint: string;
  symbol: string | null;
  name: string | null;
  source: string;
}

let cycleCounter = 0;

export class OrchestratorEngine {
  readonly config: OrchestratorConfig;
  readonly dedup: DedupStore;

  constructor(
    config: Partial<OrchestratorConfig> = {},
    dedup: DedupStore = new MemoryDedup(),
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dedup = dedup;
  }

  async runCycle(): Promise<CycleResult> {
    const id = `cyc-${++cycleCounter}-${Date.now()}`;
    const startedAt = Date.now();

    pushOrchestratorLine(
      "system",
      `scan cycle #${cycleCounter} · sources=${this.config.sources.join("+")}+rescan`,
      { cycleId: id },
    );

    // 1. Discover candidates
    const candidates = await this.discover();
    pushOrchestratorLine(
      "info",
      `fetched ${candidates.length} candidates`,
      { cycleId: id, candidates: candidates.length },
    );

    // 2. Concurrent detection
    const result: CycleResult = {
      id,
      startedAt,
      finishedAt: 0,
      durationMs: 0,
      sources: this.config.sources,
      candidates: candidates.length,
      scanned: 0,
      detected: 0,
      persisted: 0,
      dedupSkipped: 0,
      errors: [],
      signals: [],
    };

    await this.processConcurrent(candidates, id, result);

    result.finishedAt = Date.now();
    result.durationMs = result.finishedAt - result.startedAt;

    pushOrchestratorLine(
      "system",
      `cycle done · ${result.scanned} scanned · ${result.detected} signals · ${result.persisted} persisted · ${(result.durationMs / 1000).toFixed(1)}s`,
      { cycleId: id },
    );

    return result;
  }

  private async discover(): Promise<CandidateToken[]> {
    const byMint = new Map<string, CandidateToken>();

    // Feed 1: Ave API (graduated tokens from pump scanner)
    await this.discoverFromAve(byMint);

    // Feed 2: DB re-scan (tokens with ENTRY signals in last rescanEntryTtlMs)
    await this.discoverActiveEntries(byMint);

    return Array.from(byMint.values());
  }

  /** Feed 1: Discover from Ave pump scanner API. */
  private async discoverFromAve(
    byMint: Map<string, CandidateToken>,
  ): Promise<void> {
    for (const source of this.config.sources) {
      try {
        const tokens = await getPumpTokens(source, {
          limit: this.config.limitPerSource,
          platforms: "pump,moonshot",
        });
        for (const t of tokens) {
          const row = t as Record<string, unknown>;
          const mint =
            (row.target_token as string | undefined) ??
            (row.token0_address as string | undefined) ??
            null;
          if (!mint) continue;
          if (byMint.has(mint)) continue;
          byMint.set(mint, {
            mint,
            symbol:
              (row.token0_symbol as string | undefined) ??
              (row.symbol as string | undefined) ??
              null,
            name:
              (row.token0_name as string | undefined) ??
              (row.name as string | undefined) ??
              null,
            source,
          });
        }
      } catch (err) {
        pushOrchestratorLine(
          "error",
          `discover ${source} failed: ${String(err).slice(0, 140)}`,
        );
      }
    }

    // Filter tokens older than maxTokenAgeMs (skip brand-new tokens not yet in DB)
    if (this.config.maxTokenAgeMs > 0 && byMint.size > 0) {
      try {
        const mints = [...byMint.keys()];
        const known = await prisma.token.findMany({
          where: { mint: { in: mints } },
          select: { mint: true, firstSeenAt: true },
        });
        const now = Date.now();
        for (const t of known) {
          if (now - t.firstSeenAt.getTime() > this.config.maxTokenAgeMs) {
            byMint.delete(t.mint);
          }
        }
      } catch {
        // non-critical — if DB lookup fails, keep all candidates
      }
    }
  }

  /** Feed 2: Re-scan tokens that had ENTRY signals recently (dual-feed). */
  private async discoverActiveEntries(
    byMint: Map<string, CandidateToken>,
  ): Promise<void> {
    if (this.config.rescanEntryTtlMs <= 0) return;

    try {
      const cutoff = new Date(Date.now() - this.config.rescanEntryTtlMs);
      const ageCutoff = this.config.maxTokenAgeMs > 0
        ? new Date(Date.now() - this.config.maxTokenAgeMs)
        : undefined;

      const signals = await prisma.signal.findMany({
        where: {
          patternId: { in: [1, 7, 11] }, // ENTRY patterns
          detectedAt: { gte: cutoff },
          ...(ageCutoff
            ? { token: { firstSeenAt: { gte: ageCutoff } } }
            : {}),
        },
        select: {
          tokenMint: true,
          token: { select: { symbol: true, name: true } },
        },
        distinct: ["tokenMint"],
        orderBy: { detectedAt: "desc" },
      });

      let added = 0;
      for (const s of signals) {
        if (byMint.has(s.tokenMint)) continue; // Ave feed takes priority
        byMint.set(s.tokenMint, {
          mint: s.tokenMint,
          symbol: s.token.symbol,
          name: s.token.name,
          source: "rescan",
        });
        added++;
      }

      pushOrchestratorLine(
        "observe",
        `rescan feed: ${signals.length} ENTRY tokens found, ${added} added to queue`,
      );
    } catch (err) {
      pushOrchestratorLine(
        "error",
        `rescan feed failed: ${String(err).slice(0, 140)}`,
      );
    }
  }

  private async processConcurrent(
    candidates: CandidateToken[],
    cycleId: string,
    result: CycleResult,
  ): Promise<void> {
    const queue = [...candidates];
    const workers = Array.from({ length: this.config.concurrency }, () =>
      this.workerLoop(queue, cycleId, result),
    );
    await Promise.all(workers);
  }

  private async workerLoop(
    queue: CandidateToken[],
    cycleId: string,
    result: CycleResult,
  ): Promise<void> {
    while (queue.length > 0) {
      const cand = queue.shift();
      if (!cand) break;
      try {
        await this.processOne(cand, cycleId, result);
        result.scanned++;
      } catch (err) {
        result.errors.push({
          mint: cand.mint,
          message: err instanceof Error ? err.message : String(err),
        });
        pushOrchestratorLine(
          "warning",
          `${cand.symbol ?? cand.mint.slice(0, 6)} scan failed: ${String(err).slice(0, 100)}`,
        );
      }
    }
  }

  private async processOne(
    cand: CandidateToken,
    cycleId: string,
    result: CycleResult,
  ): Promise<void> {
    const short = cand.symbol ?? `${cand.mint.slice(0, 4)}…${cand.mint.slice(-4)}`;

    const snap = await buildAveSnapshot(cand.mint, {
      chain: "solana",
      holderInterval: this.config.holderInterval,
    });

    pushOrchestratorLine(
      "observe",
      `${short} · ${snap.holderSeries.length}pt · ${snap.klines.length}c · ${snap.metadata.collectionTimeMs}ms`,
    );

    const detected = detectSignalFromSnapshot(snap);
    const patternId = detected.signal.number;
    const confidence = detected.signal.confidence;

    // Skip "No Signal" persist by default — but log dimensions so the user
    // can see WHY a token didn't trigger a pattern.
    if (patternId === 9 && !this.config.persistNoSignal) {
      const d = detected.dimensionsNormalized;
      pushOrchestratorLine(
        "info",
        `${short} → flat | hg${fmtDim(d.holderGrowth)}% t10${fmtDim(d.top10Concentration)} a10${fmtDim(d.realMoney)} vol×${d.volume.toFixed(1)} pc${fmtDim(d.price)}%`,
      );
      return;
    }

    result.detected++;

    const sigSummary: CycleSignalSummary = {
      mint: cand.mint,
      symbol: snap.symbol ?? cand.symbol,
      patternId,
      patternName: detected.signal.name,
      confidence,
      score: detected.score,
      dedup: false,
      detectedAt: Date.now(),
      dimension: detected.dimension,
      dimensionsNormalized: detected.dimensionsNormalized,
      discoverySource: cand.source,
      logoUrl: snap.logoUrl ?? null,
      action: detected.signal.action,
      reasoning: detected.reasoning,
      priceUsd: detected.signal.priceUsd,
      mcapUsd: detected.signal.mcap,
    };

    // Dedup: skip same-pattern-within-window
    const key = signalDedupKey(cand.mint, patternId);
    if (await this.dedup.check(key)) {
      sigSummary.dedup = true;
      result.dedupSkipped++;
      result.signals.push(sigSummary);
      pushOrchestratorLine(
        "warning",
        `${short} → #${patternId} ${detected.signal.name} · ${confidence} · dedup skip`,
      );
      return;
    }

    // Mark dedup BEFORE persist to prevent race with concurrent workers
    await this.dedup.mark(key, this.config.dedupTtlMs);

    // Persist Signal + SignalSnapshot + Token upsert
    try {
      await this.persist(cand, snap, detected, cycleId);
      result.persisted++;
      result.signals.push(sigSummary);

      pushOrchestratorLine(
        "decide",
        `${short} → #${patternId} ${detected.signal.name} · ${confidence} · score ${detected.score.toFixed(2)}`,
        { cycleId, mint: cand.mint, patternId },
      );

      // Emit a signal-kind line with the dim fingerprint
      const d = detected.dimensionsNormalized;
      pushOrchestratorLine(
        "signal",
        `hld${fmtDim(d.holderGrowth)} top10${fmtDim(d.top10Concentration)} r$${fmtDim(d.realMoney)} vol${fmtDim(d.volume)} px${fmtDim(d.price)}`,
      );

      // ── Post-signal pipeline: Twitter research + Telegram notify ──
      // Both are best-effort; errors must not break the scan cycle.
      // Telegram only fires for ENTRY signals (#1, #7, #11).
      // Research is persisted to DB (unique per mint) — never re-researched.

      const isEntry = [1, 7, 11].includes(patternId);

      if (isEntry) {
        await this.runResearchPipeline({
          mint: cand.mint,
          symbol: snap.symbol ?? cand.symbol,
          short,
          patternId,
          patternName: detected.signal.name,
          confidence,
          score: detected.score,
          action: detected.signal.action,
          reasoning: detected.reasoning,
          priceUsd: detected.signal.priceUsd,
          mcapUsd: detected.signal.mcap,
          dimensions: detected.dimensionsNormalized,
          holderCount: snap.holderDelta?.holdersCountEnd ?? null,
        });
      }
    } catch (err) {
      result.errors.push({
        mint: cand.mint,
        message: `persist: ${err instanceof Error ? err.message : String(err)}`,
      });
      pushOrchestratorLine(
        "error",
        `${short} persist failed: ${String(err).slice(0, 120)}`,
      );
    }
  }

  // ── Research pipeline (shared by processOne + catchup) ──────────────
  // Checks DB first — if Research row exists for this mint, reuses it.
  // Otherwise runs xpoz + Claude, saves to DB, sends Telegram.

  private async runResearchPipeline(params: {
    mint: string;
    symbol: string | null;
    short: string;
    patternId: number;
    patternName: string;
    confidence: string;
    score: number;
    action: string;
    reasoning: string;
    priceUsd: number;
    mcapUsd: number;
    dimensions: {
      holderGrowth: number;
      top10Concentration: number;
      realMoney: number;
      volume: number;
      price: number;
    };
    holderCount: number | null;
    signalId?: string;
  }): Promise<void> {
    const { mint, short } = params;
    let narrative = "";
    let tweets: TweetData[] = [];
    let telegramSent = false;
    let source: "xpoz" | "ai" = "ai";

    // 1. Check DB — skip if already researched for this mint
    try {
      const existing = await prisma.research.findUnique({ where: { mint } });
      if (existing) {
        pushOrchestratorLine("info", `${short}: already researched, skip`);
        return;
      }
    } catch {
      // DB check failed — proceed with fresh research
    }

    // 2. Telegram notification — FIRST, no waiting for research
    try {
      telegramSent = await sendSignalAlert({
        symbol: params.symbol,
        mint,
        patternId: params.patternId,
        patternName: params.patternName,
        confidence: params.confidence,
        score: params.score,
        action: params.action,
        reasoning: params.reasoning,
        priceUsd: params.priceUsd,
        mcapUsd: params.mcapUsd,
        dimensions: params.dimensions,
        holderCount: params.holderCount,
      });
      if (telegramSent) {
        pushOrchestratorLine("telegram", `${short} alert sent`);
      }
    } catch (err) {
      pushOrchestratorLine(
        "warning",
        `telegram send failed: ${String(err).slice(0, 100)}`,
      );
    }

    // 3. Twitter research (xpoz real tweets + Claude narrative) — after TG
    try {
      pushOrchestratorLine("twitter", `researching $${short}…`);
      const research = await researchTokenNarrative({
        symbol: params.symbol,
        mint,
        patternName: params.patternName,
        action: params.action,
        priceUsd: params.priceUsd,
        mcapUsd: params.mcapUsd,
      });
      narrative = research.narrative;
      tweets = research.tweets;
      source = research.source;
      pushOrchestratorLine(
        "twitter",
        `${short}: ${narrative.slice(0, 160)}`,
      );
    } catch (err) {
      pushOrchestratorLine(
        "warning",
        `twitter research failed: ${String(err).slice(0, 100)}`,
      );
    }

    // 4. Persist to DB (unique per mint — upsert to be safe)
    try {
      await prisma.research.upsert({
        where: { mint },
        update: {
          narrative,
          tweets: tweets as unknown as object,
          source,
          telegramSent,
        },
        create: {
          mint,
          symbol: params.symbol,
          signalId: params.signalId ?? null,
          patternId: params.patternId,
          patternName: params.patternName,
          action: params.action,
          score: params.score,
          confidence: params.confidence,
          narrative,
          tweets: tweets as unknown as object,
          source,
          priceUsd: params.priceUsd,
          mcapUsd: params.mcapUsd,
          reasoning: params.reasoning,
          dimensions: params.dimensions as unknown as object,
          holderCount: params.holderCount,
          telegramSent,
        },
      });
    } catch (err) {
      pushOrchestratorLine(
        "warning",
        `research persist failed: ${String(err).slice(0, 100)}`,
      );
    }

    // 5. Emit research card for the live terminal feed
    this.emitResearchCard(params, narrative, tweets, telegramSent);
  }

  private emitResearchCard(
    params: {
      mint: string;
      symbol: string | null;
      patternId: number;
      patternName: string;
      confidence: string;
      score: number;
      action: string;
      reasoning: string;
      priceUsd: number;
      mcapUsd: number;
      dimensions: {
        holderGrowth: number;
        top10Concentration: number;
        realMoney: number;
        volume: number;
        price: number;
      };
      holderCount: number | null;
      short: string;
    },
    narrative: string,
    tweets: TweetData[],
    telegramSent: boolean,
  ): void {
    pushOrchestratorLine("research", `$${params.short} — ${params.patternName}`, {
      type: "signal_research",
      mint: params.mint,
      symbol: params.symbol,
      patternId: params.patternId,
      patternName: params.patternName,
      confidence: params.confidence,
      score: params.score,
      action: params.action,
      reasoning: params.reasoning,
      priceUsd: params.priceUsd,
      mcapUsd: params.mcapUsd,
      dimensions: params.dimensions,
      holderCount: params.holderCount,
      narrative,
      tweets,
      telegramSent,
    });
  }

  // ── Startup catchup ──────────────────────────────────────────────────
  // On server restart, reload persisted Research records into the terminal
  // buffer so cards appear immediately.  Also process any ENTRY signals
  // that were never researched (e.g. detected before code existed).

  async catchupRecentEntries(lookbackMs = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      // Phase 1: Reload persisted Research records into the terminal buffer
      // so cards appear immediately on page load after a restart.
      const cutoff = new Date(Date.now() - lookbackMs);
      const existing = await prisma.research.findMany({
        where: { createdAt: { gte: cutoff } },
        orderBy: { createdAt: "asc" },
      });

      if (existing.length > 0) {
        pushOrchestratorLine(
          "system",
          `loaded ${existing.length} research records from DB`,
        );
        for (const r of existing) {
          const short = r.symbol ?? r.mint.slice(0, 6);
          this.emitResearchCard(
            {
              mint: r.mint,
              symbol: r.symbol,
              short,
              patternId: r.patternId ?? 0,
              patternName: r.patternName ?? "Unknown",
              confidence: r.confidence ?? "MED",
              score: r.score ?? 0,
              action: r.action ?? "ENTRY",
              reasoning: r.reasoning ?? "",
              priceUsd: r.priceUsd ?? 0,
              mcapUsd: r.mcapUsd ?? 0,
              dimensions: (r.dimensions as {
                holderGrowth: number;
                top10Concentration: number;
                realMoney: number;
                volume: number;
                price: number;
              }) ?? { holderGrowth: 0, top10Concentration: 0, realMoney: 0, volume: 0, price: 0 },
              holderCount: r.holderCount,
            },
            r.narrative,
            (r.tweets ?? []) as unknown as TweetData[],
            r.telegramSent,
          );
        }
      }

      // Phase 2: Find ENTRY signals that don't have a Research record yet
      const signals = await prisma.signal.findMany({
        where: {
          patternId: { in: [1, 7, 11] },
          detectedAt: { gte: cutoff },
        },
        include: {
          token: { select: { symbol: true, name: true, mint: true } },
          snapshot: true,
        },
        orderBy: { detectedAt: "asc" },
      });

      // Only process signals whose mint has no Research row, deduplicated by mint
      const researchedMints = new Set(existing.map((r) => r.mint));
      const seenMints = new Set<string>();
      const unresearched = signals.filter((s) => {
        if (researchedMints.has(s.tokenMint)) return false;
        if (seenMints.has(s.tokenMint)) return false;
        seenMints.add(s.tokenMint);
        return true;
      });

      if (unresearched.length === 0) return;

      pushOrchestratorLine(
        "system",
        `catchup: ${unresearched.length} ENTRY signals need research`,
      );

      for (const sig of unresearched) {
        const meta = sig.meta as Record<string, unknown>;
        const sigData = meta.signal as Record<string, unknown> | undefined;
        const dims = meta.dimensionsNormalized as {
          holderGrowth: number;
          top10Concentration: number;
          realMoney: number;
          volume: number;
          price: number;
        } | undefined;

        const short = sig.token.symbol ?? sig.tokenMint.slice(0, 6);
        const action = (sigData?.action as string) ?? "ENTRY";
        const priceUsd = (sigData?.priceUsd as number) ?? sig.snapshot?.priceUsd ?? 0;
        const mcapUsd = (sigData?.mcap as number) ?? sig.snapshot?.mcapUsd ?? 0;

        await this.runResearchPipeline({
          mint: sig.tokenMint,
          symbol: sig.token.symbol,
          short,
          patternId: sig.patternId,
          patternName: sig.patternName,
          confidence: sig.confidence,
          score: sig.score,
          action,
          reasoning: (meta.reasoning as string) ?? "",
          priceUsd,
          mcapUsd,
          dimensions: dims ?? { holderGrowth: 0, top10Concentration: 0, realMoney: 0, volume: 0, price: 0 },
          holderCount: sig.snapshot?.holderCount ?? null,
          signalId: sig.id,
        });

        // Mark signal as notified
        try {
          await prisma.signal.update({
            where: { id: sig.id },
            data: { meta: { ...meta, notified: true } },
          });
        } catch { /* non-critical */ }
      }

      pushOrchestratorLine(
        "system",
        `catchup done: ${unresearched.length} signals processed`,
      );
    } catch (err) {
      pushOrchestratorLine(
        "warning",
        `catchup failed: ${String(err).slice(0, 140)}`,
      );
    }
  }

  private async persist(
    cand: CandidateToken,
    snap: AveSnapshot,
    detected: DetectedSignal,
    cycleId: string,
  ): Promise<void> {
    // 1. Upsert token
    // Only set graduated=true explicitly; rescan source should not overwrite
    const isGraduated = cand.source === "graduated" ? true : undefined;
    await prisma.token.upsert({
      where: { mint: cand.mint },
      update: {
        lastScannedAt: new Date(),
        symbol: snap.symbol ?? cand.symbol ?? undefined,
        name: snap.name ?? cand.name ?? undefined,
        decimals: snap.decimals ?? undefined,
        riskScore: snap.risk?.riskScore ?? null,
        ...(isGraduated !== undefined ? { graduated: isGraduated } : {}),
        logoUrl: snap.logoUrl ?? undefined,
      },
      create: {
        mint: cand.mint,
        symbol: snap.symbol ?? cand.symbol,
        name: snap.name ?? cand.name,
        decimals: snap.decimals ?? 9,
        riskScore: snap.risk?.riskScore ?? null,
        graduated: isGraduated ?? false,
        logoUrl: snap.logoUrl ?? null,
      },
    });

    // 2. Create Signal row
    const signalRow = await prisma.signal.create({
      data: {
        tokenMint: cand.mint,
        patternId: detected.signal.number,
        patternName: detected.signal.name,
        dimension: detected.dimension,
        confidence: detected.signal.confidence,
        score: detected.score,
        source: "orchestrator",
        cycleId,
        meta: {
          reasoning: detected.reasoning,
          dimensionsNormalized: detected.dimensionsNormalized,
          signal: detected.signal,
          discoverySource: cand.source,
          notified: [1, 7, 11].includes(detected.signal.number),
        } as object,
      },
    });

    // 3. Create slim SignalSnapshot for backtest
    const latestCandle = snap.klines.at(-1);
    const price = latestCandle?.c ?? 0;
    const mcap =
      snap.totalSupply && latestCandle?.c
        ? snap.totalSupply * latestCandle.c
        : null;

    await prisma.signalSnapshot.create({
      data: {
        signalId: signalRow.id,
        dimHolderGrowth: detected.dimensionsNormalized.holderGrowth,
        dimTop10Delta: detected.dimensionsNormalized.top10Concentration,
        dimRealMoney: detected.dimensionsNormalized.realMoney,
        dimVolumeMultiple: detected.dimensionsNormalized.volume,
        dimPriceChange: detected.dimensionsNormalized.price,
        priceUsd: price,
        mcapUsd: mcap,
        holderCount: snap.holderDelta?.holdersCountEnd ?? null,
        top10Ratio: snap.holderDelta?.top10RatioEnd ?? null,
        holdersGt10: snap.holderDelta?.holdersAbove10End ?? null,
      },
    });
  }
}

function fmtDim(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}
