import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import type { Unsubscribe } from '../types.js';
import type { ConnectionManagerEvents } from './connection-manager.js';
import { ConnectionManager } from './connection-manager.js';
import { createInitialConnectionManagerState } from './connection-manager.state.js';
import type { ConnectorEvent, EngineConnector } from './connector.types.js';

/**
 * Creates a mock connector implementing the EngineConnector interface.
 * Uses a single `subscribe()` method for transport events.
 */
function createMockConnector(): EngineConnector & {
  triggerEvent: (event: ConnectorEvent) => void;
  getSubscriberCount: () => number;
} {
  const handlers = new Set<(event: ConnectorEvent) => void>();

  return {
    capabilities: {
      voice: false,
      streaming: true,
      stateful: true,
    },

    connect: mock((_sessionId: SessionId) => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),

    process: mock(() =>
      Promise.resolve({
        type: 'maelstrom_response',
        requestId: MessageId('test-request-id'),
        userMessage: 'Test message',
        rationale: 'Test rationale',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      } as MaelstromResponse),
    ),

    subscribe: (handler: (event: ConnectorEvent) => void): Unsubscribe => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    addAssistantMessage: mock(() => Promise.resolve()),

    getHistory: mock(() => Promise.resolve([])),

    triggerEvent: (event: ConnectorEvent) => {
      handlers.forEach((h) => {
        h(event);
      });
    },

    getSubscriberCount: () => handlers.size,
  };
}

