import type {
  AssistantInjectionMessage,
  ChartRequestMessage,
  ChartResponseOutput,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

/**
 * A single recorded item in a session's history.
 *
 * `turn` entries capture a completed chart_request round-trip (LLM input + output).
 * `injection` entries capture a developer-supplied assistant message — content
 * seeded into history so subsequent LLM turns see it in context, without
 * actually invoking the LLM for the injection itself.
 *
 * Engine-internal: this is the storage shape, persisted by the configured
 * {@link HistoryStore} and consumed by the prompt-builder. Clients fetching
 * history through `Engine.getHistory` see a leaner wire DTO
 * ({@link SessionHistoryEntry} in `@maelstrom-co/protocol`); this internal
 * type is free to evolve (extra metadata fields, store-specific keys, etc.)
 * without breaking the wire contract.
 *
 * Consumers may pin `TMeta` to attach typed metadata (tenant id, experiment
 * arm, token counts, audit trail, etc.) that rides along every entry and
 * flows through the store, the `transformEntry` hook, and any configured
 * `deriveLLMContext` projection. Leave the type parameter defaulted to
 * `unknown` to opt out of metadata entirely.
 */
export type HistoryEntry<TMeta = unknown> =
  | {
      readonly kind: 'turn';
      readonly input: ChartRequestMessage;
      readonly output: ChartResponseOutput;
      readonly metadata?: TMeta;
    }
  | {
      readonly kind: 'injection';
      readonly input: AssistantInjectionMessage;
      readonly metadata?: TMeta;
    };

/**
 * Backing persistence for {@link HistoryManager}. The engine ships an
 * in-memory reference implementation; production deployments provide their
 * own (Redis, Postgres, SQLite, etc.).
 *
 * Implementations MUST guarantee that {@link append} is atomic with respect
 * to concurrent calls sharing the same `(sessionId, entry.input.id)` pair —
 * exactly one wins and the duplicate reports `{ inserted: false }`. In
 * single-process JavaScript this is free; in multi-process deployments use
 * the backend's native primitives (`INSERT OR IGNORE`, `ON CONFLICT DO NOTHING`,
 * Redis `SETNX`, etc.).
 */
export interface HistoryStore<TMeta = unknown> {
  /**
   * Atomically check-and-insert. Returns `{ inserted: false }` if an entry
   * with the same {@link MessageId} already exists in the given session.
   */
  append(
    sessionId: SessionId,
    entry: HistoryEntry<TMeta>,
  ): Promise<{ readonly inserted: boolean }>;

  /** Returns all entries for a session in insertion order. */
  get(sessionId: SessionId): Promise<readonly HistoryEntry<TMeta>[]>;

  /** Overwrites the session's entry list. Used by truncation. */
  replace(
    sessionId: SessionId,
    entries: readonly HistoryEntry<TMeta>[],
  ): Promise<void>;

  /** Wipes all entries for a session. No-op on an unknown session. */
  clear(sessionId: SessionId): Promise<void>;

  /**
   * Point-lookup of a previously recorded `turn`'s response.
   *
   * Returns one of three semantically distinct outcomes (see
   * {@link GetResponseByIdResult}). The engine's replay path treats `miss`
   * and `kind-mismatch` identically (both fall through to a fresh LLM
   * call), but the type-level distinction lets the consumer decide what
   * to do about a `messageId` reuse across kinds — surface it as a
   * warning, page on it, etc. Stores backed by a remote backend should
   * implement this against backend-native point-lookup primitives (Redis
   * `HGET`, Postgres `SELECT response WHERE …`) to avoid materializing
   * the full {@link HistoryEntry}.
   */
  getResponseById(
    sessionId: SessionId,
    messageId: MessageId,
  ): Promise<GetResponseByIdResult>;
}

/**
 * Result of {@link HistoryStore.getResponseById}. Three discriminated
 * outcomes:
 *
 * - `hit` — a `turn` entry exists and its `response` is included.
 * - `miss` — no entry exists for `(sessionId, messageId)`. The id was
 *   never recorded, or the slot was evicted by truncation.
 * - `kind-mismatch` — the id slot exists but holds a non-`turn` entry
 *   (only `turn` entries carry a response). `slotKind` carries the
 *   actual stored kind so a third entry kind doesn't quietly misattribute
 *   downstream log lines as "injection." Structurally a miss for replay;
 *   semantically a `messageId` reuse across kinds — a signal the consumer
 *   may want to log or alert on.
 */
export type GetResponseByIdResult =
  | { readonly kind: 'hit'; readonly output: ChartResponseOutput }
  | { readonly kind: 'miss' }
  | {
      readonly kind: 'kind-mismatch';
      readonly slotKind: Exclude<HistoryEntry['kind'], 'turn'>;
    };
