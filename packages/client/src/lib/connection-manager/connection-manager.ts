import { Store } from '@tanstack/store';

import { Logger } from '../utils/logger.js';
import type { EventSubscriber } from '../utils/typed-emitter.js';
import { TypedEmitter } from '../utils/typed-emitter.js';
import {
  type ConnectionManagerState,
  createInitialConnectionManagerState,
} from './connection-manager.state.js';
import {
  type ConnectionManagerOptions,
  type ConnectionOptions,
  DEFAULT_CONNECTION_OPTIONS,
} from './connection-manager.types.js';
import type {
  ConnectionStatus,
  EngineConnector,
  Unsubscribe,
} from './connector.types.js';

/**
 * Event payloads emitted by ConnectionManager.
 */
export type ConnectionManagerEvents = {
  connection_status_changed: {
    status: ConnectionStatus;
    previousStatus: ConnectionStatus;
  };
  connection_attempt: { attempt: number; maxAttempts: number };
  connection_error: { error: Error; attempt: number };
  circuit_opened: { resetAfterMs: number };
  circuit_closed: Record<string, never>;
  circuit_half_open: Record<string, never>;
};

/**
 * Manages connection lifecycle, retry logic, and circuit breaker patterns
 * for Maelstrom engine connections.
 *
 * Features:
 * - Owns its own TanStack Store for connection state
 * - TypedEmitter-based events exposed via `events: EventSubscriber`
 * - Exponential backoff retry logic with configurable options
 * - Circuit breaker pattern for fault tolerance
 * - Auto-reconnect on unexpected disconnections
 *
 * @example
 * ```ts
 * const manager = new ConnectionManager(connector, {
 *   maxRetries: 3,
 *   initialDelayMs: 1000,
 * });
 *
 * await manager.connect();
 * manager.events.on('connection_status_changed', (event) => {
 *   console.log(`Connection: ${event.status}`);
 * });
 * ```
 */
export class ConnectionManager {
  readonly store: Store<ConnectionManagerState>;
  readonly #emitter = new TypedEmitter<ConnectionManagerEvents>();
  readonly events: EventSubscriber<ConnectionManagerEvents> = this.#emitter;
  #connector: EngineConnector;
  #options: ConnectionOptions;
  /** Single unsubscribe for the connector's event stream. */
  #unsubscribeConnector: Unsubscribe | null = null;
  #sleepTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #circuitBreakerTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #isDisposed = false;
  #isIntentionalDisconnect = false;
  readonly #logger: Logger;

  constructor(
    connector: EngineConnector,
    options: ConnectionManagerOptions = {},
  ) {
    const { debug, initialState, ...connectionOptions } = options;
    this.store = new Store<ConnectionManagerState>(
      initialState ?? createInitialConnectionManagerState(),
    );
    this.#connector = connector;
    this.#options = { ...DEFAULT_CONNECTION_OPTIONS, ...connectionOptions };
    this.#logger = new Logger(debug ?? false, 'ConnectionManager');
  }

  /**
   * Establishes a connection to the engine with retry logic.
   *
   * If the circuit breaker is open, this will throw an error immediately.
   * Otherwise, it will attempt to connect with exponential backoff retry.
   */
  async connect(): Promise<void> {
    if (this.#isDisposed) {
      throw new Error('ConnectionManager has been disposed');
    }

    if (this.store.state.circuitBreakerStatus === 'open') {
      throw new Error('Circuit breaker is open');
    }

    this.#logger.info('Connecting...');
    this.#clearTimeouts();
    this.#isIntentionalDisconnect = false;

    await this.#connectWithRetries();
  }

  /**
   * Disconnects from the engine and cleans up connection state.
   */
  async disconnect(): Promise<void> {
    this.#logger.info('Disconnecting...');
    this.#isIntentionalDisconnect = true;
    this.#clearTimeouts();
    this.#cleanupConnectorSubscription();

    try {
      await this.#connector.disconnect();
    } catch {
      // Best-effort: update state to disconnected even if the connector
      // fails to close cleanly (e.g. transport already gone).
    }

    this.store.setState((state) => ({
      ...state,
      connectionStatus: 'disconnected',
      connectionRetryCount: 0,
      lastDisconnectedAt: Date.now(),
    }));
  }

