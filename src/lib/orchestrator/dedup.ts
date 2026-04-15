// Dedup store for the orchestrator — prevents duplicate signals within a TTL window.
//
// Interface-first so we can swap MemoryDedup → RedisDedup in Tier 2 without
// touching engine.ts.

export interface DedupStore {
  /** Return true if `key` is already marked (not expired) and we should skip. */
  check(key: string): Promise<boolean>;
  /** Mark `key` as seen with a TTL in milliseconds. */
  mark(key: string, ttlMs: number): Promise<void>;
  /** Number of currently tracked keys (for diagnostics). */
  size(): number;
  /** Clear everything (test/debug). */
  clear(): void;
}

/** In-memory TTL map. Sufficient for Tier 1 single-process. */
export class MemoryDedup implements DedupStore {
  private map = new Map<string, number>();

  async check(key: string): Promise<boolean> {
    const exp = this.map.get(key);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  async mark(key: string, ttlMs: number): Promise<void> {
    this.map.set(key, Date.now() + ttlMs);
    // Opportunistic cleanup: sweep every 100 marks so the map doesn't grow forever.
    if (this.map.size % 100 === 0) this.sweep();
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, exp] of this.map.entries()) {
      if (now > exp) this.map.delete(k);
    }
  }
}

/** Build the key a signal dedup entry uses. */
export function signalDedupKey(mint: string, patternId: number): string {
  return `sig:${mint}:${patternId}`;
}