// Drains queued microtasks so a fire-and-forget async chain (setConnector's
// internal #connectWithRetries call) gets the chance to run to completion
// before assertions inspect its result.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('ConnectionManager', () => {
  let manager: ConnectionManager;
  let clock: ReturnType<typeof FakeTimers.install>;
  let mockConnector: ReturnType<typeof createMockConnector>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
    mockConnector = createMockConnector();
  });

  afterEach(async () => {
    clock.uninstall();
    if (manager) {
      await manager.dispose();
    }
  });

  describe('initialization', () => {
    it('should not mutate state on initialization', () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
      });

      expect(manager.store.state).toEqual(
        createInitialConnectionManagerState(),
      );
    });

    it('should initialize with disconnected state', () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
      });

      expect(manager.store.state.connectionStatus).toBe('disconnected');
      expect(manager.store.state.circuitBreakerStatus).toBe('closed');
      expect(manager.store.state.connectionRetryCount).toBe(0);
    });
  });

  describe('connection status transitions', () => {
    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        circuitBreakerTimeoutMs: 5000,
      });
    });

    it('should transition from disconnected to connecting to connected on success', async () => {
      const events: Record<string, unknown>[] = [];

      manager.events.on('connection_status_changed', (e) =>
        events.push({ type: 'connection_status_changed', ...e }),
      );
      manager.events.on('connection_attempt', (e) =>
        events.push({ type: 'connection_attempt', ...e }),
      );
      manager.events.on('circuit_closed', () =>
        events.push({ type: 'circuit_closed' }),
      );

      await manager.connect();

      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(events).toEqual([
        {
          type: 'connection_status_changed',
          status: 'connecting',
          previousStatus: 'disconnected',
        },
        {
          type: 'connection_attempt',
          attempt: 1,
          maxAttempts: 3,
        },
        {
          type: 'connection_status_changed',
          status: 'connected',
          previousStatus: 'connecting',
        },
        {
          type: 'circuit_closed',
        },
      ]);
    });

    it('should transition to error state on connection failure', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));

      expect(manager.connect()).rejects.toThrow('Connection failed');

      expect(manager.store.state.connectionStatus).toBe('error');
      expect(manager.store.state.connectionError).toBe(error);
    });

    it('should pass sessionId to connector.connect()', async () => {
      await manager.connect();

      expect(mockConnector.connect).toHaveBeenCalledWith('test-session');
    });

    it('should record lastConnectedAt timestamp on successful connection', async () => {
      const beforeConnect = Date.now();

      await manager.connect();

      expect(manager.store.state.lastConnectedAt).not.toBeNull();
      expect(manager.store.state.lastConnectedAt).toBeGreaterThanOrEqual(
        beforeConnect,
      );
    });
  });

  describe('event-based state management', () => {
    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
      });
    });

    it('should transition to connected after successful connect()', async () => {
      await manager.connect();

      expect(manager.store.state.connectionStatus).toBe('connected');
    });

    it('should transition to disconnected when connector reports clean disconnect', async () => {
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: true,
        message: 'Connection closed',
      });

      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should transition to disconnected when connector reports unexpected disconnect', async () => {
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Connection lost unexpectedly',
      });

      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should transition to error when connector reports transport error', async () => {
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      mockConnector.triggerEvent({
        type: 'error',
        error: new Error('WebSocket error'),
      });

      expect(manager.store.state.connectionStatus).toBe('error');
      expect(manager.store.state.connectionError?.message).toBe(
        'WebSocket error',
      );
    });

    it('should subscribe to connector events on connect', async () => {
      await manager.connect();

      expect(mockConnector.getSubscriberCount()).toBeGreaterThan(0);
    });

    it('should clean up connector subscription on disconnect', async () => {
      await manager.connect();

      expect(mockConnector.getSubscriberCount()).toBeGreaterThan(0);

      await manager.disconnect();

      expect(mockConnector.getSubscriberCount()).toBe(0);
    });

    it('should not fire events twice after auto-reconnect (no subscription leak)', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();

      // Simulate unexpected drop → triggers auto-reconnect
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      // Wait for the scheduled reconnect
      await clock.tickAsync(50);

      // After reconnect, exactly one subscription should be active
      expect(mockConnector.getSubscriberCount()).toBe(1);

      // Now trigger another disconnect and count CM status-change events
      let disconnectCount = 0;
      manager.events.on('connection_status_changed', (e) => {
        if (e.status === 'disconnected') disconnectCount++;
      });

      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: true,
        message: 'Clean close',
      });

      // Should fire exactly once — not twice from a leaked subscription
      expect(disconnectCount).toBe(1);
    });
  });

  describe('auto-reconnect', () => {
    it('should reconnect after unexpected disconnect', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
        // Small threshold so this test's tickAsync(50) comfortably covers
        // both the reconnect delay and the stability window.
        stabilityThresholdMs: 20,
      });

      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      // Simulate unexpected drop
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      expect(manager.store.state.connectionStatus).toBe('disconnected');

      // Wait for the scheduled reconnect
      await clock.tickAsync(50);

      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(manager.store.state.connectionRetryCount).toBe(0);
    });

    it('does not reset connectionRetryCount immediately on reconnect — only after the connection survives stabilityThresholdMs', async () => {
      // This is the core of the fix: connect() resolving only proves the
      // socket opened, not that it's usable. Resetting the counter
      // immediately (the pre-fix behavior) is what let a connection that
      // dies right after opening retry forever without ever tripping the
      // circuit breaker.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
        stabilityThresholdMs: 1000,
      });

      await manager.connect();

      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });
      // Let the scheduled reconnect fire, well before stabilityThresholdMs.
      await clock.tickAsync(10);

      expect(manager.store.state.connectionStatus).toBe('connected');
      // Reconnected, but not yet "stable" — the budget must still reflect
      // the attempt it took to get here.
      expect(manager.store.state.connectionRetryCount).toBe(1);

      // Now let the stability window elapse with no further disconnects.
      await clock.tickAsync(1000);
      expect(manager.store.state.connectionRetryCount).toBe(0);
    });

    it('keeps the retry budget climbing across repeated immediate disconnects and opens the circuit breaker (never resets, since stability is never reached)', async () => {
      // Reproduces the review's exact failure mode: a socket that opens and
      // is torn down again right away (e.g. a session engine that fails to
      // construct) must count against maxRetries like any other failure —
      // not silently reset the budget on every "successful" open.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
        stabilityThresholdMs: 1000,
      });

      await manager.connect();

      for (let i = 0; i < 3; i++) {
        mockConnector.triggerEvent({
          type: 'disconnected',
          clean: false,
          message: 'Dropped immediately',
        });
        // Far shorter than stabilityThresholdMs — the reconnect fires, but
        // the connection never proves stable before the next drop.
        await clock.tickAsync(10);
      }

      expect(manager.store.state.circuitBreakerStatus).toBe('open');
      expect(manager.store.state.connectionStatus).toBe('error');
    });

    it('recovers automatically once a flaky-but-usable link stops dropping: the breaker trips, then the automatic half-open probe succeeds and closes it again', async () => {
      // Continues the "keeps the retry budget climbing" scenario above with
      // the same repeated-immediate-drop pattern (proving the stability
      // guard still trips the breaker), but models a link that is flaky —
      // not permanently dead. Recovery has to happen with no external
      // caller involved: nothing subscribes to `circuit_half_open` anywhere
      // in the codebase, and `provider.tsx` calls `connect()` exactly once
      // on mount. If the half-open transition doesn't self-drive a
      // reconnect, this link would stay wedged in 'error' forever despite
      // being perfectly usable again.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 1000,
        stabilityThresholdMs: 1000,
      });

      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      for (let i = 0; i < 3; i++) {
        mockConnector.triggerEvent({
          type: 'disconnected',
          clean: false,
          message: 'Dropped immediately',
        });
        await clock.tickAsync(10);
      }

      expect(manager.store.state.circuitBreakerStatus).toBe('open');
      expect(manager.store.state.connectionStatus).toBe('error');

      // From here on the link behaves — no more drops. The breaker must
      // recover on its own once circuitBreakerTimeoutMs elapses.
      await clock.tickAsync(1000);

      expect(manager.store.state.circuitBreakerStatus).toBe('closed');
      expect(manager.store.state.connectionStatus).toBe('connected');

      // The recovered connection stays up past stabilityThresholdMs too, so
      // the retry budget is fully restored, not just the breaker closed.
      await clock.tickAsync(1000);
      expect(manager.store.state.connectionRetryCount).toBe(0);
    });

    it('treats a retryable:false disconnected event as terminal: opens the circuit breaker instead of auto-reconnecting', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();
      const openedPayloads: Array<{
        resetAfterMs: number;
        terminal?: boolean;
      }> = [];
      manager.events.on('circuit_opened', (e) => {
        openedPayloads.push(e);
      });
      let halfOpened = false;
      manager.events.on('circuit_half_open', () => {
        halfOpened = true;
      });

      mockConnector.connect = mock(() => Promise.resolve());

      // A close code 1008 (capacity refusal) — WebSocketConnector reports
      // this as retryable: false. Reconnecting with the same session is
      // refused again, so nothing may retry on the visitor's behalf.
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        retryable: false,
        message: 'Playground is at capacity — reload to start a new session.',
      });

      // Well PAST circuitBreakerTimeoutMs, not short of it. The breaker now
      // drives its own half-open probe, so stopping before the timeout would
      // test nothing: a probe fired here would reconnect into the same
      // refusal and loop forever at one attempt per timeout window. Terminal
      // has to mean terminal even after the window elapses.
      await clock.tickAsync(5000 * 4);

      expect(mockConnector.connect).not.toHaveBeenCalled();
      expect(halfOpened).toBe(false);
      expect(manager.store.state.circuitBreakerStatus).toBe('open');
      expect(manager.store.state.connectionStatus).toBe('error');
      expect(manager.store.state.connectionError?.message).toBe(
        'Playground is at capacity — reload to start a new session.',
      );
      expect(openedPayloads).toHaveLength(1);
      // Flagged so a consumer can tell "will recover on a timer" from "needs
      // a reload" without waiting out a reset that never comes.
      expect(openedPayloads[0]?.terminal).toBe(true);
    });

    it('should pass the same sessionId to connector.connect() on auto-reconnect', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();
      (mockConnector.connect as ReturnType<typeof mock>).mockClear();

      // Simulate unexpected drop
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      // Wait for the scheduled reconnect
      await clock.tickAsync(50);

      expect(mockConnector.connect).toHaveBeenCalledWith('test-session');
    });

    it('should not auto-reconnect on clean disconnect', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      let connectCalls = 0;
      const originalConnect = mockConnector.connect;
      mockConnector.connect = mock(() => {
        connectCalls++;
        return (originalConnect as unknown as () => Promise<void>)();
      });

      await manager.connect();
      connectCalls = 0; // reset after initial connect

      // Clean disconnect should not trigger auto-reconnect
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: true,
        message: 'Normal close',
      });

      await clock.tickAsync(200);

      expect(connectCalls).toBe(0);
      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should open circuit breaker after exhausting retry budget', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();

      // Make all future connect() calls fail
      mockConnector.connect = mock(() =>
        Promise.reject(new Error('Server down')),
      );

      let circuitOpened = false;
      manager.events.on('circuit_opened', () => {
        circuitOpened = true;
      });

      // Trigger unexpected disconnect
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      // Advance through all retry attempts
      await clock.tickAsync(500);

      expect(manager.store.state.circuitBreakerStatus).toBe('open');
      expect(manager.store.state.connectionStatus).toBe('error');
      expect(circuitOpened).toBe(true);
    });

    it('should emit connection_attempt and connection_error events during auto-reconnect', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();

      // Fail once, then succeed
      let reconnectAttempts = 0;
      mockConnector.connect = mock(() => {
        reconnectAttempts++;
        if (reconnectAttempts < 2)
          return Promise.reject(new Error('Temporary failure'));
        return Promise.resolve();
      });

      const attemptEvents: ConnectionManagerEvents['connection_attempt'][] = [];
      const errorEvents: ConnectionManagerEvents['connection_error'][] = [];
      manager.events.on('connection_attempt', (e) => attemptEvents.push(e));
      manager.events.on('connection_error', (e) => errorEvents.push(e));

      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      await clock.tickAsync(500);

      expect(attemptEvents.length).toBeGreaterThanOrEqual(1);
      expect(errorEvents).toHaveLength(1);
      expect(manager.store.state.connectionStatus).toBe('connected');
    });

    it('should cancel pending auto-reconnect on disconnect()', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        circuitBreakerTimeoutMs: 10000,
      });

      await manager.connect();

      let reconnectConnectCalls = 0;
      mockConnector.connect = mock(() => {
        reconnectConnectCalls++;
        return Promise.resolve();
      });

      // Trigger auto-reconnect (will schedule a retry with delay)
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      // Disconnect before the retry timer fires
      await manager.disconnect();

      // Advance past when the retry would have fired
      await clock.tickAsync(10000);

      expect(reconnectConnectCalls).toBe(0);
      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should respect maxRetries budget across multiple auto-reconnect attempts', async () => {
      // #handleAutoReconnect is recursive: on failure it schedules itself again.
      // If it mistakenly called #connectWithRetries (which has its own maxRetries
      // loop), each auto-reconnect would trigger a full retry loop, giving
      // maxRetries × maxRetries = 9 total attempts instead of 3.
      // This test guards against that by asserting exactly maxRetries attempts.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();

      // All reconnects will fail
      let totalConnectCalls = 0;
      mockConnector.connect = mock(() => {
        totalConnectCalls++;
        return Promise.reject(new Error('Server down'));
      });

      // Trigger auto-reconnect
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });

      // Advance through all retries
      await clock.tickAsync(2000);

      expect(totalConnectCalls).toBe(3);
      expect(manager.store.state.circuitBreakerStatus).toBe('open');
    });

    it('does not let a stale auto-reconnect dial subscribe to a connector swapped in while its own dial was pending', async () => {
      // Same read-back-through-the-field hazard as #connectWithRetries, but
      // in the auto-reconnect timer's callback: `#setupConnectorSubscription`
      // there also reads the LIVE `#connector`, so a swap while the timer's
      // own `await connector.connect()` is in flight could land the same
      // false-'connected'-via-an-undialed-connector bug.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      let resolveReconnectDial: () => void = () => {};
      mockConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveReconnectDial = resolve;
          }),
      );

      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: false,
        message: 'Dropped',
      });
      expect(manager.store.state.connectionStatus).toBe('disconnected');

      // Fire the reconnect timer; its connect() call is now in flight.
      await clock.tickAsync(10);
      expect(manager.store.state.connectionStatus).toBe('connecting');

      const nextConnector = createMockConnector();
      let resolveNewDial: () => void = () => {};
      nextConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveNewDial = resolve;
          }),
      );
      manager.setConnector(nextConnector);
      await flushMicrotasks();
      expect(nextConnector.connect).toHaveBeenCalledTimes(1);

      // The stale reconnect dial finally lands — belatedly, on a connector
      // this manager no longer speaks for.
      resolveReconnectDial();
      await flushMicrotasks();

      expect(manager.store.state.connectionStatus).not.toBe('connected');
      expect(mockConnector.getSubscriberCount()).toBe(0);

      resolveNewDial();
      await flushMicrotasks();

      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(nextConnector.getSubscriberCount()).toBe(1);
    });
  });

  describe('disconnect', () => {
    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
      });
    });

    it('should transition to disconnected state', async () => {
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      await manager.disconnect();

      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should call connector.disconnect', async () => {
      await manager.connect();

      await manager.disconnect();

      expect(mockConnector.disconnect).toHaveBeenCalled();
    });

    it('should record lastDisconnectedAt timestamp', async () => {
      await manager.connect();
      const beforeDisconnect = Date.now();

      await manager.disconnect();

      expect(manager.store.state.lastDisconnectedAt).not.toBeNull();
      expect(manager.store.state.lastDisconnectedAt).toBeGreaterThanOrEqual(
        beforeDisconnect,
      );
    });

    it('should still transition to disconnected when connector.disconnect() throws', async () => {
      await manager.connect();
      mockConnector.disconnect = mock(() =>
        Promise.reject(new Error('Transport already gone')),
      );

      await manager.disconnect();

      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should warn-log when connector.disconnect() throws', async () => {
      await manager.connect();
      const disconnectError = new Error('Transport already gone');
      mockConnector.disconnect = mock(() => Promise.reject(disconnectError));

      const originalWarn = console.warn;
      const warnSpy = mock((..._args: unknown[]) => {});
      console.warn = warnSpy;

      try {
        await manager.disconnect();
      } finally {
        console.warn = originalWarn;
      }

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]).toEqual([
        '[ConnectionManager]',
        'Connector disconnect failed',
        disconnectError,
      ]);
    });

    it('resets the retry budget on a deliberate connect() even when a stale count survived from a previous failed cycle', async () => {
      // Reproduces the gap: a successful connect() no longer resets
      // connectionRetryCount immediately (that now only happens after
      // stabilityThresholdMs — see the "auto-reconnect" describe block).
      // The deliberate, user-initiated connect() must not inherit that
      // leftover budget on its own next call, or it can trip the circuit
      // breaker on far fewer than maxRetries failures.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
        // Long enough that it never fires during this test, so the delayed
        // stability reset can't be the thing that zeroes the counter.
        stabilityThresholdMs: 5000,
      });

      // First cycle: two failures before succeeding on the 3rd attempt.
      // Leaves connectionRetryCount at 2 in the store — success doesn't
      // clear it, only the (never-fired) stability timer would.
      let firstCycleAttempts = 0;
      mockConnector.connect = mock(() => {
        firstCycleAttempts++;
        if (firstCycleAttempts < 3) return Promise.reject(new Error('flaky'));
        return Promise.resolve();
      });

      const firstConnect = manager.connect();
      await clock.tickAsync(20);
      await firstConnect;

      expect(manager.store.state.connectionRetryCount).toBe(2);

      // Deliberate reconnect, well before stabilityThresholdMs elapses.
      // Succeeding on the very first attempt means nothing else would touch
      // connectionRetryCount during this call — so if connect() itself
      // doesn't reset it, the stale 2 leaks through untouched.
      mockConnector.connect = mock(() => Promise.resolve());
      await manager.connect();

      expect(manager.store.state.connectionRetryCount).toBe(0);
    });

    it('should reset retry count on disconnect', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 10,
      });

      try {
        await manager.connect();
      } catch {}

      expect(manager.store.state.connectionRetryCount).toBeGreaterThan(0);

      await manager.disconnect();

      expect(manager.store.state.connectionRetryCount).toBe(0);
    });
  });

  describe('reconnection with exponential backoff', () => {
    let originalRandom: typeof Math.random;

    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        circuitBreakerTimeoutMs: 5000,
      });
      // Store original and mock Math.random to return 1 for no jitter
      originalRandom = Math.random;
      Math.random = mock(() => 1);
    });

    afterEach(() => {
      // Restore Math.random
      Math.random = originalRandom;
    });

    it('should retry with exponential backoff on failure', async () => {
      let attempts = 0;
      const error = new Error('Connection failed');
      const attemptTimes: number[] = [];
      mockConnector.connect = mock(() => {
        attempts++;
        attemptTimes.push(clock.now);
        if (attempts < 3) {
          return Promise.reject(error);
        }
        return Promise.resolve();
      });

      const connectPromise = manager.connect();

      await clock.tickAsync(100);
      await clock.tickAsync(200);

      await connectPromise;

      expect(attempts).toBe(3);
      expect(manager.store.state.connectionStatus).toBe('connected');

      expect(attemptTimes[0]).toBe(0);
      expect(attemptTimes[1]).toBe(100);
      expect(attemptTimes[2]).toBe(300);
    });

    it('should use exponential backoff timing between retries', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        circuitBreakerTimeoutMs: 5000,
      });

      const error = new Error('Connection failed');
      const attemptTimes: number[] = [];
      let attempts = 0;
      mockConnector.connect = mock(() => {
        attempts++;
        attemptTimes.push(clock.now);
        if (attempts < 3) return Promise.reject(error);
        return Promise.resolve();
      });

      const connectPromise = manager.connect();

      await clock.runAllAsync();
      await connectPromise;

      expect(attemptTimes[0]).toBe(0);
      expect(attemptTimes[1]).toBe(100);
      expect(attemptTimes[2]).toBe(300);
      expect(attempts).toBe(3);
    });

    it('should emit connection_attempt events during retries', async () => {
      const error = new Error('Connection failed');
      let attempts = 0;
      const attemptTimes: number[] = [];
      mockConnector.connect = mock(() => {
        attempts++;
        attemptTimes.push(clock.now);
        if (attempts < 2) return Promise.reject(error);
        return Promise.resolve();
      });

      const attemptEvents: ConnectionManagerEvents['connection_attempt'][] = [];
      manager.events.on('connection_attempt', (e) => attemptEvents.push(e));

      const connectPromise = manager.connect();

      await clock.tickAsync(100);
      await connectPromise;

      expect(attemptEvents).toEqual([
        { attempt: 1, maxAttempts: 3 },
        { attempt: 2, maxAttempts: 3 },
      ]);

      expect(attemptTimes[0]).toBe(0);
      expect(attemptTimes[1]).toBe(100);
    });

    it('should emit connection_error events on each failure', async () => {
      const error = new Error('Connection failed');
      let attempts = 0;
      const attemptTimes: number[] = [];
      mockConnector.connect = mock(() => {
        attempts++;
        attemptTimes.push(clock.now);
        if (attempts < 3) return Promise.reject(error);
        return Promise.resolve();
      });

      const errorEvents: ConnectionManagerEvents['connection_error'][] = [];
      manager.events.on('connection_error', (e) => errorEvents.push(e));

      const connectPromise = manager.connect();

      await clock.tickAsync(100);
      await clock.tickAsync(200);

      await connectPromise;

      expect(errorEvents).toHaveLength(2);
      expect(errorEvents[0].attempt).toBe(1);
      expect(errorEvents[1].attempt).toBe(2);

      expect(attemptTimes[0]).toBe(0);
      expect(attemptTimes[1]).toBe(100);
    });

    it('should not exceed maxDelayMs', async () => {
      // Override the default mock to return 0.5 for jitter testing
      Math.random = mock(() => 0.5);

      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 5,
        initialDelayMs: 500,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        circuitBreakerTimeoutMs: 5000,
      });

      const error = new Error('Connection failed');
      const attemptTimes: number[] = [];
      let attempts = 0;
      mockConnector.connect = mock(() => {
        attempts++;
        attemptTimes.push(clock.now);
        if (attempts < 4) return Promise.reject(error);
        return Promise.resolve();
      });

      const connectPromise = manager.connect();

      await clock.tickAsync(375);
      await clock.tickAsync(750);
      await clock.tickAsync(750);

      await connectPromise;

      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(attempts).toBe(4);

      const delays = [
        attemptTimes[1] - attemptTimes[0],
        attemptTimes[2] - attemptTimes[1],
        attemptTimes[3] - attemptTimes[2],
      ];
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(1000);
      }

      expect(attemptTimes[1] - attemptTimes[0]).toBe(375);
      expect(attemptTimes[2] - attemptTimes[1]).toBe(750);
      expect(attemptTimes[3] - attemptTimes[2]).toBe(750);
    });

    it('should throw after max retries exceeded', async () => {
      const error = new Error('Connection failed');

      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
      });
      mockConnector.connect = mock(() => Promise.reject(error));

      expect(manager.connect()).rejects.toThrow('Connection failed');
      expect(manager.store.state.connectionStatus).toBe('error');
      expect(manager.store.state.connectionRetryCount).toBe(3);
    });
  });

  describe('circuit breaker pattern', () => {
    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 0,
      });
    });

    it('should open circuit after max retries', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));

      expect(manager.connect()).rejects.toThrow();
      expect(manager.store.state.circuitBreakerStatus).toBe('open');
    });

    it('should emit circuit_opened event', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));

      let circuitOpened = false;
      manager.events.on('circuit_opened', () => {
        circuitOpened = true;
      });

      expect(manager.connect()).rejects.toThrow();

      expect(circuitOpened).toBe(true);
    });

    it('should reject immediate connect attempts when circuit is open', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));

      expect(manager.connect()).rejects.toThrow();

      expect(manager.connect()).rejects.toThrow('Circuit breaker is open');
    });

    it('transitions to half_open after timeout and immediately probes automatically — closing the circuit when the probe succeeds', async () => {
      // circuitBreakerTimeoutMs: 0 (this describe's default) makes real-timer
      // + real-wait timing indeterminate once the probe is automatic (the
      // reopen-and-reschedule cycle can flap faster than a fixed real-time
      // wait can reliably observe), so this test uses its own manager with a
      // non-zero timeout and drives time deterministically via clock.tickAsync.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 1000,
      });

      let attempts = 0;
      mockConnector.connect = mock(() => {
        attempts++;
        // The first two attempts exhaust maxRetries and open the breaker;
        // the third — the automatic half-open probe — succeeds.
        if (attempts <= 2)
          return Promise.reject(new Error('Connection failed'));
        return Promise.resolve();
      });

      const halfOpenEvents: Record<string, never>[] = [];
      manager.events.on('circuit_half_open', (e) => halfOpenEvents.push(e));

      await manager.connect().catch(() => {});
      expect(manager.store.state.circuitBreakerStatus).toBe('open');
      expect(attempts).toBe(2);

      // No manual manager.connect() call anywhere below — recovery must be
      // automatic, or the client is wedged until a page reload (circuit_half_open
      // has no subscriber anywhere in the codebase, and Provider only calls
      // connect() once, on mount).
      await clock.tickAsync(1000);

      expect(halfOpenEvents).toHaveLength(1);
      expect(attempts).toBe(3);
      expect(manager.store.state.circuitBreakerStatus).toBe('closed');
      expect(manager.store.state.connectionStatus).toBe('connected');
    });

    it('ignores a half-open probe that settles after dispose() instead of resurrecting a disposed manager', async () => {
      // The probe is fired from a timer, so dispose() can land while its
      // connect() is still in flight — a React StrictMode unmount does
      // exactly this. The guard at the top of the probe only covers the
      // synchronous entry, so without a second check in the continuations a
      // late success re-subscribes to the connector and arms a stability
      // timer that dispose()'s cleanup has already run past, and a late
      // failure schedules probes forever against a dead manager.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 1000,
      });

      let attempts = 0;
      let releaseProbe: () => void = () => {};
      mockConnector.connect = mock(() => {
        attempts++;
        if (attempts <= 2)
          return Promise.reject(new Error('Connection failed'));
        // Hangs until the test releases it, pinning the probe in flight
        // across the dispose() below.
        return new Promise<void>((resolve) => {
          releaseProbe = resolve;
        });
      });

      await manager.connect().catch(() => {});
      expect(manager.store.state.circuitBreakerStatus).toBe('open');

      await clock.tickAsync(1000);
      expect(attempts).toBe(3);

      await manager.dispose();
      releaseProbe();
      await clock.tickAsync(0);

      expect(manager.store.state.connectionStatus).not.toBe('connected');

      // Nothing may be left armed: another full breaker window must not
      // produce a further probe.
      await clock.tickAsync(5000);
      expect(attempts).toBe(3);
    });

    it('reopens the circuit when the half-open probe fails, and probes again once per circuitBreakerTimeoutMs — bounded, not a tight loop', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 1000,
      });

      let attempts = 0;
      mockConnector.connect = mock(() => {
        attempts++;
        return Promise.reject(new Error('Connection failed'));
      });

      await manager.connect().catch(() => {});
      expect(manager.store.state.circuitBreakerStatus).toBe('open');
      expect(attempts).toBe(2);

      // A link that never recovers must still only be probed once per
      // circuitBreakerTimeoutMs window — the breaker backs off, it doesn't
      // hammer the connector.
      await clock.tickAsync(1000);
      expect(attempts).toBe(3);
      expect(manager.store.state.circuitBreakerStatus).toBe('open');

      await clock.tickAsync(1000);
      expect(attempts).toBe(4);
      expect(manager.store.state.circuitBreakerStatus).toBe('open');
    });

    it('does not let a stale half-open probe subscribe to a connector swapped in while its own dial was pending', async () => {
      // Same read-back-through-the-field hazard as #connectWithRetries and
      // the auto-reconnect timer, but in the half-open probe's `.then()`
      // continuation.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 1,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 1000,
      });

      mockConnector.connect = mock(() => Promise.reject(new Error('down')));
      await manager.connect().catch(() => {});
      expect(manager.store.state.circuitBreakerStatus).toBe('open');

      let resolveProbeDial: () => void = () => {};
      mockConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveProbeDial = resolve;
          }),
      );

      // Breaker timeout fires → half-open → automatic probe, now in flight
      // against the old connector.
      await clock.tickAsync(1000);
      expect(manager.store.state.connectionStatus).toBe('connecting');

      const nextConnector = createMockConnector();
      let resolveNewDial: () => void = () => {};
      nextConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveNewDial = resolve;
          }),
      );
      manager.setConnector(nextConnector);
      await flushMicrotasks();
      expect(nextConnector.connect).toHaveBeenCalledTimes(1);

      // The stale probe's dial finally lands — belatedly, on a connector
      // this manager has already moved past.
      resolveProbeDial();
      await flushMicrotasks();

      expect(manager.store.state.connectionStatus).not.toBe('connected');
      expect(mockConnector.getSubscriberCount()).toBe(0);

      resolveNewDial();
      await flushMicrotasks();

      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(nextConnector.getSubscriberCount()).toBe(1);
    });

    it('should emit circuit_closed event on successful connection', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        circuitBreakerTimeoutMs: 500,
      });

      let circuitClosed = false;
      manager.events.on('circuit_closed', () => {
        circuitClosed = true;
      });

      await manager.connect();

      expect(circuitClosed).toBe(true);
    });
  });

  describe('stability reset teardown', () => {
    it('clears the pending stability-reset timer on disconnect() so it cannot leak past teardown', async () => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        stabilityThresholdMs: 5000,
      });

      await manager.connect();
      // The stability-reset timer scheduled by the successful connect above
      // is the only pending timer at this point.
      expect(clock.countTimers()).toBeGreaterThan(0);

      await manager.disconnect();

      expect(clock.countTimers()).toBe(0);
    });
  });

  describe('setConnector', () => {
    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
      });
    });

    it('moves the live subscription to the new connector: an old-connector event no longer changes state, a new-connector event does', async () => {
      // Reproduces the half-swap bug: setConnector only reassigned #connector,
      // so the manager kept listening to the connector it just replaced.
      // Status events from the dead transport kept driving connectionStatus,
      // and the new connector's events were ignored until something else
      // (e.g. a reconnect) happened to re-subscribe.
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      const nextConnector = createMockConnector();
      manager.setConnector(nextConnector);
      // setConnector now drives the new connector through the real connect
      // path (Fix 1) instead of moving the subscription synchronously — let
      // that fire-and-forget cycle settle before checking who's subscribed.
      await flushMicrotasks();

      // The OLD connector is dead to the manager now: an event it emits must
      // not be able to move connectionStatus any more.
      mockConnector.triggerEvent({
        type: 'disconnected',
        clean: true,
        message: 'Stale event from the connector we swapped away from',
      });
      expect(manager.store.state.connectionStatus).toBe('connected');

      // The NEW connector is what the manager listens to now: its event must
      // take effect.
      nextConnector.triggerEvent({
        type: 'disconnected',
        clean: true,
        message: 'Event from the connector we swapped to',
      });
      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('is a no-op when passed the same connector reference', async () => {
      await manager.connect();
      expect(mockConnector.getSubscriberCount()).toBe(1);

      manager.setConnector(mockConnector);

      // A same-reference call must not tear down and rebuild the
      // subscription — that would be observable as a spurious unsubscribe.
      expect(mockConnector.getSubscriberCount()).toBe(1);
    });

    it('does not attach a subscription when none was active yet', () => {
      // No connect() has happened, so there is nothing to move — connect()
      // installs the subscription itself later. Swapping here must not
      // subscribe to the new connector early.
      const nextConnector = createMockConnector();
      manager.setConnector(nextConnector);

      expect(nextConnector.getSubscriberCount()).toBe(0);
    });

    it('does not connect the new connector when the manager was never connected', async () => {
      // A swap on a manager that never connected must not spontaneously
      // connect — connect() remains the caller's own explicit trigger.
      const nextConnector = createMockConnector();
      manager.setConnector(nextConnector);
      await flushMicrotasks();

      expect(nextConnector.connect).not.toHaveBeenCalled();
      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('connects the new connector and disconnects the old one when swapped on a connected manager', async () => {
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      const nextConnector = createMockConnector();
      manager.setConnector(nextConnector);
      await flushMicrotasks();

      expect(mockConnector.disconnect).toHaveBeenCalledTimes(1);
      expect(nextConnector.connect).toHaveBeenCalledTimes(1);
      expect(manager.store.state.connectionStatus).toBe('connected');
    });

    it('does not report connected for the new connector before it has actually opened', async () => {
      await manager.connect();
      expect(manager.store.state.connectionStatus).toBe('connected');

      let resolveConnect: () => void = () => {};
      const nextConnector = createMockConnector();
      nextConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          }),
      );

      manager.setConnector(nextConnector);

      // Synchronously after the swap — before the new connector's connect()
      // has resolved — connectionStatus must not still claim 'connected'
      // for a socket nobody has opened.
      expect(manager.store.state.connectionStatus).not.toBe('connected');

      resolveConnect();
      await flushMicrotasks();

      expect(manager.store.state.connectionStatus).toBe('connected');
    });

    it('drives a connector swapped in mid-dial through its own connect, instead of leaving it undialed or letting the stale dial subscribe to it', async () => {
      // Regression: setConnector used to only redial when connectionStatus
      // was already 'connected'. During the INITIAL connect(), status is
      // 'connecting' while #connectWithRetries's `await connector.connect()`
      // is still pending — a swap here used to reassign #connector and
      // early-return, leaving the new connector completely undialed. Worse,
      // when the stale dial eventually resolved, it read #connector back
      // through the live field and subscribed to the connector THAT WAS
      // NEVER ACTUALLY CONNECTED, falsely reporting 'connected'.
      let resolveFirstConnect: () => void = () => {};
      mockConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstConnect = resolve;
          }),
      );

      const connectPromise = manager.connect();
      await flushMicrotasks();
      expect(manager.store.state.connectionStatus).toBe('connecting');

      const nextConnector = createMockConnector();
      let resolveSecondConnect: () => void = () => {};
      nextConnector.connect = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveSecondConnect = resolve;
          }),
      );
      manager.setConnector(nextConnector);
      await flushMicrotasks();

      // Fix (b): the swap actually dials the new connector instead of
      // leaving it untouched.
      expect(nextConnector.connect).toHaveBeenCalledTimes(1);

      // The stale dial finally lands — belatedly "succeeding" on a
      // connector this manager no longer speaks for.
      resolveFirstConnect();
      await flushMicrotasks();

      // Fix (a): the belated success must not falsely report 'connected'
      // via a connector that was never actually dialed, nor subscribe to it.
      expect(manager.store.state.connectionStatus).not.toBe('connected');
      expect(mockConnector.getSubscriberCount()).toBe(0);

      // The new connector's own dial completing is what actually connects.
      resolveSecondConnect();
      await flushMicrotasks();

      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(nextConnector.getSubscriberCount()).toBe(1);

      await connectPromise;
    });

    it('bails out of the whole stale retry loop on a REJECT, instead of redialing the connector a swap already connected or corrupting its state', async () => {
      // Sibling to the mid-dial test above, but for the failure path of
      // #connectWithRetries specifically. The success path there is guarded
      // (per-attempt connector capture + early return), but the catch block
      // was not: a stale rejection on the OLD connector would (1) emit
      // connection_error / write connectionError for a connector nobody
      // uses any more, (2) if attempts remained, sleep and loop again — the
      // next iteration re-reads `this.#connector`, which is now the NEW
      // connector, so the superseded loop redials it a SECOND time,
      // concurrently with the legitimate #connectWithRetries setConnector
      // already kicked off, and (3) if that redial also fails, run the
      // circuit-breaker-opening tail against a manager that may already be
      // happily connected through the swap.
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 1,
        circuitBreakerTimeoutMs: 5000,
      });

      let rejectFirstConnect: (err: Error) => void = () => {};
      mockConnector.connect = mock(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstConnect = reject;
          }),
      );

      const connectPromise = manager.connect().catch(() => {
        // Pre-fix, the stale loop's exhaustion throws past connect()'s own
        // caller; post-fix it never reaches that tail at all. Either way,
        // this test asserts on manager STATE, not on connect()'s own
        // settlement, so the rejection (if any) is swallowed here.
      });
      await flushMicrotasks();
      expect(manager.store.state.connectionStatus).toBe('connecting');

      const nextConnector = createMockConnector();
      let nextConnectorCallCount = 0;
      nextConnector.connect = mock(() => {
        nextConnectorCallCount++;
        if (nextConnectorCallCount === 1) {
          // The one legitimate dial: setConnector's own #connectWithRetries.
          return Promise.resolve();
        }
        // Any further call IS the hazard under test: a superseded retry
        // loop re-reading #connector and redialing, on its own account, a
        // connector the swap already connected.
        return Promise.reject(
          new Error('should never be dialed a second time'),
        );
      });

      manager.setConnector(nextConnector);
      await flushMicrotasks();

      expect(nextConnector.connect).toHaveBeenCalledTimes(1);
      expect(manager.store.state.connectionStatus).toBe('connected');
      expect(manager.store.state.circuitBreakerStatus).toBe('closed');

      // The stale dial on the OLD connector finally rejects — belatedly, on
      // a connector this manager no longer speaks for.
      rejectFirstConnect(new Error('stale failure'));
      await flushMicrotasks();
      // Let the stale loop's backoff-and-retry cycle run to completion, if
      // it is going to happen at all.
      await clock.tickAsync(1000);
      await flushMicrotasks();
      await connectPromise;

      // (c) — the assertion that specifically catches the double-dial: the
      // stale loop must never have redialed the connector the swap already
      // connected.
      expect(nextConnector.connect).toHaveBeenCalledTimes(1);
      // (a) / (b) — a stale failure on an abandoned connector must not
      // corrupt state describing the connector the manager is actually
      // using now.
      expect(manager.store.state.circuitBreakerStatus).not.toBe('open');
      expect(manager.store.state.connectionStatus).not.toBe('error');
      expect(manager.store.state.connectionStatus).toBe('connected');
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      manager = new ConnectionManager(mockConnector, {
        sessionId: SessionId('test-session'),
      });
    });

    it('should disconnect on dispose', async () => {
      await manager.connect();

      await manager.dispose();

      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });

    it('should throw on connect() after dispose', async () => {
      await manager.dispose();

      expect(manager.connect()).rejects.toThrow(
        'ConnectionManager has been disposed',
      );
    });

    it('should be idempotent', async () => {
      await manager.connect();

      await manager.dispose();
      await manager.dispose();

      expect(manager.store.state.connectionStatus).toBe('disconnected');
    });
  });
});
