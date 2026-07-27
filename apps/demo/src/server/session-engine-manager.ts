import { consoleLogger, createEngine, createInMemoryStore, type Engine, type Logger } from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';
import { redactSecrets } from './redact';

export interface SessionEngineManagerOptions {
  readonly maxSessions: number;
  readonly idleTtlMs: number;
  readonly systemRules: string;
  readonly createAdapter: (apiKey: string) => AnyTextAdapter;
  /** Forwarded verbatim to every session engine's `EngineConfig.modelOptions`. */
  readonly modelOptions?: Record<string, unknown>;
}

interface SessionEntry {
  engine: Engine;
  apiKey: string;
  lastUsedAt: number;
  ttlTimer: ReturnType<typeof setTimeout>;
}

/**
 * Redacts an apiKey out of an error's message so it can never reach a log
 * line or a wire error payload — key custody is a hosted-mode invariant,
 * not just a nicety. Delegates to redactSecrets (exact-match pass +
 * sk-*-shaped pattern pass) so this is the same scrub every other outbound
 * path uses, not a second hand-rolled copy of it.
 */
function redact(err: unknown, apiKey: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(redactSecrets(message, apiKey));
}

function redactUnknown(value: unknown, apiKey: string): unknown {
  if (typeof value === 'string') return redactSecrets(value, apiKey);
  if (value instanceof Error) {
    const clone = new Error(redactSecrets(value.message, apiKey));
    clone.name = value.name;
    if (value.stack) clone.stack = redactSecrets(value.stack, apiKey);
    return clone;
  }
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value), apiKey));
  } catch {
    return '[unloggable value]';
  }
}

function redactData(
  data: Record<string, unknown> | undefined,
  apiKey: string,
): Record<string, unknown> | undefined {
  if (!data) return data;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, redactUnknown(value, apiKey)]),
  );
}

/**
 * A Logger that scrubs the session's apiKey (and any sk-*-shaped string) out
 * of every argument before delegating to consoleLogger. createEngine's
 * default logger is consoleLogger, which writes provider SDK errors —
 * including OpenAI's own 401 key echo — straight to stdout; hosted mode's
 * container observability persists that. Every SessionEngineManager engine
 * must be built with one of these instead of the default.
 */
function createRedactingLogger(apiKey: string): Logger {
  return {
    debug: (message, data) => consoleLogger.debug(redactSecrets(message, apiKey), redactData(data, apiKey)),
    info: (message, data) => consoleLogger.info(redactSecrets(message, apiKey), redactData(data, apiKey)),
    warn: (message, data) => consoleLogger.warn(redactSecrets(message, apiKey), redactData(data, apiKey)),
    error: (message, error, data) =>
      consoleLogger.error(
        redactSecrets(message, apiKey),
        redactUnknown(error, apiKey),
        redactData(data, apiKey),
      ),
  };
}

export class SessionEngineManager {
  readonly #sessions = new Map<string, SessionEntry>();
  readonly #maxSessions: number;
  readonly #idleTtlMs: number;
  readonly #systemRules: string;
  readonly #createAdapter: (apiKey: string) => AnyTextAdapter;
  readonly #modelOptions: Record<string, unknown> | undefined;

  constructor(options: SessionEngineManagerOptions) {
    this.#maxSessions = options.maxSessions;
    this.#idleTtlMs = options.idleTtlMs;
    this.#systemRules = options.systemRules;
    this.#createAdapter = options.createAdapter;
    this.#modelOptions = options.modelOptions;
  }

  /**
   * Returns the existing engine for sessionId if present and the offered
   * apiKey matches the one it was built with (touches its TTL/LRU), else
   * builds a fresh one from apiKey.
   *
   * A sessionId is correlation data, not a secret (nanoid entropy makes it
   * unguessable, but it can still be observed — a shared machine, a
   * screenshot, a future log line). Key custody must not rest on sessionId
   * secrecy alone: if a different key is offered for an existing session,
   * that session's engine is evicted and rebuilt scoped to the newly
   * offered key rather than handed to whoever presented it. This also covers
   * the legitimate case — a visitor rotates their key and reconnects on the
   * same sessionId — with the same code path.
   */
  getOrCreate(sessionId: string, apiKey: string): Engine {
    const existing = this.#sessions.get(sessionId);
    if (existing) {
      if (existing.apiKey === apiKey) {
        this.#touch(sessionId, existing);
        return existing.engine;
      }
      this.evict(sessionId);
    }

    let engine: Engine;
    try {
      engine = createEngine({
        adapter: this.#createAdapter(apiKey),
        maxRetries: 2,
        history: { store: createInMemoryStore(), maxEntries: 20 },
        prompt: { system: { rules: { append: this.#systemRules } } },
        logger: createRedactingLogger(apiKey),
        modelOptions: this.#modelOptions,
      });
    } catch (err) {
      // Never let a construction failure (bad key, adapter error) surface
      // the key — it may appear in a provider SDK's own error message.
      throw redact(err, apiKey);
    }

    this.#evictLruIfFull();

    const ttlTimer = setTimeout(() => this.evict(sessionId), this.#idleTtlMs);
    this.#sessions.set(sessionId, { engine, apiKey, lastUsedAt: Date.now(), ttlTimer });
    return engine;
  }

  /** Resets sessionId's idle TTL and LRU recency. No-op if the session isn't tracked (already evicted, or never existed). */
  touch(sessionId: string): void {
    const entry = this.#sessions.get(sessionId);
    if (entry) this.#touch(sessionId, entry);
  }

  /** Whether sessionId still has a live engine (not evicted by the LRU cap or idle TTL). */
  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
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
