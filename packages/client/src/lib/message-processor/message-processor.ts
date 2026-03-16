import { Store } from '@tanstack/store';

import type { MaelstromResponse } from '@maelstrom-co/protocol-old';

import { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import { ActionManager } from './action-manager.js';
import { applyLayout } from './layout-manager.js';
import { createInitialMessageProcessingState } from './message-processor.state.js';
import type { MessageProcessorOptions } from './message-processor.types.js';
import type { MessageProcessingState } from './types.js';

/**
 * Event map for MessageProcessor lifecycle events.
 */
export type MessageProcessorEvents = {
  message_start: { message: MaelstromResponse; timestamp: number };
  message_complete: {
    message: MaelstromResponse;
    duration: number;
    timestamp: number;
  };
  processing_error: {
    message: MaelstromResponse;
    error: Error;
    timestamp: number;
  };
};

/**
 * Processes incoming Maelstrom server responses through a sequential event loop.
 *
 * Each message goes through layout application then action execution.
 * Messages received during processing are queued and processed in order.
 *
 * @example
 * ```ts
 * const processor = new MessageProcessor({ debug: true });
 *
 * processor.events.on('message_complete', (event) => {
 *   console.log(`Processed in ${event.duration}ms`);
 * });
 *
 * processor.processMessage(response);
 * ```
 */
export class MessageProcessor {
  readonly store: Store<MessageProcessingState>;
  readonly #emitter = new TypedEmitter<MessageProcessorEvents>();
  readonly events: EventSubscriber<MessageProcessorEvents> = this.#emitter;
  readonly #actionManager: ActionManager;
  readonly #logger: Logger;
  #messageQueue: MaelstromResponse[] = [];
  #idleResolvers: Set<() => void> = new Set();

  constructor(options: MessageProcessorOptions = {}) {
    const initialState =
      options.initialState ?? createInitialMessageProcessingState();
    this.store = new Store<MessageProcessingState>(initialState);
    this.#logger = new Logger(options.debug ?? false, 'MessageProcessor');
    this.#actionManager = new ActionManager({
      logger: this.#logger,
      defaultTimeoutMs: options.defaultActionWaitTimeoutMs,
    });
  }

  get queueLength(): number {
    return this.#messageQueue.length;
  }

  getActionManager(): ActionManager {
    return this.#actionManager;
  }

  /**
   * Returns a promise that resolves when the processor is idle
   * and the message queue is empty.
   *
   * Resolves immediately if already idle.
   */
  waitForIdle(): Promise<void> {
    if (this.store.state.status === 'idle' && this.#messageQueue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const cleanup = () => {
        unsub();
        this.#idleResolvers.delete(resolve);
      };
      const unsub = this.store.subscribe(() => {
        if (
          this.store.state.status === 'idle' &&
          this.#messageQueue.length === 0
        ) {
          cleanup();
          resolve();
        }
      });
      this.#idleResolvers.add(resolve);
    });
  }

  processMessage(message: MaelstromResponse): void {
    if (this.#emitter.disposed) {
      throw new Error('MessageProcessor is disposed');
    }

    if (this.store.state.status !== 'idle') {
      this.#messageQueue.push(message);
      return;
    }

    void this.#runEventLoop(message);
  }

  dispose(): void {
    if (this.#emitter.disposed) return;

    this.#emitter.dispose();
    this.#messageQueue = [];

    // Resolve any pending waitForIdle promises so they don't hang
    for (const resolve of this.#idleResolvers) {
      resolve();
    }
    this.#idleResolvers.clear();
  }

  async #runEventLoop(firstMessage: MaelstromResponse): Promise<void> {
    let currentMessage: MaelstromResponse | null = firstMessage;

    while (currentMessage) {
      const startTime = performance.now();

      this.#logger.info(`Processing message ${currentMessage.requestId}`);

      try {
        await this.#processSingleMessage(currentMessage, startTime);
      } catch (error) {
        this.#logger.error('Error processing message:', error);
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
        this.store.setState((state) => ({
          ...state,
          status: 'error' as const,
          lastError: errorObj,
        }));

        this.#emitter.emit('processing_error', {
          message: currentMessage,
          error: errorObj,
          timestamp: performance.now(),
        });

        this.#emitter.emit('message_complete', {
          message: currentMessage,
          duration: performance.now() - startTime,
          timestamp: performance.now(),
        });
      }

      currentMessage = this.#dequeueNext();
    }
  }

  async #processSingleMessage(
    message: MaelstromResponse,
    startTime: number,
  ): Promise<void> {
    this.store.setState((state) => ({
      ...state,
      status: 'processing' as const,
      layout: message.layout,
      lastError: null,
    }));

    this.#emitter.emit('message_start', {
      message,
      timestamp: performance.now(),
    });

    // Phase 1: Apply layout
    const newInstances = applyLayout(
      message.layout,
      this.store.state.instances,
    );
    this.store.setState((s) => ({ ...s, instances: newInstances }));

    // Phase 2: Execute actions
    await this.#actionManager.executeActions(message.executionPlan);

    this.#emitter.emit('message_complete', {
      message,
      duration: performance.now() - startTime,
      timestamp: performance.now(),
    });
  }

  #dequeueNext(): MaelstromResponse | null {
    if (this.#messageQueue.length > 0) {
      return this.#messageQueue.shift() ?? null;
    }

    this.store.setState((state) => ({
      ...state,
      status: 'idle' as const,
    }));

    return null;
  }
}
