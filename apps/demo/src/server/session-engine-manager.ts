import { createEngine, createInMemoryStore, type Engine } from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';

export interface SessionEngineManagerOptions {
  readonly maxSessions: number;
  readonly idleTtlMs: number;
  readonly systemRules: string;
  readonly createAdapter: (apiKey: string) => AnyTextAdapter;
}

interface SessionEntry {
  engine: Engine;
  lastUsedAt: number;
  ttlTimer: ReturnType<typeof setTimeout>;
}

/**
 * Redacts an apiKey out of an error's message so it can never reach a log
 * line or a wire error payload — key custody is a hosted-mode invariant,
 * not just a nicety.
 */
function redact(err: unknown, apiKey: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const safeMessage = message.split(apiKey).join('[redacted]');
  return new Error(safeMessage);
}

export class SessionEngineManager {
  readonly #sessions = new Map<string, SessionEntry>();
  readonly #maxSessions: number;
  readonly #idleTtlMs: number;
  readonly #systemRules: string;
  readonly #createAdapter: (apiKey: string) => AnyTextAdapter;

  constructor(options: SessionEngineManagerOptions) {
    this.#maxSessions = options.maxSessions;
    this.#idleTtlMs = options.idleTtlMs;
    this.#systemRules = options.systemRules;
    this.#createAdapter = options.createAdapter;
  }

  /** Returns the existing engine for sessionId if present (touches its TTL/LRU), else builds one from apiKey. */
  getOrCreate(sessionId: string, apiKey: string): Engine {
    const existing = this.#sessions.get(sessionId);
    if (existing) {
      this.#touch(sessionId, existing);
      return existing.engine;
    }

    let engine: Engine;
    try {
      engine = createEngine({
        adapter: this.#createAdapter(apiKey),
        maxRetries: 2,
        history: { store: createInMemoryStore(), maxEntries: 20 },
        prompt: { system: { rules: { append: this.#systemRules } } },
      });
    } catch (err) {
      // Never let a construction failure (bad key, adapter error) surface
      // the key — it may appear in a provider SDK's own error message.
      throw redact(err, apiKey);
    }

    this.#evictLruIfFull();

    const ttlTimer = setTimeout(() => this.evict(sessionId), this.#idleTtlMs);
    this.#sessions.set(sessionId, { engine, lastUsedAt: Date.now(), ttlTimer });
    return engine;
  }

  evict(sessionId: string): void {
    const entry = this.#sessions.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.ttlTimer);
    this.#sessions.delete(sessionId);
  }

  size(): number {
    return this.#sessions.size;
  }

  dispose(): void {
    for (const entry of this.#sessions.values()) {
      clearTimeout(entry.ttlTimer);
    }
    this.#sessions.clear();
  }

  #touch(sessionId: string, entry: SessionEntry): void {
    clearTimeout(entry.ttlTimer);
    entry.lastUsedAt = Date.now();
    entry.ttlTimer = setTimeout(() => this.evict(sessionId), this.#idleTtlMs);
  }

  #evictLruIfFull(): void {
    if (this.#sessions.size < this.#maxSessions) return;
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [id, entry] of this.#sessions) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestId = id;
      }
    }
    if (oldestId !== null) this.evict(oldestId);
  }
}
