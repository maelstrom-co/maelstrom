import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createInMemoryHistoryStore } from './memory-store.js';
import type { HistoryEntry } from './types.js';

function createEntry(
  sessionId: string,
  userIntent: string,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sessionId,
    timestamp: Date.now(),
    userIntent,
    userMessage: `Response to: ${userIntent}`,
    ...overrides,
  };
}

describe('createInMemoryHistoryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getEntries', () => {
    it('should return empty array for unknown session', async () => {
      const store = createInMemoryHistoryStore();
      const entries = await store.getEntries('unknown-session');
      expect(entries).toEqual([]);
    });

    it('should return entries for existing session', async () => {
      const store = createInMemoryHistoryStore();
      const entry = createEntry('session-1', 'Show calendar');

      await store.addEntry(entry);
      const entries = await store.getEntries('session-1');

      expect(entries).toHaveLength(1);
      expect(entries[0].userIntent).toBe('Show calendar');
    });
  });

  describe('addEntry', () => {
    it('should add entry to session', async () => {
      const store = createInMemoryHistoryStore();
      const entry = createEntry('session-1', 'Show calendar');

      await store.addEntry(entry);

      expect(store.getSessionCount()).toBe(1);
      expect(store.getSessionIds()).toContain('session-1');
    });

    it('should add multiple entries to same session', async () => {
      const store = createInMemoryHistoryStore();

      await store.addEntry(createEntry('session-1', 'First'));
      await store.addEntry(createEntry('session-1', 'Second'));
      await store.addEntry(createEntry('session-1', 'Third'));

      const entries = await store.getEntries('session-1');
      expect(entries).toHaveLength(3);
    });

    it('should enforce maxEntriesPerSession limit', async () => {
      const store = createInMemoryHistoryStore({ maxEntriesPerSession: 2 });

      await store.addEntry(createEntry('session-1', 'First'));
      await store.addEntry(createEntry('session-1', 'Second'));
      await store.addEntry(createEntry('session-1', 'Third'));

      const entries = await store.getEntries('session-1');
      expect(entries).toHaveLength(2);
      expect(entries[0].userIntent).toBe('Second');
      expect(entries[1].userIntent).toBe('Third');
    });

    it('should handle multiple sessions independently', async () => {
      const store = createInMemoryHistoryStore();

      await store.addEntry(createEntry('session-1', 'Session 1 entry'));
      await store.addEntry(createEntry('session-2', 'Session 2 entry'));

      expect(store.getSessionCount()).toBe(2);

      const entries1 = await store.getEntries('session-1');
      const entries2 = await store.getEntries('session-2');

      expect(entries1).toHaveLength(1);
      expect(entries2).toHaveLength(1);
      expect(entries1[0].userIntent).toBe('Session 1 entry');
      expect(entries2[0].userIntent).toBe('Session 2 entry');
    });
  });

  describe('clearSession', () => {
    it('should clear all entries for a session', async () => {
      const store = createInMemoryHistoryStore();

      await store.addEntry(createEntry('session-1', 'Entry 1'));
      await store.addEntry(createEntry('session-1', 'Entry 2'));

      await store.clearSession('session-1');

      const entries = await store.getEntries('session-1');
      expect(entries).toEqual([]);
      expect(store.getSessionCount()).toBe(0);
    });

    it('should not affect other sessions', async () => {
      const store = createInMemoryHistoryStore();

      await store.addEntry(createEntry('session-1', 'Session 1'));
      await store.addEntry(createEntry('session-2', 'Session 2'));

      await store.clearSession('session-1');

      const entries2 = await store.getEntries('session-2');
      expect(entries2).toHaveLength(1);
    });

    it('should handle clearing non-existent session gracefully', async () => {
      const store = createInMemoryHistoryStore();
      await expect(store.clearSession('unknown')).resolves.not.toThrow();
    });
  });

  describe('pruneExpiredSessions', () => {
    it('should return 0 when no TTL configured', async () => {
      const store = createInMemoryHistoryStore();
      await store.addEntry(createEntry('session-1', 'Entry'));

      const pruned = await store.pruneExpiredSessions();
      expect(pruned).toBe(0);
    });

    it('should prune expired sessions', async () => {
      const store = createInMemoryHistoryStore({ sessionTtlMs: 1000 });

      await store.addEntry(createEntry('session-1', 'Entry'));
      expect(store.getSessionCount()).toBe(1);

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      const pruned = await store.pruneExpiredSessions();
      expect(pruned).toBe(1);
      expect(store.getSessionCount()).toBe(0);
    });

    it('should not prune active sessions', async () => {
      const store = createInMemoryHistoryStore({ sessionTtlMs: 1000 });

      await store.addEntry(createEntry('session-1', 'Entry'));

      // Access within TTL refreshes timestamp
      vi.advanceTimersByTime(500);
      await store.getEntries('session-1');

      vi.advanceTimersByTime(700);

      const pruned = await store.pruneExpiredSessions();
      expect(pruned).toBe(0);
      expect(store.getSessionCount()).toBe(1);
    });
  });
});
