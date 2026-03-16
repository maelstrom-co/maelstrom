import { Store } from '@tanstack/store';

import type {
  ChartDimensions,
  ChartResizeReason,
} from '@maelstrom-co/protocol-old';

import { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import {
  type ChartManagerState,
  createInitialChartManagerState,
} from './chart-manager.state.js';
import type { ChartManagerOptions } from './chart-manager.types.js';

/**
 * Event map for ChartManager lifecycle events.
 */
export type ChartManagerEvents = {
  dimensions_changed: {
    previous: ChartDimensions;
    current: ChartDimensions;
    resize: ChartResizeReason;
    timestamp: number;
  };
};

/**
 * Manages chart dimensions and resize coordination.
 *
 * Creates and owns its own store. Tracks the current chart dimensions
 * and buffers pending resize update reasons for the orchestrator to consume.
 *
 * @example
 * ```ts
 * const manager = new ChartManager();
 *
 * manager.events.on('dimensions_changed', (event) => {
 *   console.log(`Resized: ${event.previous} → ${event.current}`);
 * });
 *
 * manager.setDimensions({ columns: 6, rows: 4 });
 * ```
 */
export class ChartManager {
  readonly store: Store<ChartManagerState>;
  readonly #emitter = new TypedEmitter<ChartManagerEvents>();
  readonly events: EventSubscriber<ChartManagerEvents> = this.#emitter;
  readonly #logger: Logger;
  #previousDimensions: ChartDimensions;
  #pendingResize: ChartResizeReason | null = null;

  /**
   * Creates a new ChartManager instance.
   *
   * @param options - Optional configuration
   */
  constructor(options: ChartManagerOptions = {}) {
    const initialState =
      options.initialState ?? createInitialChartManagerState();
    this.store = new Store<ChartManagerState>(initialState);
    this.#logger = new Logger(options.debug ?? false, 'ChartManager');
    this.#previousDimensions = this.store.state.chartDimensions;
  }

  /**
   * Returns the current chart dimensions.
   */
  getDimensions(): ChartDimensions {
    return this.store.state.chartDimensions;
  }

  /**
   * Updates the chart dimensions in the store.
   *
   * If the dimensions have actually changed, a `dimensions_changed` event
   * is emitted and a pending resize update reason is buffered.
   *
   * @param dimensions - The new chart dimensions
   */
  setDimensions(dimensions: ChartDimensions): void {
    if (this.#emitter.disposed) {
      throw new Error('ChartManager is disposed');
    }

    const previous = this.#previousDimensions;

    if (
      previous.columns === dimensions.columns &&
      previous.rows === dimensions.rows
    ) {
      return;
    }

    this.store.setState((state) => ({
      ...state,
      chartDimensions: dimensions,
    }));

    const resize: ChartResizeReason = {
      type: 'chart_resize',
      previous,
      current: dimensions,
    };

    this.#pendingResize = resize;
    this.#previousDimensions = dimensions;

    this.#logger.info(
      `Dimensions: ${previous.columns}x${previous.rows} → ${dimensions.columns}x${dimensions.rows}`,
    );

    this.#emitter.emit('dimensions_changed', {
      previous,
      current: dimensions,
      resize,
      timestamp: performance.now(),
    });
  }

  /**
   * Returns the pending resize update reason, or null if none.
   */
  getPendingResize(): ChartResizeReason | null {
    return this.#pendingResize;
  }

  /**
   * Clears the pending resize update reason.
   */
  clearPendingResize(): void {
    this.#pendingResize = null;
  }

  /**
   * Permanently disposes the ChartManager and releases all resources.
   */
  dispose(): void {
    this.#emitter.dispose();
    this.#logger.info('Disposed ChartManager');
  }
}
