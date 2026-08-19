import type {
  ChartRequestMessage,
  MaelstromResponse,
  MessageId,
} from '@maelstrom-co/protocol';
import { toError } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { EngineConnector } from '../connection-manager/connector.types.js';
import { Logger } from '../utils/logger.js';
import type { EventSubscriber } from '../utils/typed-emitter.js';
import { TypedEmitter } from '../utils/typed-emitter.js';
import type { RequestCoordinatorOptions } from './request-coordinator.types.js';

/** Observable state for the active request and latest successful response. */
export interface RequestCoordinatorState {
  /** Whether a connector request is currently in flight. */
  isProcessing: boolean;
  /** Latest successful Engine response, or `null` before one is received. */
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
  processing_started: { requestId: MessageId; timestamp: number };
  processing_completed: {
    requestId: MessageId;
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
  #connector: EngineConnector;
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

  /**
   * Point subsequent requests at a different connector. In-flight requests
   * are unaffected — the transport has no cancellation — so the caller is
   * responsible for discarding any response that arrives from the old one.
   *
   * @internal Intended to be driven only by `Orchestrator.setConnector`,
   * which is what keeps every copy of the connector reference in step.
   * Calling this directly leaves the Orchestrator's in-flight responses
   * unfenced, because its epoch will not have advanced.
   */
  setConnector(next: EngineConnector): void {
    this.#connector = next;
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
      const error = toError(err);
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

  /**
   * Returns a promise that settles when the next response arrives or the
   * next flush failure occurs. Use this to await an in-flight request when
   * `isProcessing` is true and you want to coalesce with it.
   *
   * Resolves to `null` rather than a response when the in-flight request it
   * was coalescing with turns out to have been superseded (see
   * {@link resolveFlushPromises}) — mirroring the `null` a caller already
   * gets back from `flushUpdates()` when there was nothing to report.
   */
  queueFlush(): Promise<MaelstromResponse | null> {
    return new Promise((resolve, reject) => {
      this.#flushResolvers.push({ resolve, reject });
    });
  }

  /**
   * Resolves all queued flush promises and clears the queue.
   *
   * Pass `null` when the request they were coalescing with was discarded
   * (e.g. fenced out by a connector swap) rather than actually applied —
   * resolving with the discarded response itself would hand callers a
   * layout that was never dispatched, and every fenced call site must
   * settle these promises somehow or they hang until an unrelated later
   * request happens to resolve them with an irrelevant response.
   */
  resolveFlushPromises(response: MaelstromResponse | null): void {
    for (const { resolve } of this.#flushResolvers) {
      resolve(response);
    }
    this.#flushResolvers = [];
  }

  /**
   * Rejects all queued flush promises and clears the queue. Called when a
   * flush fails before a response is available. The caller is responsible
   * for logging if the error has not already been logged upstream — this
   * method does not log.
   */
  rejectFlushPromises(error: Error): void {
    for (const { reject } of this.#flushResolvers) {
      reject(error);
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
