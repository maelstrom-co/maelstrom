import type { UpdateReason } from '@maelstrom-co/protocol';

import { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import type { UpdateCoordinatorOptions } from './update-coordinator.types.js';

/**
 * Event map for UpdateCoordinator lifecycle events.
 */
export type UpdateCoordinatorEvents = {
  updates_flushed: {
    updates: UpdateReason[];
    rawCount: number;
    timestamp: number;
  };
};

const DEFAULT_OPTIONS: Required<UpdateCoordinatorOptions> = {
  debounceDelayMs: 300,
  maxWaitMs: 1000,
  debug: false,
};

/**
 * Coordinates update batching, coalescing, and flush scheduling.
 *
 * Updates are queued and debounced for efficiency. Before flushing,
 * updates are coalesced:
 * - Only the latest `chart_resize` is kept
 * - `vessel_mutation` updates for the same instance are combined
 *
 * User intents bypass the coordinator entirely and are handled
 * directly by the Orchestrator via `processIntent`.
 *
 * @example
 * ```ts
 * const coordinator = new UpdateCoordinator({ debounceDelayMs: 300 });
 *
 * coordinator.events.on('updates_flushed', (event) => {
 *   buildAndSendRequest(event.updates);
 * });
 *
 * coordinator.schedule({ type: 'chart_resize', width: 800, height: 600 });
 * ```
 */
export class UpdateCoordinator {
  readonly #emitter = new TypedEmitter<UpdateCoordinatorEvents>();
  readonly events: EventSubscriber<UpdateCoordinatorEvents> = this.#emitter;
  readonly #logger: Logger;
  readonly #options: Required<UpdateCoordinatorOptions>;

  #pendingUpdates: UpdateReason[] = [];
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: UpdateCoordinatorOptions = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    this.#logger = new Logger(this.#options.debug, 'UpdateCoordinator');
  }

  /**
   * Queues an update reason for the next debounced flush.
   *
   * No-op after disposal.
   */
  schedule(reason: UpdateReason): void {
    if (this.#emitter.disposed) return;

    this.#pendingUpdates.push(reason);

    this.#logger.info(
      `Scheduled: ${reason.type} (${this.#pendingUpdates.length} pending)`,
    );

    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
    }

    this.#debounceTimer = setTimeout(() => {
      this.#logger.info('Debounce timer fired');
      this.flush();
    }, this.#options.debounceDelayMs);

    if (!this.#maxWaitTimer) {
      this.#maxWaitTimer = setTimeout(() => {
        this.#logger.info('Max wait timer fired, forcing flush');
        this.flush();
      }, this.#options.maxWaitMs);
    }
  }

  /**
   * Synchronously flushes all pending updates.
   *
   * Coalesces updates, clears the queue, emits `updates_flushed`,
   * and returns the coalesced updates.
   */
  flush(): UpdateReason[] {
    this.#clearTimers();

    if (this.#pendingUpdates.length === 0) {
      return [];
    }

    const raw = [...this.#pendingUpdates];
    this.#pendingUpdates = [];

    const coalesced = this.#coalesce(raw);

    this.#logger.info(
      `Flushing ${coalesced.length} updates (from ${raw.length} raw)`,
    );

    this.#emitter.emit('updates_flushed', {
      updates: coalesced,
      rawCount: raw.length,
      timestamp: Date.now(),
    });

    return coalesced;
  }

  /**
   * Takes all pending updates (coalesced) without emitting events.
   *
   * Useful for the `processIntent` path where the orchestrator
   * handles request assembly directly.
   */
  takeCoalesced(): UpdateReason[] {
    if (this.#pendingUpdates.length === 0) {
      return [];
    }

    this.#clearTimers();
    const raw = [...this.#pendingUpdates];
    this.#pendingUpdates = [];

    const coalesced = this.#coalesce(raw);

    this.#logger.info(
      `Took ${coalesced.length} coalesced updates (from ${raw.length} raw)`,
    );

    return coalesced;
  }

  getPending(): UpdateReason[] {
    return [...this.#pendingUpdates];
  }

  hasPending(): boolean {
    return this.#pendingUpdates.length > 0;
  }

  get pendingCount(): number {
    return this.#pendingUpdates.length;
  }

  clear(): void {
    this.#clearTimers();
    const count = this.#pendingUpdates.length;
    if (count === 0) return;

    this.#pendingUpdates = [];
    this.#logger.info(`Cleared ${count} pending updates`);
  }

  dispose(): void {
    if (this.#emitter.disposed) return;

    this.#emitter.dispose();
    this.#clearTimers();
    this.#pendingUpdates = [];

    this.#logger.info('Disposed UpdateCoordinator');
  }

  // Output order: user_intents first (preserved in chronological order),
  // then the latest chart_resize, then merged vessel_mutations.
  // The engine processes updates sequentially, so intents go first to
  // establish context before layout/mutation side-effects apply.
  #coalesce(updates: UpdateReason[]): UpdateReason[] {
    const result: UpdateReason[] = [];
    let latestResize: UpdateReason | null = null;
    const vesselMutations = new Map<string, UpdateReason>();

    for (const update of updates) {
      switch (update.type) {
        case 'user_intent':
          result.push(update);
          break;
        case 'chart_resize':
          latestResize = update;
          break;
        case 'vessel_mutation': {
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

    if (latestResize) {
      result.push(latestResize);
    }
    for (const mutation of vesselMutations.values()) {
      result.push(mutation);
    }

    return result;
  }

  #clearTimers(): void {
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#maxWaitTimer) {
      clearTimeout(this.#maxWaitTimer);
      this.#maxWaitTimer = null;
    }
  }
}
