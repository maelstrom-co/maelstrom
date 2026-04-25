import type {
  AssistantInjectionMessage,
  ChartRequestMessage,
  ChartResponseOutput,
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
}
