import type { UpdateReason } from '@maelstrom/protocol';

// ============================================================================
// Configuration
// ============================================================================

/** Default debounce delay for state changes (ms) */
const DEFAULT_DEBOUNCE_DELAY_MS = 300;

/** Maximum wait time before forcing a flush (ms) */
const DEFAULT_MAX_WAIT_MS = 1000;

export interface UpdateQueueConfig {
  /** Debounce delay in milliseconds (default: 300) */
  debounceDelayMs?: number;
  /** Maximum wait time before forcing a flush (default: 1000) */
  maxWaitMs?: number;
  /** Callback when updates are flushed */
  onFlush: (updates: UpdateReason[]) => Promise<void>;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// Update Queue Interface
// ============================================================================

export interface UpdateQueue {
  /**
   * Schedule an update to be processed.
   * Updates are batched and debounced for efficiency.
   * User intents trigger an immediate flush.
   */
  schedule(reason: UpdateReason): void;

  /**
   * Immediately flush any pending updates.
   * Returns a promise that resolves when the flush callback completes.
   */
  flush(): Promise<void>;

  /**
   * Get the current pending updates without flushing or clearing.
   */
  getPending(): UpdateReason[];

  /**
   * Take all pending updates (coalesced) and clear the queue.
   * This is useful when you need to process updates outside the normal flush flow.
   * Returns an empty array if no updates are pending.
   */
  takeCoalesced(): UpdateReason[];

  /**
   * Clear all pending updates and timers without flushing.
   */
  clear(): void;

  /**
   * Check if there are pending updates.
   */
  hasPending(): boolean;
}

// ============================================================================
// Update Queue Implementation
// ============================================================================

export function createUpdateQueue(config: UpdateQueueConfig): UpdateQueue {
  const debounceDelayMs = config.debounceDelayMs ?? DEFAULT_DEBOUNCE_DELAY_MS;
  const maxWaitMs = config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const { onFlush, debug = false } = config;

  /** Pending update reasons to be batched */
  let pendingUpdates: UpdateReason[] = [];

  /** Debounce timer for idle detection */
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Max wait timer to force flush */
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether a flush is currently in progress */
  let isFlushing = false;

  /** Queue of flush promises to resolve when current flush completes */
  let flushPromiseQueue: {
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];

  // ============================================================================
  // Private Helpers
  // ============================================================================

  function log(...args: unknown[]): void {
    if (debug) {
      console.log('[UpdateQueue]', ...args);
    }
  }

  function clearTimers(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }

  /**
   * Coalesce multiple updates into a minimal set.
   * - For chart_resize, only keep the most recent one.
   * - For vessel_mutation on the same instance, combine them.
   * - User intents are preserved in order.
   */
  function coalesce(updates: UpdateReason[]): UpdateReason[] {
    const result: UpdateReason[] = [];
    let latestResize: UpdateReason | null = null;
    const vesselMutations = new Map<string, UpdateReason>();

    for (const update of updates) {
      switch (update.type) {
        case 'user_intent':
          // Always keep user intents in order
          result.push(update);
          break;
        case 'chart_resize':
          // Only keep the latest resize
          latestResize = update;
          break;
        case 'vessel_mutation': {
          // Combine mutations for the same instance
          const existing = vesselMutations.get(update.instanceId);
          if (existing && existing.type === 'vessel_mutation') {
            vesselMutations.set(update.instanceId, {
              ...update,
              changes: `${existing.changes}, ${update.changes}`,
            });
          } else {
            vesselMutations.set(update.instanceId, update);
          }
          break;
        }
      }
    }

    // Add coalesced updates
    if (latestResize) {
      result.push(latestResize);
    }
    for (const mutation of vesselMutations.values()) {
      result.push(mutation);
    }

    return result;
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  function schedule(reason: UpdateReason): void {
    pendingUpdates.push(reason);
    log('Scheduled:', reason.type, `(${pendingUpdates.length} pending)`);

    // User intents trigger immediate flush
    if (reason.type === 'user_intent') {
      log('User intent detected, flushing immediately');
      flush();
      return;
    }

    // Clear existing debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set up debounce timer (flush after idle period)
    debounceTimer = setTimeout(() => {
      log('Debounce timer fired');
      flush();
    }, debounceDelayMs);

    // Set up max wait timer if not already set
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(() => {
        log('Max wait timer fired, forcing flush');
        flush();
      }, maxWaitMs);
    }
  }

  async function flush(): Promise<void> {
    clearTimers();

    // Nothing to flush
    if (pendingUpdates.length === 0) {
      return;
    }

    // Already flushing - queue a promise to resolve when done
    if (isFlushing) {
      log('Already flushing, queueing promise');
      return new Promise((resolve, reject) => {
        flushPromiseQueue.push({ resolve, reject });
      });
    }

    // Take the pending updates and clear the queue
    const updates = [...pendingUpdates];
    pendingUpdates = [];

    // Coalesce updates
    const coalescedUpdates = coalesce(updates);
    log(
      'Flushing',
      coalescedUpdates.length,
      'updates (from',
      updates.length,
      'raw)',
    );

    isFlushing = true;

    try {
      await onFlush(coalescedUpdates);

      // Resolve any queued flush promises
      for (const { resolve } of flushPromiseQueue) {
        resolve();
      }
      flushPromiseQueue = [];
    } catch (error) {
      // Reject any queued flush promises
      const err = error instanceof Error ? error : new Error(String(error));
      for (const { reject } of flushPromiseQueue) {
        reject(err);
      }
      flushPromiseQueue = [];
      throw error;
    } finally {
      isFlushing = false;

      // Check if more updates came in while flushing
      if (pendingUpdates.length > 0) {
        log('More updates pending, scheduling flush');
        debounceTimer = setTimeout(() => {
          flush();
        }, debounceDelayMs);
      }
    }
  }

  function getPending(): UpdateReason[] {
    return [...pendingUpdates];
  }

  function takeCoalesced(): UpdateReason[] {
    if (pendingUpdates.length === 0) {
      return [];
    }

    clearTimers();
    const updates = [...pendingUpdates];
    pendingUpdates = [];

    const coalescedUpdates = coalesce(updates);
    log(
      'Took',
      coalescedUpdates.length,
      'coalesced updates (from',
      updates.length,
      'raw)',
    );

    return coalescedUpdates;
  }

  function clear(): void {
    clearTimers();
    pendingUpdates = [];
    log('Cleared all pending updates');
  }

  function hasPending(): boolean {
    return pendingUpdates.length > 0;
  }

  return {
    schedule,
    flush,
    getPending,
    takeCoalesced,
    clear,
    hasPending,
  };
}
