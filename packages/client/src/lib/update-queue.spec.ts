import type { UpdateReason } from '@maelstrom/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateQueue, type UpdateQueue } from './update-queue.js';

describe('UpdateQueue', () => {
  let queue: UpdateQueue;
  let onFlush: (updates: UpdateReason[]) => Promise<void>;
  let flushedUpdates: UpdateReason[][];

  beforeEach(() => {
    vi.useFakeTimers();
    flushedUpdates = [];
    onFlush = vi.fn(async (updates) => {
      flushedUpdates.push(updates);
    });
    queue = createUpdateQueue({ onFlush });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================================
  // Basic Scheduling
  // ============================================================================

  describe('schedule', () => {
    it('should add update to pending queue', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      expect(queue.hasPending()).toBe(true);
      expect(queue.getPending()).toHaveLength(1);
    });

    it('should accumulate multiple updates', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });

      expect(queue.getPending()).toHaveLength(2);
    });

    it('should trigger immediate flush for user_intent', async () => {
      queue.schedule({ type: 'user_intent', intent: 'Show calendar' });

      // Let the microtask queue process
      await vi.runAllTimersAsync();

      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(flushedUpdates[0]).toEqual([
        { type: 'user_intent', intent: 'Show calendar' },
      ]);
      expect(queue.hasPending()).toBe(false);
    });
  });

  // ============================================================================
  // Debouncing
  // ============================================================================

  describe('debouncing', () => {
    it('should flush after debounce delay (300ms by default)', async () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      expect(onFlush).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);

      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('should reset debounce timer on new update', async () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(onFlush).not.toHaveBeenCalled();

      // Schedule another update, should reset the timer
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(onFlush).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(flushedUpdates[0]).toHaveLength(2); // Both updates coalesced
    });

    it('should respect custom debounce delay', async () => {
      queue = createUpdateQueue({ onFlush, debounceDelayMs: 500 });

      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(300);
      expect(onFlush).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Max Wait
  // ============================================================================

  describe('max wait', () => {
    it('should force flush after max wait (1000ms by default)', async () => {
      // Keep scheduling updates to reset debounce
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(200);
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 12, rows: 8 },
        current: { columns: 14, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(200);
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 14, rows: 8 },
        current: { columns: 16, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(200);
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 16, rows: 8 },
        current: { columns: 18, rows: 8 },
      });

      expect(onFlush).not.toHaveBeenCalled();

      // Max wait fires at 1000ms from first update
      await vi.advanceTimersByTimeAsync(400);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('should respect custom max wait', async () => {
      queue = createUpdateQueue({ onFlush, maxWaitMs: 500 });

      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(200);
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 12, rows: 8 },
        current: { columns: 14, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(200);
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 14, rows: 8 },
        current: { columns: 16, rows: 8 },
      });

      expect(onFlush).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Coalescing
  // ============================================================================

  describe('coalescing', () => {
    it('should keep only the latest chart_resize', async () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 12, rows: 8 },
        current: { columns: 14, rows: 8 },
      });
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 14, rows: 8 },
        current: { columns: 16, rows: 8 },
      });

      await vi.advanceTimersByTimeAsync(300);

      expect(flushedUpdates[0]).toHaveLength(1);
      expect(flushedUpdates[0][0]).toEqual({
        type: 'chart_resize',
        previous: { columns: 14, rows: 8 },
        current: { columns: 16, rows: 8 },
      });
    });

    it('should combine vessel_mutation for same instance', async () => {
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'size',
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'variant',
      });

      await vi.advanceTimersByTimeAsync(300);

      expect(flushedUpdates[0]).toHaveLength(1);
      expect(flushedUpdates[0][0]).toEqual({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position, size, variant',
      });
    });

    it('should keep vessel_mutation for different instances separate', async () => {
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-2',
        changes: 'size',
      });

      await vi.advanceTimersByTimeAsync(300);

      expect(flushedUpdates[0]).toHaveLength(2);
    });

    it('should preserve all user_intent in order', async () => {
      queue.schedule({ type: 'user_intent', intent: 'First intent' });

      // Let first flush complete
      await vi.runAllTimersAsync();

      // Schedule more
      queue.schedule({ type: 'user_intent', intent: 'Second intent' });
      await vi.runAllTimersAsync();

      expect(flushedUpdates).toHaveLength(2);
      expect(flushedUpdates[0][0]).toEqual({
        type: 'user_intent',
        intent: 'First intent',
      });
      expect(flushedUpdates[1][0]).toEqual({
        type: 'user_intent',
        intent: 'Second intent',
      });
    });

    it('should coalesce mixed update types correctly', async () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 12, rows: 8 },
        current: { columns: 14, rows: 8 },
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'size',
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-2',
        changes: 'variant',
      });

      await vi.advanceTimersByTimeAsync(300);

      // Should have: 1 resize (latest), 2 mutations (vessel-1 combined, vessel-2 separate)
      expect(flushedUpdates[0]).toHaveLength(3);

      const resize = flushedUpdates[0].find((u) => u.type === 'chart_resize');
      expect(resize).toEqual({
        type: 'chart_resize',
        previous: { columns: 12, rows: 8 },
        current: { columns: 14, rows: 8 },
      });

      const vessel1 = flushedUpdates[0].find(
        (u) => u.type === 'vessel_mutation' && u.instanceId === 'vessel-1',
      );
      expect(vessel1).toEqual({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position, size',
      });
    });
  });

  // ============================================================================
  // takeCoalesced
  // ============================================================================

  describe('takeCoalesced', () => {
    it('should return empty array when no pending updates', () => {
      const result = queue.takeCoalesced();
      expect(result).toEqual([]);
    });

    it('should return coalesced updates and clear queue', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 12, rows: 8 },
        current: { columns: 14, rows: 8 },
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });

      const result = queue.takeCoalesced();

      expect(result).toHaveLength(2); // 1 resize + 1 mutation
      expect(queue.hasPending()).toBe(false);
      expect(queue.getPending()).toEqual([]);
    });

    it('should cancel pending timers', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      queue.takeCoalesced();

      // Advance time - should not flush since timers were cancelled
      vi.advanceTimersByTime(1000);
      expect(onFlush).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // clear
  // ============================================================================

  describe('clear', () => {
    it('should remove all pending updates', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });

      queue.clear();

      expect(queue.hasPending()).toBe(false);
      expect(queue.getPending()).toEqual([]);
    });

    it('should cancel pending timers', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      queue.clear();

      vi.advanceTimersByTime(1000);
      expect(onFlush).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // flush
  // ============================================================================

  describe('flush', () => {
    it('should do nothing when no pending updates', async () => {
      await queue.flush();
      expect(onFlush).not.toHaveBeenCalled();
    });

    it('should immediately process pending updates', async () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await queue.flush();

      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(queue.hasPending()).toBe(false);
    });

    it('should queue promise when already flushing', async () => {
      let resolveFirst: () => void;
      const firstFlushPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      onFlush = vi.fn(async () => {
        await firstFlushPromise;
      });
      queue = createUpdateQueue({ onFlush });

      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      // Start first flush (will block on firstFlushPromise)
      const flush1 = queue.flush();

      // Schedule another update and try to flush again
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });
      const flush2 = queue.flush();

      // Resolve the first flush
      // biome-ignore lint/style/noNonNullAssertion: resolveFirst has already been assigned
      resolveFirst!();

      await flush1;
      await flush2;

      // First flush completed
      expect(onFlush).toHaveBeenCalledTimes(1);

      // The update scheduled during the first flush is still pending
      // and will be processed by the debounce timer or a subsequent explicit flush
      expect(queue.hasPending()).toBe(true);

      // Now run the pending debounce timer
      await vi.advanceTimersByTimeAsync(300);

      expect(onFlush).toHaveBeenCalledTimes(2);
      expect(queue.hasPending()).toBe(false);
    });
  });

  // ============================================================================
  // getPending & hasPending
  // ============================================================================

  describe('getPending', () => {
    it('should return copy of pending updates', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      const pending1 = queue.getPending();
      const pending2 = queue.getPending();

      expect(pending1).toEqual(pending2);
      expect(pending1).not.toBe(pending2); // Should be different array instances
    });
  });

  describe('hasPending', () => {
    it('should return false when empty', () => {
      expect(queue.hasPending()).toBe(false);
    });

    it('should return true when has updates', () => {
      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });
      expect(queue.hasPending()).toBe(true);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('error handling', () => {
    it('should propagate errors from onFlush', async () => {
      onFlush = vi.fn(async () => {
        throw new Error('Flush failed');
      });
      queue = createUpdateQueue({ onFlush });

      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await expect(queue.flush()).rejects.toThrow('Flush failed');
    });

    it('should still allow new updates after error', async () => {
      let shouldFail = true;
      onFlush = vi.fn(async () => {
        if (shouldFail) {
          throw new Error('Flush failed');
        }
      });
      queue = createUpdateQueue({ onFlush });

      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await expect(queue.flush()).rejects.toThrow('Flush failed');

      // Should be able to schedule and flush again
      shouldFail = false;
      queue.schedule({
        type: 'vessel_mutation',
        instanceId: 'vessel-1',
        changes: 'position',
      });

      await expect(queue.flush()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // Updates During Flush
  // ============================================================================

  describe('updates during flush', () => {
    it('should schedule new flush for updates that arrive during flushing', async () => {
      let flushCount = 0;
      onFlush = vi.fn(async () => {
        flushCount++;
        if (flushCount === 1) {
          // Schedule a new update during the first flush
          queue.schedule({
            type: 'vessel_mutation',
            instanceId: 'vessel-1',
            changes: 'position',
          });
        }
      });
      queue = createUpdateQueue({ onFlush });

      queue.schedule({
        type: 'chart_resize',
        previous: { columns: 10, rows: 8 },
        current: { columns: 12, rows: 8 },
      });

      await queue.flush();

      // The update scheduled during flush should still be pending
      expect(queue.hasPending()).toBe(true);

      // Advance time to trigger the scheduled flush
      await vi.advanceTimersByTimeAsync(300);

      expect(onFlush).toHaveBeenCalledTimes(2);
    });
  });
});
