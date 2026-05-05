import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  MessageId,
  SessionId,
  type MaelstromResponse,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import type { ConnectionManagerEvents } from './connection-manager.js';
import { ConnectionManager } from './connection-manager.js';
import { createInitialConnectionManagerState } from './connection-manager.state.js';
import type { ConnectorEvent, EngineConnector } from './connector.types.js';
import type { Unsubscribe } from '../types.js';

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

    it('should transition to half_open after timeout', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));

      expect(manager.connect()).rejects.toThrow();
      expect(manager.store.state.circuitBreakerStatus).toBe('open');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.store.state.circuitBreakerStatus).toBe('half_open');
    });

    it('should close circuit on successful connection in half_open state', async () => {
      const error = new Error('Connection failed');
      let attempts = 0;
      mockConnector.connect = mock(() => {
        attempts++;
        if (attempts < 3) return Promise.reject(error);
        return Promise.resolve();
      });

      expect(manager.connect()).rejects.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.store.state.circuitBreakerStatus).toBe('half_open');

      await manager.connect();

      expect(manager.store.state.circuitBreakerStatus).toBe('closed');
    });

    it('should reopen circuit on failure in half_open state', async () => {
      const error = new Error('Connection failed');
      mockConnector.connect = mock(() => Promise.reject(error));

      expect(manager.connect()).rejects.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.store.state.circuitBreakerStatus).toBe('half_open');

      expect(manager.connect()).rejects.toThrow();

      expect(manager.store.state.circuitBreakerStatus).toBe('open');
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
