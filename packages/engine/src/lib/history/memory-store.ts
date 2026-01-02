import type { HistoryEntry, HistoryStore } from './types.js';

/**
 * Configuration for the in-memory history store.
 */
export interface InMemoryStoreConfig {
  /** TTL for session data in milliseconds */
  sessionTtlMs?: number;
  /** Maximum entries per session (prevents unbounded growth) */
  maxEntriesPerSession?: number;
}

/**
 * In-memory history store with additional testing utilities.
 */
export interface InMemoryHistoryStore extends HistoryStore {
  /** Prune expired sessions (always available in memory store) */
  pruneExpiredSessions(): Promise<number>;
  /** For testing: get all session IDs */
  getSessionIds(): string[];
  /** For testing: get session count */
  getSessionCount(): number;
}

/**
 * Creates an in-memory history store for development/testing.
 * Not suitable for production with multiple instances.
 */
export function createInMemoryHistoryStore(
  config: InMemoryStoreConfig = {},
): InMemoryHistoryStore {
  const sessions: Map<string, HistoryEntry[]> = new Map();
  const sessionTimestamps: Map<string, number> = new Map();

  function updateSessionTimestamp(sessionId: string): void {
    sessionTimestamps.set(sessionId, Date.now());
  }

  return {
    async getEntries(sessionId: string): Promise<HistoryEntry[]> {
      updateSessionTimestamp(sessionId);
      return sessions.get(sessionId) ?? [];
    },

    async addEntry(entry: HistoryEntry): Promise<void> {
      const sessionId = entry.sessionId;
      updateSessionTimestamp(sessionId);

      let entries = sessions.get(sessionId);
      if (!entries) {
        entries = [];
        sessions.set(sessionId, entries);
      }

      entries.push(entry);

      // Enforce max entries limit
      const maxEntries = config.maxEntriesPerSession ?? 100;
      if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
      }
    },

    async clearSession(sessionId: string): Promise<void> {
      sessions.delete(sessionId);
      sessionTimestamps.delete(sessionId);
    },

    async pruneExpiredSessions(): Promise<number> {
      if (!config.sessionTtlMs) return 0;

      const now = Date.now();
      let pruned = 0;

      for (const [sessionId, timestamp] of sessionTimestamps) {
        if (now - timestamp > config.sessionTtlMs) {
          sessions.delete(sessionId);
          sessionTimestamps.delete(sessionId);
          pruned++;
        }
      }

      return pruned;
    },

    getSessionIds(): string[] {
      return Array.from(sessions.keys());
    },

    getSessionCount(): number {
      return sessions.size;
    },
  };
}
