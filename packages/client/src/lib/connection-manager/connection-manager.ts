import type { SessionId } from '@maelstrom-co/protocol';
import { toError } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';
import type { Unsubscribe } from '../types.js';
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
import type { ConnectionStatus, EngineConnector } from './connector.types.js';

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
  /**
   * The breaker opened. `resetAfterMs` is when the half-open probe is due —
   * unless `terminal` is true, in which case no probe is scheduled and
   * `resetAfterMs` is not honoured.
   *
   * `terminal` means the server refused this client outright (a
   * `retryable: false` disconnect, e.g. RFC 6455 close code 1008), so
   * reconnecting on the same session cannot succeed and would only add load.
   * Recovery there is an explicit user action — typically a reload, which
   * mints a fresh session — not a timer.
   */
  circuit_opened: { resetAfterMs: number; terminal?: boolean };
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
  // Object identity can return after a swap; attempts belong to a binding generation.
  #connectorGeneration = 0;
  readonly #pendingDisconnects = new Map<EngineConnector, Promise<void>>();
  // Required<ConnectionOptions>, not the public ConnectionOptions: every field
  // is guaranteed populated by the DEFAULT_CONNECTION_OPTIONS merge below, and
  // the class body should see that guarantee in the type rather than treating
  // an optional public field (e.g. stabilityThresholdMs) as possibly absent.
  #options: Required<ConnectionOptions>;
  #sessionId: SessionId;
  /** Single unsubscribe for the connector's event stream. */
  #unsubscribeConnector: Unsubscribe | null = null;
  #sleepTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #circuitBreakerTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #stabilityTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #isDisposed = false;
  #isIntentionalDisconnect = false;
  readonly #logger: Logger;

  constructor(connector: EngineConnector, options: ConnectionManagerOptions) {
    const { debug, initialState, sessionId, ...connectionOptions } = options;
    this.store = new Store<ConnectionManagerState>(
      initialState ?? createInitialConnectionManagerState(),
    );
    this.#connector = connector;
    this.#sessionId = sessionId;
    this.#options = { ...DEFAULT_CONNECTION_OPTIONS, ...connectionOptions };
    this.#logger = new Logger(debug ?? false, 'ConnectionManager');
  }

  /**
   * Establishes a connection to the engine with retry logic.
   *
   * If the circuit breaker is open, this will throw an error immediately.
   * Otherwise, it will attempt to connect with exponential backoff retry.
   *
   * Startup waits for this Connector's pending shutdowns owned by this manager.
   * Superseded or disposed attempts do not dial after that wait.
   *
   * This is the deliberate, user-initiated entry point, so it always starts
   * with a full `maxRetries` budget: `connectionRetryCount` is reset to 0
   * here regardless of what a previous connect/disconnect cycle left behind.
   * (The automatic-reconnect path is different — it only resets the count
   * after a connection survives `stabilityThresholdMs`, so a server that
   * accepts-then-immediately-closes still exhausts the budget. That delayed
   * reset is unaffected by this one.)
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
    this.store.setState((state) => ({
      ...state,
      connectionRetryCount: 0,
    }));

    await this.#connectWithRetries();
  }

  /**
   * Disconnects from the engine and cleans up connection state.
   */
  async disconnect(): Promise<void> {
    const connector = this.#connector;
    const generation = ++this.#connectorGeneration;
    this.#logger.info('Disconnecting...');
    this.#isIntentionalDisconnect = true;
    this.#clearTimeouts();
    this.#cleanupConnectorSubscription();

    await this.#disconnectConnector(connector, 'Connector disconnect failed');

    if (generation !== this.#connectorGeneration) return;
    this.store.setState((state) => ({
      ...state,
      connectionStatus: 'disconnected',
      connectionRetryCount: 0,
      lastDisconnectedAt: Date.now(),
    }));
  }

  /**
   * Point subsequent connection work at a different connector. Circuit-breaker
   * and retry state deliberately carry across the swap: the breaker tracks the
   * health of the engine behind the connector, not the connector object, and a
   * re-auth does not make a failing engine healthy.
   *
   * Severing the outgoing connector is unconditional and happens in every
   * state: its event subscription is torn down and it is best-effort
   * disconnected. A swap means this manager no longer speaks to it, so it
   * must no longer be able to drive `connectionStatus` / `connectionError`,
   * and its socket must not be left open. `error` and `disconnected` are not
   * exceptions — both are reachable with a live subscription (a connector
   * `error` event, or an unclean `disconnected` whose auto-reconnect is still
   * sitting in backoff).
   *
   * Redialing is what varies. When the manager was `connected`, mid-dial
   * (`connecting` — an initial `connect()`, an auto-reconnect attempt, or a
   * half-open probe all leave it in this state), or had an auto-reconnect
   * armed and waiting out its backoff, the incoming connector is driven
   * through the same connect-with-retries path `connect()` uses — so the
   * subscription lands on it as a side effect of that connect, and
   * `connectionStatus` transitions honestly (`connecting` →
   * `connected`/`error`) instead of holding a value that describes a socket
   * nobody has opened. The armed reconnect counts because cancelling it
   * without redialing would strand the manager: it was going to reconnect,
   * and after the swap nothing ever would. Any dial already in flight is
   * fenced at its own call site (the connector capture in
   * `#connectWithRetries`, `#handleAutoReconnect`, and
   * `#attemptHalfOpenProbe`): its eventual settlement is a no-op once this
   * has moved `#connector` on.
   *
   * Outgoing shutdowns remain tracked even while idle. Reusing the same
   * Connector waits for those shutdowns before starting another connection.
   *
   * Otherwise — a genuinely idle manager, with nothing connected, no dial in
   * flight and no reconnect armed — the swap severs and stops there;
   * `connect()` remains the caller's own explicit trigger.
   *
   * This runs from a React effect and must never throw into render: a
   * failure surfaces the same way any other connect failure does — through
   * `connectionStatus`, `connectionError`, and the `connection_error` /
   * `circuit_opened` events — not as a rejected call.
   *
   * @internal Intended to be driven only by `Orchestrator.setConnector`,
   * which is what keeps every copy of the connector reference in step.
   * Calling this directly leaves the Orchestrator's in-flight responses
   * unfenced, because its epoch will not have advanced.
   */
  setConnector(next: EngineConnector): void {
    if (this.#isDisposed) return;
    if (Object.is(next, this.#connector)) return;
    const previous = this.#connector;
    const status = this.store.state.connectionStatus;
    // Read before the timeout is cleared below.
    const shouldRedial =
      status === 'connected' ||
      status === 'connecting' ||
      this.#reconnectTimeoutId !== null;
    this.#connector = next;
    const generation = ++this.#connectorGeneration;

    this.#cleanupConnectorSubscription();
    void this.#disconnectConnector(
      previous,
      'Outgoing connector disconnect failed',
    );
    if (!this.#isCurrentConnector(next, generation)) return;

    // Deliberately not #clearTimeouts(): that also kills the circuit-breaker
    // timer, and the breaker's state carries across the swap — clearing it
    // would strand an open breaker with no half-open probe ever due.
    if (this.#reconnectTimeoutId) {
      clearTimeout(this.#reconnectTimeoutId);
      this.#reconnectTimeoutId = null;
    }

    if (!shouldRedial) return;

    this.#connectWithRetries().catch(() => {
      // Failure is already recorded on the store and emitted via events
      // inside #connectWithRetries; swallow here so this fire-and-forget
      // call (setConnector must not throw into a React effect) doesn't
      // surface as an unhandled rejection.
    });
  }

  /**
   * Permanently disposes the ConnectionManager and releases all resources.
   * Waits for current and outgoing Connector shutdowns.
   * After disposal, the ConnectionManager cannot be reused.
   */
  async dispose(): Promise<void> {
    if (this.#isDisposed) return;

    this.#isDisposed = true;
    await this.disconnect();
    await Promise.all(this.#pendingDisconnects.values());
    this.#emitter.dispose();
    this.#clearTimeouts();
    this.#logger.info('Disposed ConnectionManager');
  }

  #disconnectConnector(
    connector: EngineConnector,
    failureMessage: string,
  ): Promise<void> {
    let complete!: () => void;
    const current = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const pending = Promise.all([
      this.#pendingDisconnects.get(connector),
      current,
    ]).then(() => undefined);
    // Register before invoking the Connector, which can call back synchronously.
    this.#pendingDisconnects.set(connector, pending);
    void (async () => {
      try {
        await connector.disconnect();
      } catch (error) {
        this.#logger.warn(failureMessage, error);
      } finally {
        complete();
      }
    })();
    void pending.then(() => {
      if (this.#pendingDisconnects.get(connector) === pending)
        this.#pendingDisconnects.delete(connector);
    });
    return pending;
  }

  #isCurrentConnector(connector: EngineConnector, generation: number): boolean {
    return (
      !this.#isDisposed &&
      generation === this.#connectorGeneration &&
      Object.is(connector, this.#connector)
    );
  }

  async #connectConnector(
    connector: EngineConnector,
    generation: number,
  ): Promise<boolean> {
    const pending = this.#pendingDisconnects.get(connector);
    if (pending) await pending;
    if (!this.#isCurrentConnector(connector, generation)) return false;
    await connector.connect(this.#sessionId);
    return true;
  }

  async #connectWithRetries(): Promise<void> {
    const maxAttempts = this.#options.maxRetries;
    let attempt = 0;
    let lastError: Error | null = null;

    // Captured once per INVOCATION, not per attempt. setConnector can move
    // `#connector` on at any suspension point below — mid-dial or mid-backoff
    // — and starts its own loop for the incoming connector, so every await
    // re-checks this capture to keep exactly one loop per connector. Reading
    // the field back instead would let a superseded loop dial the connector
    // the swap already owns, concurrently with that swap's own loop.
    const connector = this.#connector;
    const generation = this.#connectorGeneration;

    while (attempt < maxAttempts) {
      attempt++;

      if (attempt === 1) {
        this.#setConnectionStatus('connecting');
        if (!this.#isCurrentConnector(connector, generation)) return;
      }

      this.#logger.debug(`Connection attempt ${attempt}/${maxAttempts}`);

      this.#emitter.emit('connection_attempt', {
        attempt,
        maxAttempts,
      });
      if (!this.#isCurrentConnector(connector, generation)) return;

      try {
        if (!(await this.#connectConnector(connector, generation))) return;
        if (!this.#isCurrentConnector(connector, generation)) return; // superseded mid-dial

        this.#logger.info('Connected successfully');
        this.#setConnectionStatus('connected');
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#setupConnectorSubscription(connector, generation);
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.store.setState((state) => ({
          ...state,
          circuitBreakerStatus: 'closed',
          connectionError: null,
          lastConnectedAt: Date.now(),
        }));
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.#emitter.emit('circuit_closed', {} as Record<string, never>);
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#scheduleStabilityReset();

        return;
      } catch (error) {
        // Checked FIRST — before any emit or store write, and returning (not
        // breaking) out of the whole loop. A failure on a superseded
        // connector must not describe itself on the store, and must not fall
        // through to the circuit-breaker-opening tail below, which would
        // stomp a dial that may be seconds from succeeding — or already has.
        if (!this.#isCurrentConnector(connector, generation)) {
          this.#logger.debug(
            'Connection attempt failed on a superseded connector; abandoning this retry loop',
          );
          return;
        }

        lastError = toError(error);

        this.#logger.warn(
          `Connection attempt ${attempt}/${maxAttempts} failed:`,
          lastError.message,
        );

        this.#emitter.emit('connection_error', {
          error: lastError,
          attempt,
        });
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.store.setState((state) => ({
          ...state,
          connectionRetryCount: attempt,
          connectionError: lastError,
        }));
        if (!this.#isCurrentConnector(connector, generation)) return;

        if (attempt < maxAttempts) {
          const delay = this.#calculateBackoffDelay(attempt);
          await this.#sleep(delay);
          // The backoff sleep is the widest suspension point of all — a
          // re-auth swap lands here, not mid-dial, in the case this whole
          // seam exists for.
          if (!this.#isCurrentConnector(connector, generation)) {
            this.#logger.debug(
              'Connector superseded during backoff; abandoning this retry loop',
            );
            return;
          }
        }
      }
    }

    this.#logger.error(
      `All ${maxAttempts} connection attempts failed, opening circuit breaker`,
    );
    this.#setConnectionStatus('error');
    if (!this.#isCurrentConnector(connector, generation)) return;

    this.store.setState((state) => ({
      ...state,
      connectionError: lastError,
      circuitBreakerStatus: 'open',
    }));
    this.#publishCircuitOpen();

    throw lastError;
  }

  #setupConnectorSubscription(
    connector: EngineConnector,
    generation: number,
  ): void {
    this.#cleanupConnectorSubscription();
    if (!this.#isCurrentConnector(connector, generation)) return;
    const unsubscribe = connector.subscribe((event) => {
      if (!this.#isCurrentConnector(connector, generation)) return;
      switch (event.type) {
        case 'disconnected': {
          // A connection that dies before proving stable must not have
          // already reset the retry budget out from under it — cancel any
          // pending reset before deciding what to do next.
          this.#cancelStabilityReset();
          this.#setConnectionStatus('disconnected');
          if (!this.#isCurrentConnector(connector, generation)) return;
          this.store.setState((state) => ({
            ...state,
            lastDisconnectedAt: Date.now(),
          }));
          if (!this.#isCurrentConnector(connector, generation)) return;
          if (this.#isIntentionalDisconnect) break;

          if (event.retryable === false) {
            // The connector has already determined retrying is pointless
            // (e.g. RFC 6455 close code 1008 — the server is rejecting this
            // client outright). Skip the retry budget entirely and open the
            // breaker permanently.
            //
            // Deliberately does NOT schedule a reset: that would arm the
            // half-open probe, and a probe here reconnects into the same
            // refusal — re-sending the handshake against a server that just
            // said "do not come back", getting closed again, reopening, and
            // probing again forever. A slow loop is still a loop, and it is
            // exactly the load the refusal exists to shed. The other open
            // paths (retry budget exhausted, probe failed) DO schedule one,
            // because those close for reasons that clear on their own.
            this.#logger.warn(
              'Non-retryable disconnect, opening circuit breaker permanently',
              event.message,
            );
            this.#setConnectionStatus('error');
            if (!this.#isCurrentConnector(connector, generation)) return;
            this.store.setState((state) => ({
              ...state,
              connectionError: new Error(event.message),
              circuitBreakerStatus: 'open',
            }));
            this.#publishCircuitOpen(true);
            break;
          }

          if (!event.clean) {
            this.#logger.warn(
              'Unexpected disconnect, attempting auto-reconnect',
            );
            this.#handleAutoReconnect();
          }
          break;
        }

        case 'error':
          this.#setConnectionStatus('error');
          if (!this.#isCurrentConnector(connector, generation)) return;
          this.store.setState((state) => ({
            ...state,
            connectionError: event.error,
          }));
          if (!this.#isCurrentConnector(connector, generation)) return;
          break;
      }
    });
    if (this.#isCurrentConnector(connector, generation))
      this.#unsubscribeConnector = unsubscribe;
    else unsubscribe();
  }

  #handleAutoReconnect(): void {
    if (this.#isDisposed) return;
    if (this.store.state.circuitBreakerStatus === 'open') {
      return;
    }

    const connector = this.#connector;
    const generation = this.#connectorGeneration;
    const reconnectAttempt = this.store.state.connectionRetryCount + 1;
    if (reconnectAttempt > this.#options.maxRetries) {
      this.#setConnectionStatus('error');
      if (!this.#isCurrentConnector(connector, generation)) return;
      this.store.setState((state) => ({
        ...state,
        circuitBreakerStatus: 'open',
      }));
      this.#publishCircuitOpen();
      return;
    }

    this.store.setState((state) => ({
      ...state,
      connectionRetryCount: reconnectAttempt,
    }));
    if (!this.#isCurrentConnector(connector, generation)) return;

    const delay = this.#calculateBackoffDelay(reconnectAttempt);

    if (!this.#isCurrentConnector(connector, generation)) return;
    this.#reconnectTimeoutId = setTimeout(async () => {
      if (!this.#isCurrentConnector(connector, generation)) return;
      this.#setConnectionStatus('connecting');
      if (!this.#isCurrentConnector(connector, generation)) return;

      this.#emitter.emit('connection_attempt', {
        attempt: reconnectAttempt,
        maxAttempts: this.#options.maxRetries,
      });
      if (!this.#isCurrentConnector(connector, generation)) return;

      // Captured per attempt, not read back through the field — same reason
      // as #connectWithRetries: setConnector can move `#connector` on while
      // this timer's own dial is in flight (it redials during 'connecting',
      // which this timer itself just set), and a belated success from the
      // connector THIS attempt actually dialed must not be attributed to
      // whatever connector the field points at by the time it settles.
      try {
        if (!(await this.#connectConnector(connector, generation))) return;
        if (!this.#isCurrentConnector(connector, generation)) return; // superseded mid-dial

        this.#setConnectionStatus('connected');
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#setupConnectorSubscription(connector, generation);
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.store.setState((state) => ({
          ...state,
          circuitBreakerStatus: 'closed',
          connectionError: null,
          lastConnectedAt: Date.now(),
        }));
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.#emitter.emit('circuit_closed', {} as Record<string, never>);
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#scheduleStabilityReset();
      } catch (error) {
        // Same supersession guard as the success branch: a failure from a
        // connector setConnector has already moved past must not schedule
        // yet another reconnect cycle (or record its error) against a
        // manager that has moved on to dialing something else entirely.
        if (!this.#isCurrentConnector(connector, generation)) return;

        const err = toError(error);

        this.#emitter.emit('connection_error', {
          error: err,
          attempt: reconnectAttempt,
        });
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.store.setState((state) => ({
          ...state,
          connectionError: err,
        }));
        if (!this.#isCurrentConnector(connector, generation)) return;

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
    const generation = this.#connectorGeneration;

    if (previousStatus === status) return;

    this.store.setState((s) => ({
      ...s,
      connectionStatus: status,
    }));

    if (
      generation !== this.#connectorGeneration ||
      this.store.state.connectionStatus !== status
    )
      return;
    this.#emitter.emit('connection_status_changed', {
      status: status,
      previousStatus: previousStatus,
    });
  }

  /**
   * Schedules the retry budget reset once the connection has stayed up for
   * `stabilityThresholdMs` without dropping. Called on every successful
   * connect (initial or reconnect); `#cancelStabilityReset` is called first
   * to guarantee at most one pending reset regardless of how many times a
   * connection cycles through connect/disconnect.
   */
  #scheduleStabilityReset(): void {
    this.#cancelStabilityReset();
    this.#stabilityTimeoutId = setTimeout(() => {
      this.#stabilityTimeoutId = null;
      this.store.setState((state) => ({
        ...state,
        connectionRetryCount: 0,
      }));
    }, this.#options.stabilityThresholdMs);
  }

  #cancelStabilityReset(): void {
    if (this.#stabilityTimeoutId) {
      clearTimeout(this.#stabilityTimeoutId);
      this.#stabilityTimeoutId = null;
    }
  }

  // Committed engine health survives Connector replacement; attempt state does not.
  #publishCircuitOpen(terminal = false): void {
    if (this.#isDisposed || this.store.state.circuitBreakerStatus !== 'open')
      return;
    this.#emitter.emit('circuit_opened', {
      resetAfterMs: this.#options.circuitBreakerTimeoutMs,
      ...(terminal ? { terminal: true } : {}),
    });
    if (!terminal) this.#scheduleCircuitBreakerReset();
  }

  #scheduleCircuitBreakerReset(): void {
    if (
      this.#isDisposed ||
      this.#isIntentionalDisconnect ||
      this.store.state.circuitBreakerStatus !== 'open'
    )
      return;
    // Guards against leaking a previous timer if this is called more than
    // once while the breaker is already open (e.g. two non-retryable
    // disconnects back to back).
    if (this.#circuitBreakerTimeoutId) {
      clearTimeout(this.#circuitBreakerTimeoutId);
    }
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
        this.#attemptHalfOpenProbe();
      }
    }, this.#options.circuitBreakerTimeoutMs);
  }

  /**
   * Half-open exists to mean "try again now" — nothing outside this class
   * ever subscribes to `circuit_half_open` to drive that retry (there is no
   * such subscriber anywhere in the codebase, and `provider.tsx` calls
   * `connect()` exactly once, on mount), so without this the breaker opening
   * once is terminal: the UI sticks on `error` until a manual page reload.
   * This makes the transition self-driving — a single probe connection,
   * closing the breaker on success or reopening (and rescheduling another
   * `circuitBreakerTimeoutMs`-later probe) on failure — so the breaker
   * behaves like backoff rather than a dead end.
   */
  #attemptHalfOpenProbe(): void {
    if (this.#isDisposed) return;
    const connector = this.#connector;
    const generation = this.#connectorGeneration;

    this.#setConnectionStatus('connecting');
    if (!this.#isCurrentConnector(connector, generation)) return;
    this.#emitter.emit('connection_attempt', { attempt: 1, maxAttempts: 1 });
    if (!this.#isCurrentConnector(connector, generation)) return;

    // Captured before dialing, not read back through the field — same
    // reason as #connectWithRetries and #handleAutoReconnect: setConnector
    // can move `#connector` on while this probe's own dial is in flight (it
    // redials during 'connecting', which this probe itself just set), and a
    // belated settlement must not be attributed to whatever connector the
    // field points at by the time it lands.
    this.#connectConnector(connector, generation)
      .then((connected) => {
        if (!connected) return;
        // The probe outlives a dispose() that lands mid-flight: the guard at
        // the top of this method only covers the synchronous entry. Without
        // this, a late success re-subscribes to the connector and arms a
        // stability timer on a manager whose dispose() has already run its
        // cleanup, so neither is ever torn down.
        if (this.#isDisposed) return;
        if (!this.#isCurrentConnector(connector, generation)) return; // superseded mid-dial

        this.#logger.info('Half-open probe succeeded, closing circuit');
        this.#setConnectionStatus('connected');
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#setupConnectorSubscription(connector, generation);
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.store.setState((state) => ({
          ...state,
          circuitBreakerStatus: 'closed',
          connectionError: null,
          lastConnectedAt: Date.now(),
        }));
        if (!this.#isCurrentConnector(connector, generation)) return;

        this.#emitter.emit('circuit_closed', {} as Record<string, never>);
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#scheduleStabilityReset();
      })
      .catch((error: unknown) => {
        // Same reason as the success path: a late failure would otherwise
        // reschedule the next probe indefinitely on a disposed manager.
        if (this.#isDisposed) return;
        // A failure from a connector setConnector has already moved past
        // must not reopen the breaker (or schedule yet another probe cycle)
        // against a manager that may already be happily connected through
        // whatever it swapped to.
        if (!this.#isCurrentConnector(connector, generation)) return;

        const err = toError(error);
        this.#logger.warn(
          'Half-open probe failed, reopening circuit',
          err.message,
        );

        this.#emitter.emit('connection_error', { error: err, attempt: 1 });
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.#setConnectionStatus('error');
        if (!this.#isCurrentConnector(connector, generation)) return;
        this.store.setState((state) => ({
          ...state,
          connectionError: err,
          circuitBreakerStatus: 'open',
        }));
        this.#publishCircuitOpen();
      });
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
    this.#cancelStabilityReset();
  }
}