  /**
   * Permanently disposes the ConnectionManager and releases all resources.
   * After disposal, the ConnectionManager cannot be reused.
   */
  async dispose(): Promise<void> {
    if (this.#isDisposed) return;

    this.#isDisposed = true;
    await this.disconnect();
    this.#emitter.dispose();
    this.#clearTimeouts();
    this.#logger.info('Disposed ConnectionManager');
  }

  async #connectWithRetries(): Promise<void> {
    const maxAttempts = this.#options.maxRetries;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxAttempts) {
      attempt++;

      if (attempt === 1) {
        this.#setConnectionStatus('connecting');
      }

      this.#logger.debug(`Connection attempt ${attempt}/${maxAttempts}`);

      this.#emitter.emit('connection_attempt', {
        attempt,
        maxAttempts,
      });

      try {
        await this.#connector.connect();

        this.#logger.info('Connected successfully');
        this.#setConnectionStatus('connected');
        this.#setupConnectorSubscription();

        this.store.setState((state) => ({
          ...state,
          connectionRetryCount: 0,
          circuitBreakerStatus: 'closed',
          connectionError: null,
          lastConnectedAt: Date.now(),
        }));

        this.#emitter.emit('circuit_closed', {} as Record<string, never>);

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        this.#logger.warn(
          `Connection attempt ${attempt}/${maxAttempts} failed:`,
          lastError.message,
        );

        this.#emitter.emit('connection_error', {
          error: lastError,
          attempt,
        });

        this.store.setState((state) => ({
          ...state,
          connectionRetryCount: attempt,
          connectionError: lastError,
        }));

        if (attempt < maxAttempts) {
          const delay = this.#calculateBackoffDelay(attempt);
          await this.#sleep(delay);
        }
      }
    }

    this.#logger.error(
      `All ${maxAttempts} connection attempts failed, opening circuit breaker`,
    );
    this.#setConnectionStatus('error');

    this.store.setState((state) => ({
      ...state,
      connectionError: lastError,
      circuitBreakerStatus: 'open',
    }));

    this.#emitter.emit('circuit_opened', {
      resetAfterMs: this.#options.circuitBreakerTimeoutMs,
    });

    this.#scheduleCircuitBreakerReset();

    throw lastError;
  }

  #setupConnectorSubscription(): void {
    this.#cleanupConnectorSubscription();

    this.#unsubscribeConnector = this.#connector.subscribe((event) => {
      switch (event.type) {
        case 'disconnected':
          this.#setConnectionStatus('disconnected');
          this.store.setState((state) => ({
            ...state,
            lastDisconnectedAt: Date.now(),
          }));
          if (!this.#isIntentionalDisconnect && !event.clean) {
            this.#logger.warn(
              'Unexpected disconnect, attempting auto-reconnect',
            );
            this.#handleAutoReconnect();
          }
          break;

        case 'error':
          this.#setConnectionStatus('error');
          this.store.setState((state) => ({
            ...state,
            connectionError: event.error,
          }));
          break;
      }
    });
  }

  #handleAutoReconnect(): void {
    if (this.#isDisposed) return;
    if (this.store.state.circuitBreakerStatus === 'open') {
      return;
    }

    const reconnectAttempt = this.store.state.connectionRetryCount + 1;
    if (reconnectAttempt > this.#options.maxRetries) {
      this.#setConnectionStatus('error');
      this.store.setState((state) => ({
        ...state,
        circuitBreakerStatus: 'open',
      }));
      this.#emitter.emit('circuit_opened', {
        resetAfterMs: this.#options.circuitBreakerTimeoutMs,
      });
      this.#scheduleCircuitBreakerReset();
      return;
    }

    this.store.setState((state) => ({
      ...state,
      connectionRetryCount: reconnectAttempt,
    }));

    const delay = this.#calculateBackoffDelay(reconnectAttempt);

    this.#reconnectTimeoutId = setTimeout(async () => {
      this.#setConnectionStatus('connecting');

      this.#emitter.emit('connection_attempt', {
        attempt: reconnectAttempt,
        maxAttempts: this.#options.maxRetries,
      });

      try {
        await this.#connector.connect();

        this.#setConnectionStatus('connected');
        this.#setupConnectorSubscription();

        this.store.setState((state) => ({
          ...state,
          connectionRetryCount: 0,
          circuitBreakerStatus: 'closed',
          connectionError: null,
          lastConnectedAt: Date.now(),
        }));

        this.#emitter.emit('circuit_closed', {} as Record<string, never>);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        this.#emitter.emit('connection_error', {
          error: err,
          attempt: reconnectAttempt,
        });

        this.store.setState((state) => ({
          ...state,
          connectionError: err,
        }));

        this.#handleAutoReconnect();
      }
    }, delay);
  }

  #cleanupConnectorSubscription(): void {
    this.#unsubscribeConnector?.();
    this.#unsubscribeConnector = null;
  }

  #calculateBackoffDelay(attempt: number): number {
    const exponentialDelay =
      this.#options.initialDelayMs *
      this.#options.backoffMultiplier ** (attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.#options.maxDelayMs);

    const jitteredDelay =
      Math.floor(cappedDelay / 2) +
      Math.floor(Math.random() * (cappedDelay / 2));

    return jitteredDelay;
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.#sleepTimeoutId = setTimeout(resolve, ms);
    });
  }

  #setConnectionStatus(status: ConnectionStatus): void {
    const previousStatus = this.store.state.connectionStatus;

    if (previousStatus === status) return;

    this.store.setState((s) => ({
      ...s,
      connectionStatus: status,
    }));

    this.#emitter.emit('connection_status_changed', {
      status: status,
      previousStatus: previousStatus,
    });
  }

  #scheduleCircuitBreakerReset(): void {
    this.#logger.debug(
      `Circuit breaker will reset in ${this.#options.circuitBreakerTimeoutMs}ms`,
    );
    this.#circuitBreakerTimeoutId = setTimeout(() => {
      if (this.store.state.circuitBreakerStatus === 'open') {
        this.#logger.info('Circuit breaker transitioning to half-open');
        this.store.setState((state) => ({
          ...state,
          circuitBreakerStatus: 'half_open',
        }));
        this.#emitter.emit('circuit_half_open', {} as Record<string, never>);
      }
    }, this.#options.circuitBreakerTimeoutMs);
  }

  #clearTimeouts(): void {
    if (this.#sleepTimeoutId) {
      clearTimeout(this.#sleepTimeoutId);
      this.#sleepTimeoutId = null;
    }
    if (this.#reconnectTimeoutId) {
      clearTimeout(this.#reconnectTimeoutId);
      this.#reconnectTimeoutId = null;
    }
    if (this.#circuitBreakerTimeoutId) {
      clearTimeout(this.#circuitBreakerTimeoutId);
      this.#circuitBreakerTimeoutId = null;
    }
  }
}
