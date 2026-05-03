import type { MessageId, SessionId } from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import type { HistoryEntry, HistoryStore } from './history-store.js';

/**
 * Optional configuration for {@link createInMemoryStore}. Pass a `logger`
 * to surface diagnostics that would otherwise be silent (e.g.
 * `getResponseById` finding the slot occupied by an `injection` rather
 * than a `turn` — a `messageId` reuse across kinds, distinct from a clean
 * miss). Default behavior is silent.
 */
export interface InMemoryStoreOptions {
  readonly logger?: Logger;
}

/**
 * Reference implementation of {@link HistoryStore} backed by a nested map.
 *
 * The check-and-insert inside `append` is a single synchronous block, which
 * is atomic in single-process JavaScript — no await separates the `has`
 * check from the `set`, so no other caller can observe the half-state. This
 * is enough for the in-process reference engine; distributed deployments
 * must provide a store that delegates atomicity to the backend.
 */
export function createInMemoryStore<TMeta = unknown>(
  options: InMemoryStoreOptions = {},
): HistoryStore<TMeta> {
  const { logger } = options;
  const data = new Map<SessionId, Map<MessageId, HistoryEntry<TMeta>>>();

  const sessionFor = (
    sessionId: SessionId,
  ): Map<MessageId, HistoryEntry<TMeta>> => {
    const existing = data.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<MessageId, HistoryEntry<TMeta>>();
    data.set(sessionId, created);
    return created;
  };

  return {
    async append(sessionId, entry) {
      const session = sessionFor(sessionId);
      if (session.has(entry.input.id)) {
        return { inserted: false };
      }
      session.set(entry.input.id, entry);
      return { inserted: true };
    },

    async get(sessionId) {
      const session = data.get(sessionId);
      if (session === undefined) {
        return [];
      }
      return Array.from(session.values());
    },

    async replace(sessionId, entries) {
      const next = new Map<MessageId, HistoryEntry<TMeta>>();
      for (const entry of entries) {
        next.set(entry.input.id, entry);
      }
      data.set(sessionId, next);
    },

    async clear(sessionId) {
      data.delete(sessionId);
    },

    async getResponseById(sessionId, messageId) {
      const session = data.get(sessionId);
      if (session === undefined) {
        return null;
      }
      const entry = session.get(messageId);
      if (entry === undefined) {
        return null;
      }
      if (entry.kind !== 'turn') {
        // Slot exists but holds an `injection` — a real messageId reuse
        // across kinds, semantically distinct from a clean miss. Surface
        // it so the dual outcome stays distinguishable in production logs;
        // the engine's replay path treats both the same (cache miss →
        // fresh LLM call), so this is observability only.
        logger?.warn(
          'getResponseById: slot kind mismatch (returning null)',
          { sessionId, messageId, slotKind: entry.kind },
        );
        return null;
      }
      return entry.output;
    },
  };
}
