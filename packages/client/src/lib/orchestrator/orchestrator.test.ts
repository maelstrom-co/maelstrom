import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  InstanceId,
  MessageId,
  SessionId,
  type ChartRequestMessage,
  type MaelstromResponse,
  type SessionHistoryEntry,
  type VariantName,
  type VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { createMockResponse } from '../../../test-utils/mocks.js';
import type {
  ConnectorEvent,
  EngineConnector,
  PushConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import { Orchestrator } from './orchestrator.js';
import type { RequestCoordinatorEvents } from './request-coordinator.js';

// ============================================================================
// Test helpers
// ============================================================================

function createMockConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: mock((_sessionId: SessionId) => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    process: mock(() =>
      Promise.resolve(
        createMockResponse(MessageId('req-1'), 'instance-1', 'show'),
      ),
    ),
    subscribe: mock(
      (_handler: (event: ConnectorEvent) => void): Unsubscribe =>
        () => {},
    ),
    addAssistantMessage: mock(() => Promise.resolve()),
    getHistory: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

function createMockPushConnector(
  overrides: Partial<PushConnector> = {},
): PushConnector {
  return {
    ...createMockConnector(),
    onPushMessage: mock(
      (_cb: (response: MaelstromResponse) => void): Unsubscribe =>
        () => {},
    ),
    ...overrides,
  } as PushConnector;
}

function createTestOrchestrator(
  connector?: EngineConnector,
  options: { debug?: boolean; layoutMode?: 'tiling' | 'grid' } = {},
) {
  const conn = connector ?? createMockConnector();
  const orchestrator = new Orchestrator(conn, options);
  return { connector: conn, orchestrator };
}

// ============================================================================
// Tests
// ============================================================================

describe('Orchestrator', () => {
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clock.uninstall();
  });

  // --------------------------------------------------------------------------
  // Construction
  // --------------------------------------------------------------------------

  describe('construction', () => {
    it('should create with default options', () => {
      const { orchestrator } = createTestOrchestrator();

      const config = orchestrator.getConfig();
      expect(config.layoutMode).toBe('tiling');
      expect(config.debug).toBe(false);
      expect(config.sessionId).toMatch(/^session-/);

      orchestrator.dispose();
    });

    it('should create with custom options', () => {
      const { orchestrator } = createTestOrchestrator(undefined, {
        debug: true,
        layoutMode: 'grid',
      });

      const config = orchestrator.getConfig();
      expect(config.layoutMode).toBe('grid');
      expect(config.debug).toBe(true);

      orchestrator.dispose();
    });

    it('should expose composed microkernels', () => {
      const { orchestrator } = createTestOrchestrator();

      expect(orchestrator.connectionManager).toBeDefined();
      expect(orchestrator.vesselManager).toBeDefined();
      expect(orchestrator.chartManager).toBeDefined();
      expect(orchestrator.commandProcessor).toBeDefined();
      expect(orchestrator.requestCoordinator).toBeDefined();

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // getViewState
  // --------------------------------------------------------------------------

  describe('getViewState', () => {
    it('should return initial view state', () => {
      const { orchestrator } = createTestOrchestrator();

      const viewState = orchestrator.getViewState();
      expect(viewState.isProcessing).toBe(false);
      expect(viewState.isConnected).toBe(false);
      expect(viewState.sessionId).toMatch(/^session-/);
      expect(viewState.layoutMode).toBe('tiling');

      orchestrator.dispose();
    });

    it('should read isProcessing from requestCoordinator', async () => {
      let capturedViewState: ReturnType<
        typeof orchestrator.getViewState
      > | null = null;
      const connector = createMockConnector();
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.requestCoordinator.events.on('processing_started', () => {
        capturedViewState = orchestrator.getViewState();
      });

      await orchestrator.processIntent('test');

      expect(capturedViewState).not.toBeNull();
      expect(capturedViewState!.isProcessing).toBe(true);

      // After completion, isProcessing is false
      expect(orchestrator.getViewState().isProcessing).toBe(false);

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // processIntent
  // --------------------------------------------------------------------------

  describe('processIntent', () => {
    it('should send request to connector and process response', async () => {
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      const connector = createMockConnector({
        process: mock(() => Promise.resolve(mockResponse)),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      const response = await orchestrator.processIntent('show chart');

      expect(response).toBe(mockResponse);
      expect(connector.process).toHaveBeenCalledTimes(1);

      const envelope = (connector.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      const request = envelope.request;
      expect(request.type).toBe('chart_request');
      expect(
        request.context.updateReasons.some(
          (r) => r.type === 'user_intent' && r.intent === 'show chart',
        ),
      ).toBe(true);

      orchestrator.dispose();
    });

    it('should drain pending updates into intent request', async () => {
      const connector = createMockConnector();
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'changed',
      });

      await orchestrator.processIntent('show chart');

      const envelope = (connector.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      const request = envelope.request;
      expect(request.context.updateReasons.length).toBe(2);
      expect(request.context.updateReasons[0].type).toBe('vessel_mutation');
      expect(request.context.updateReasons[1].type).toBe('user_intent');

      orchestrator.dispose();
    });

    it('should emit events through requestCoordinator', async () => {
      const { orchestrator } = createTestOrchestrator();
      const startedEvents: RequestCoordinatorEvents['processing_started'][] =
        [];
      const completedEvents: RequestCoordinatorEvents['processing_completed'][] =
        [];

      orchestrator.requestCoordinator.events.on('processing_started', (e) => {
        startedEvents.push(e);
      });
      orchestrator.requestCoordinator.events.on('processing_completed', (e) => {
        completedEvents.push(e);
      });

      await orchestrator.processIntent('show chart');

      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0].requestId).toBeDefined();

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0].response).toBeDefined();

      orchestrator.dispose();
    });

    it('should emit error event on failure through requestCoordinator', async () => {
      const connector = createMockConnector({
        process: mock(() => Promise.reject(new Error('engine down'))),
      });
      const { orchestrator } = createTestOrchestrator(connector);
      const errors: RequestCoordinatorEvents['error'][] = [];
      orchestrator.requestCoordinator.events.on('error', (e) => {
        errors.push(e);
      });

      await expect(orchestrator.processIntent('show chart')).rejects.toThrow(
        'engine down',
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].error.message).toBe('engine down');

      orchestrator.dispose();
    });

    it('should build request with current state', async () => {
      const connector = createMockConnector();
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.commandProcessor.store.setState((s) => ({
        ...s,
        instances: new Map([
          [
            InstanceId('i-1'),
            {
              instanceId: InstanceId('i-1'),
              vesselId: 'v-1' as VesselId,
              variant: 'default' as VariantName,
              position: { column: 0, row: 0 },
              size: { width: 1, height: 1 },
            },
          ],
        ]),
      }));

      await orchestrator.processIntent('test');

      const envelope = (connector.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      const request = envelope.request;
      expect(request.instances).toEqual([
        {
          instanceId: InstanceId('i-1'),
          vesselId: 'v-1' as VesselId,
          variant: 'default' as VariantName,
        },
      ]);
      expect(request.context.chartDimensions).toEqual({
        columns: 12,
        rows: 8,
      });

      orchestrator.dispose();
    });

    it('should resolve queued flush promises on intent completion', async () => {
      let processResolve!: (v: MaelstromResponse) => void;
      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((resolve) => {
              processResolve = resolve;
            }),
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Schedule an update so flush has something pending
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'changed',
      });

      // Start intent processing (takes the pending update with it)
      const intentPromise = orchestrator.processIntent('show chart');

      // Schedule another update and try to flush while processing
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'changed2',
      });
      const flushPromise = orchestrator.flushUpdates();

      // Resolve the connector
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      processResolve(mockResponse);

      const [intentResult, flushResult] = await Promise.all([
        intentPromise,
        flushPromise,
      ]);

      expect(intentResult).toBe(mockResponse);
      expect(flushResult).toBe(mockResponse);

      orchestrator.dispose();
    });

    it('should reject concurrent processIntent calls', async () => {
      let processResolve!: (v: MaelstromResponse) => void;
      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((resolve) => {
              processResolve = resolve;
            }),
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Start first intent — it will block on the connector
      const firstIntent = orchestrator.processIntent('first');

      // Second intent while first is in-flight should throw
      await expect(orchestrator.processIntent('second')).rejects.toThrow(
        /already in flight/i,
      );

      // Resolve first intent to clean up
      processResolve(
        createMockResponse(MessageId('req-1'), 'instance-1', 'show'),
      );
      await firstIntent;

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // scheduleUpdate / flushUpdates
  // --------------------------------------------------------------------------

  describe('scheduleUpdate / flushUpdates', () => {
    it('should return null when nothing is pending', async () => {
      const { orchestrator } = createTestOrchestrator();

      const result = await orchestrator.flushUpdates();
      expect(result).toBeNull();

      orchestrator.dispose();
    });

    it('should send pending updates and return response', async () => {
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      const connector = createMockConnector({
        process: mock(() => Promise.resolve(mockResponse)),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'test',
      });

      const result = await orchestrator.flushUpdates();

      expect(result).toBe(mockResponse);
      expect(connector.process).toHaveBeenCalledTimes(1);

      orchestrator.dispose();
    });

    it('should send updates automatically after debounce timer', async () => {
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      const connector = createMockConnector({
        process: mock(() => Promise.resolve(mockResponse)),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'test',
      });

      // Advance past debounce delay (default 300ms)
      await clock.tickAsync(350);

      expect(connector.process).toHaveBeenCalledTimes(1);

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // connect / disconnect
  // --------------------------------------------------------------------------

  describe('connect / disconnect', () => {
    it('should delegate connect to connection manager', async () => {
      const connector = createMockConnector();
      const { orchestrator } = createTestOrchestrator(connector);

      await orchestrator.connect();

      expect(connector.connect).toHaveBeenCalledTimes(1);

      orchestrator.dispose();
    });

    it('should pass sessionId to connector.connect()', async () => {
      const connector = createMockConnector();
      const { orchestrator } = createTestOrchestrator(connector);

      await orchestrator.connect();

      const sessionId = orchestrator.getConfig().sessionId;
      expect(connector.connect).toHaveBeenCalledWith(sessionId);

      orchestrator.dispose();
    });

    it('should delegate disconnect to connection manager', async () => {
      const { orchestrator } = createTestOrchestrator();

      await orchestrator.disconnect();

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Chart dimensions coordination
  // --------------------------------------------------------------------------

  describe('chart dimensions coordination', () => {
    it('should update dimensions via chartManager directly', () => {
      const { orchestrator } = createTestOrchestrator();

      orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });

      expect(orchestrator.chartManager.store.state.chartDimensions).toEqual({
        columns: 10,
        rows: 6,
      });

      orchestrator.dispose();
    });

    it('should schedule a resize update when dimensions change while connected', async () => {
      const connector = createMockConnector();
      const { orchestrator } = createTestOrchestrator(connector);

      // Simulate connected state
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });

      await orchestrator.flushUpdates();

      const envelope = (connector.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      const request = envelope.request;
      expect(
        request.context.updateReasons.some((r) => r.type === 'chart_resize'),
      ).toBe(true);

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Push connector support
  // --------------------------------------------------------------------------

  describe('push connector', () => {
    it('should subscribe to push messages when connector supports it', () => {
      const pushConnector = createMockPushConnector();
      const { orchestrator } = createTestOrchestrator(pushConnector);

      expect(pushConnector.onPushMessage).toHaveBeenCalledTimes(1);

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // addAssistantMessage
  // --------------------------------------------------------------------------

  describe('addAssistantMessage', () => {
    it('should delegate to connector when supported', async () => {
      const addAssistantMessage = mock(() => Promise.resolve());
      const connector = createMockConnector({ addAssistantMessage });
      const { orchestrator } = createTestOrchestrator(connector);

      await orchestrator.addAssistantMessage('Hello');

      expect(addAssistantMessage).toHaveBeenCalledTimes(1);
      const call = (addAssistantMessage as ReturnType<typeof mock>).mock
        .calls[0][0] as { id: string; message: string; sessionId?: string };
      expect(typeof call.id).toBe('string');
      expect(call.id.length).toBeGreaterThan(0);
      expect(call.message).toBe('Hello');
      // Contract: the client-side AssistantMessage must NOT carry sessionId —
      // the connector supplies it from the session established during connect().
      expect(call.sessionId).toBeUndefined();

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // getHistory
  // --------------------------------------------------------------------------

  describe('getHistory', () => {
    it('should delegate to the connector and pass through non-empty entries', async () => {
      const entries: readonly SessionHistoryEntry[] = [
        {
          kind: 'turn',
          id: MessageId('m-1'),
          sessionId: SessionId('persisted-session'),
          timestamp: 1,
          userIntent: 'show calendar',
          assistantMessage: 'Here is your calendar.',
        },
        {
          kind: 'injection',
          id: MessageId('i-1'),
          sessionId: SessionId('persisted-session'),
          timestamp: 2,
          content: 'seeded',
        },
      ];
      const getHistory = mock(() => Promise.resolve(entries));
      const connector = createMockConnector({ getHistory });
      const { orchestrator } = createTestOrchestrator(connector);
      const target = SessionId('persisted-session');

      const result = await orchestrator.getHistory(target);

      // Reference equality — orchestrator must not deep-clone.
      expect(result).toBe(entries);
      expect(getHistory).toHaveBeenCalledTimes(1);
      const call = (getHistory as ReturnType<typeof mock>).mock.calls[0][0];
      expect(call).toBe(target);

      orchestrator.dispose();
    });

    it('should propagate connector errors', async () => {
      const getHistory = mock(() =>
        Promise.reject(new Error('transport down')),
      );
      const connector = createMockConnector({ getHistory });
      const { orchestrator } = createTestOrchestrator(connector);

      await expect(
        orchestrator.getHistory(SessionId('any')),
      ).rejects.toThrow(/transport down/);

      orchestrator.dispose();
    });

    it('should reject after dispose', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.dispose();

      await expect(
        orchestrator.getHistory(SessionId('any')),
      ).rejects.toThrow(/disposed/i);
    });
  });

  // --------------------------------------------------------------------------
  // dispose
  // --------------------------------------------------------------------------

  describe('dispose', () => {
    it('should be idempotent', () => {
      const { orchestrator } = createTestOrchestrator();

      orchestrator.dispose();
      orchestrator.dispose(); // should not throw
    });

    it('should reject processIntent after dispose', async () => {
      const { orchestrator } = createTestOrchestrator();

      orchestrator.dispose();

      await expect(orchestrator.processIntent('test')).rejects.toThrow(
        /disposed/i,
      );
    });

    it('should return null from flushUpdates after dispose', async () => {
      const { orchestrator } = createTestOrchestrator();

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'test',
      });

      orchestrator.dispose();

      const result = await orchestrator.flushUpdates();
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: processIntent ordering (Issue #2)
  // resolveFlushPromises must be called AFTER command dispatch so that
  // flush consumers see fully updated store state (including action execution).
  // --------------------------------------------------------------------------

  describe('processIntent flush ordering', () => {
    it('should complete message processing before resolving flush promises', async () => {
      const callOrder: string[] = [];

      let processResolve!: (v: MaelstromResponse) => void;
      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((resolve) => {
              processResolve = resolve;
            }),
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Track when command processing completes
      orchestrator.commandProcessor.events.on('command_complete', () => {
        callOrder.push('command_complete');
      });

      // Schedule update so flush has something pending
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'changed',
      });

      // Start intent processing
      const intentPromise = orchestrator.processIntent('show chart');

      // Queue a flush while processing
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'changed2',
      });
      const flushPromise = orchestrator.flushUpdates();

      // Track when flush promise resolves
      void flushPromise.then(() => {
        callOrder.push('flush_resolved');
      });

      // Resolve the connector
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      processResolve(mockResponse);

      await Promise.all([intentPromise, flushPromise]);

      // Wait for the fire-and-forget commands to complete
      await orchestrator.commandProcessor.waitForIdle();

      // The orchestrator dispatches TWO commands per response (setLayout + executeActions).
      // setLayout is synchronous — its command_complete fires immediately during dispatch.
      // Then resolveFlushPromises runs, and flush_resolved fires on the next microtick.
      // Finally executeActions completes asynchronously, firing the second command_complete.
      expect(callOrder).toEqual([
        'command_complete',
        'flush_resolved',
        'command_complete',
      ]);

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: timer-triggered flush + flush promises (Issue #1)
  // When the timer path handles the send, it must also resolve any
  // queued flush promises that were parked by flushUpdates().
  // --------------------------------------------------------------------------

  describe('timer-triggered flush resolves queued promises', () => {
    it('should resolve flush promises after timer-triggered send completes', async () => {
      let processResolve!: (v: MaelstromResponse) => void;
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );

      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((resolve) => {
              processResolve = resolve;
            }),
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Schedule an update — after debounce, timer fires and starts send
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'test',
      });

      // Advance past debounce — timer fires, handler calls send()
      await clock.tickAsync(350);
      expect(connector.process).toHaveBeenCalledTimes(1);

      // While timer-triggered send is in-flight, schedule another update and flush.
      // flushUpdates sees isProcessing === true and queues a flush promise.
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'test2',
      });
      const flushPromise = orchestrator.flushUpdates();

      // Complete the timer-triggered send
      processResolve(mockResponse);

      // The flush promise must resolve — the timer handler calls
      // resolveFlushPromises after command dispatch completes.
      // Use Promise.race with a fake-timer timeout to detect hangs.
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      );
      const racePromise = Promise.race([
        flushPromise.then(() => 'resolved' as const),
        timeoutPromise,
      ]);

      // Advance clock to let both the async handler and timeout settle
      await clock.tickAsync(6000);

      const result = await racePromise;
      expect(result).toBe('resolved');

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: timer-triggered flush concurrency (Issue #4)
  // Timer must not send when a request is already in flight.
  // --------------------------------------------------------------------------

  describe('timer-triggered flush concurrency', () => {
    it('should not send via timer when a request is already in flight', async () => {
      let processResolve!: (v: MaelstromResponse) => void;
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );

      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((resolve) => {
              processResolve = resolve;
            }),
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Start a long-running intent
      const intentPromise = orchestrator.processIntent('show chart');

      // Schedule an update — timer will fire after debounce
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'test',
      });

      // Advance past debounce delay — timer fires while intent is in flight
      await clock.tickAsync(350);

      // Only one send should have happened (the intent), not the timer
      expect(connector.process).toHaveBeenCalledTimes(1);

      // Complete the intent
      processResolve(mockResponse);
      await intentPromise;

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // MAE-159: timer-flush failure handling
  // --------------------------------------------------------------------------

  describe('timer-flush failure handling (MAE-159)', () => {
    it('rejects queued flush promises when timer-flush send rejects, without duplicate logging', async () => {
      // Hold the connector's process() promise open so we can:
      //   1. Drive the debounce timer to fire the 'updates_flushed' event
      //      (this enters the timer-flush handler we're testing).
      //   2. Observe that isProcessing is true while the send is in-flight.
      //   3. Queue a flush via flushUpdates() — it routes to queueFlush().
      //   4. Reject the in-flight send and assert the queued promise rejects.
      let rejectSend: (err: Error) => void = () => {};
      const sendPromise = new Promise<never>((_, reject) => {
        rejectSend = reject;
      });
      const connector = createMockConnector({
        process: mock(() => sendPromise),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Spy on console.error: RequestCoordinator.send already logs once
      // (via Logger.error → console.error). The orchestrator must NOT add
      // a duplicate log for this code path.
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      try {
        // 1. Schedule an update, tick past debounce → 'updates_flushed' fires
        //    → timer-flush handler enters #requestCoordinator.send(request).
        orchestrator.scheduleUpdate({
          type: 'vessel_mutation',
          instanceId: InstanceId('i-1'),
          changes: 'first',
        });
        await clock.tickAsync(350);

        // 2. Send is in-flight; queue a flush via the public API.
        orchestrator.scheduleUpdate({
          type: 'vessel_mutation',
          instanceId: InstanceId('i-2'),
          changes: 'second',
        });
        const queuedFlush = orchestrator.flushUpdates();

        // 3. Reject the in-flight send.
        const sendError = new Error('connector exploded');
        rejectSend(sendError);

        // 4. The queued flush promise should reject with that error.
        await expect(queuedFlush).rejects.toBe(sendError);

        // 5. RequestCoordinator's "Request <id> failed: ..." log fired once.
        //    Orchestrator must not have added its own "Timer-flush" log
        //    on the post-send path (it only logs on sync construction).
        const orchestratorLogs = errorSpy.mock.calls.filter((args) =>
          args.some((a) => typeof a === 'string' && a.includes('Timer-flush')),
        );
        expect(orchestratorLogs).toHaveLength(0);
      } finally {
        errorSpy.mockRestore();
        orchestrator.dispose();
      }
    });

    it('rejects queued flush promises and logs once when dispatch fails after a successful send', async () => {
      // The timer-flush handler has three error branches; the send-rejection
      // path is covered above. This test covers the dispatch-failure branch:
      // the connector resolves successfully, but `#dispatchResponse` throws
      // because we spy on `commandProcessor.dispatch` to throw a synthetic
      // error. The orchestrator must log "Timer-flush dispatch failed" once
      // and reject any queued flush promises.
      const mockResponse = createMockResponse(
        MessageId('req-dispatch'),
        'instance-1',
        'show',
      );
      let rejectSend: (err: Error) => void = () => {};
      let resolveSend: (response: MaelstromResponse) => void = () => {};
      const sendPromise = new Promise<MaelstromResponse>((resolve, reject) => {
        resolveSend = resolve;
        rejectSend = reject;
      });
      void rejectSend; // keep unused-var quiet — only resolveSend is used here

      const connector = createMockConnector({
        process: mock(() => sendPromise),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      const dispatchError = new Error('command processor exploded');
      const dispatchSpy = spyOn(
        orchestrator.commandProcessor,
        'dispatch',
      ).mockImplementation(() => {
        throw dispatchError;
      });
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Drive the timer-flush.
        orchestrator.scheduleUpdate({
          type: 'vessel_mutation',
          instanceId: InstanceId('i-1'),
          changes: 'first',
        });
        await clock.tickAsync(350);

        // Send is in-flight; queue a flush via the public API.
        orchestrator.scheduleUpdate({
          type: 'vessel_mutation',
          instanceId: InstanceId('i-2'),
          changes: 'second',
        });
        const queuedFlush = orchestrator.flushUpdates();

        // Resolve the in-flight send → orchestrator calls dispatchResponse,
        // which now throws via the spy.
        resolveSend(mockResponse);

        // The queued flush should reject with the dispatch error.
        await expect(queuedFlush).rejects.toBe(dispatchError);

        // Orchestrator MUST log "Timer-flush dispatch failed" exactly once
        // (RequestCoordinator never saw the dispatch error).
        const dispatchLogs = errorSpy.mock.calls.filter((args) =>
          args.some(
            (a) =>
              typeof a === 'string' && a.includes('Timer-flush dispatch failed'),
          ),
        );
        expect(dispatchLogs).toHaveLength(1);
      } finally {
        dispatchSpy.mockRestore();
        errorSpy.mockRestore();
        orchestrator.dispose();
      }
    });
  });
});
