import type { MessageId, SessionId } from '@maelstrom-co/protocol';

import type { HistoryEntry, HistoryStore } from './history-store.js';

/**
 * Reference implementation of {@link HistoryStore} backed by a nested map.
 *
 * The check-and-insert inside `append` is a single synchronous block, which
 * is atomic in single-process JavaScript — no await separates the `has`
 * check from the `set`, so no other caller can observe the half-state. This
 * is enough for the in-process reference engine; distributed deployments
 * must provide a store that delegates atomicity to the backend.
 */
export function createInMemoryStore<TMeta = unknown>(): HistoryStore<TMeta> {
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
        return { kind: 'miss' };
      }
      const entry = session.get(messageId);
      if (entry === undefined) {
        return { kind: 'miss' };
      }
      // Slot exists but holds a non-`turn` entry (today only `injection`
      // exists, but the store reports the actual kind via `slotKind` so
      // downstream observability stays correct if a third kind ever lands).
      // Reporting it as a third outcome lets the consumer decide whether
      // to warn, page, or treat it like a miss.
      if (entry.kind !== 'turn') {
        return { kind: 'kind-mismatch', slotKind: entry.kind };
      }
      return { kind: 'hit', output: entry.output };
    },
  };
}
