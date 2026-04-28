import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { EngineConnector } from '../connection-manager/connector.types.js';
import { Logger } from '../utils/logger.js';
import type { EventSubscriber } from '../utils/typed-emitter.js';
import { TypedEmitter } from '../utils/typed-emitter.js';
import type { RequestCoordinatorOptions } from './request-coordinator.types.js';

export interface RequestCoordinatorState {
  isProcessing: boolean;
  lastResponse: MaelstromResponse | null;
}

type FlushResolver = {
  resolve: (value: MaelstromResponse | null) => void;
  reject: (error: Error) => void;
};

/**
 * Event payloads emitted by RequestCoordinator.
 */
export type RequestCoordinatorEvents = {
  processing_started: { requestId: string; timestamp: number };
  processing_completed: {
    requestId: string;
    response: MaelstromResponse;
    durationMs: number;
    timestamp: number;
  };
  error: { error: Error; timestamp: number };
};

/**
 * Manages the request lifecycle: sending requests, tracking in-flight state,
 * emitting processing events, and coordinating flush promises.
 *
 * @example
 * ```ts
 * const coordinator = new RequestCoordinator(connector);
 * coordinator.events.on('processing_completed', (e) => console.log(`Done in ${e.durationMs}ms`));
 *
 * const response = await coordinator.send(envelope);
 * ```
 */
export class RequestCoordinator {
  readonly #connector: EngineConnector;
  readonly #emitter = new TypedEmitter<RequestCoordinatorEvents>();
  readonly events: EventSubscriber<RequestCoordinatorEvents> = this.#emitter;
  readonly #logger: Logger;
  readonly store: Store<RequestCoordinatorState>;

  #flushResolvers: FlushResolver[] = [];
  #isDisposed = false;

  constructor(
    connector: EngineConnector,
    options: RequestCoordinatorOptions = {},
  ) {
    this.#connector = connector;
    this.#logger = new Logger(options.debug ?? false, 'RequestCoordinator');
    this.store = new Store<RequestCoordinatorState>({
      isProcessing: false,
      lastResponse: null,
    });
  }

  get isProcessing(): boolean {
    return this.store.state.isProcessing;
  }

  get lastResponse(): MaelstromResponse | null {
    return this.store.state.lastResponse;
  }

  async send(message: ChartRequestMessage): Promise<MaelstromResponse> {
    if (this.#isDisposed) throw new Error('RequestCoordinator is disposed');
    const requestId = message.id;
    this.store.setState((s) => ({ ...s, isProcessing: true }));
    const startTime = performance.now();

    this.#emitter.emit('processing_started', {
      requestId,
      timestamp: startTime,
    });

    try {
      this.#logger.info(`Sending request ${requestId}`);
      const response = await this.#connector.process(message);
      this.#logger.info(`Received response for ${requestId}`);

      this.store.setState((s) => ({ ...s, lastResponse: response }));

      this.#emitter.emit('processing_completed', {
        requestId,
        response,
        durationMs: performance.now() - startTime,
        timestamp: performance.now(),
      });

      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#logger.error(`Request ${requestId} failed: ${error.message}`);

      this.#emitter.emit('error', {
        error,
        timestamp: performance.now(),
      });

      throw error;
    } finally {
      this.store.setState((s) => ({ ...s, isProcessing: false }));
    }
  }

  queueFlush(): Promise<MaelstromResponse | null> {
    return new Promise((resolve, reject) => {
      this.#flushResolvers.push({ resolve, reject });
    });
  }

  resolveFlushPromises(response: MaelstromResponse): void {
    for (const { resolve } of this.#flushResolvers) {
      resolve(response);
    }
    this.#flushResolvers = [];
  }

  dispose(): void {
    if (this.#isDisposed) return;

    this.#isDisposed = true;

    for (const { reject } of this.#flushResolvers) {
      reject(new Error('RequestCoordinator disposed'));
    }
    this.#flushResolvers = [];

    this.#emitter.dispose();
    this.#logger.info('Disposed RequestCoordinator');
  }
}
