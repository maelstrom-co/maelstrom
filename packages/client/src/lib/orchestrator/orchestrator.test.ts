import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import {
  ActionName,
  InstanceId,
  MessageId,
  SessionId,
  VariantName,
  VesselId,
  err,
  ok,
  type ChartRequestMessage,
  type MaelstromResponse,
  type SessionHistoryEntry,
  type Vessel,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import type { ActionResult } from '../command-processor/action-result.js';
import type { VesselInstance } from '../types.js';
import { createMockResponse } from '../../../test-utils/mocks.js';
import {
  createMockConnector,
  createTestOrchestrator,
} from '../../../test-utils/connector-mocks.js';
import type { PushConnector } from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import type { Orchestrator } from './orchestrator.js';
import type { RequestCoordinatorEvents } from './request-coordinator.js';
import { RequestInFlightError } from './request-in-flight-error.js';

// ============================================================================
// Test helpers
// ============================================================================

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

// A vessel whose actions exercise every invokeAction branch: `expand` and
// `collapse` transition between variants, `ping` runs without transitioning,
// and `collapse` lives only on `expanded` (to pin "current variant" semantics).
const stateMachineVessel = {
  id: 'sm',
  name: 'State Machine',
  description: 'a test state-machine vessel',
  defaultVariant: 'collapsed',
  variants: {
    collapsed: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'expand',
          description: 'expand the vessel',
          transitionsTo: 'expanded',
        },
        {
          name: 'ping',
          description: 'a no-transition side effect',
          parameters: [
            { name: 'msg', type: 'string', description: 'a message' },
          ],
        },
      ],
    },
    expanded: {
      props: {},
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'collapse',
          description: 'collapse the vessel',
          transitionsTo: 'collapsed',
        },
      ],
    },
  },
} as const;

// Three variants chained v1 → v2 → v3 for the last-write-wins revert test.
const threeStateVessel = {
  id: 'tri',
  name: 'Tri',
  description: 'a three-state test vessel',
  defaultVariant: 'v1',
  variants: {
    v1: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'toV2', description: 'go to v2', transitionsTo: 'v2' }],
    },
    v2: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'toV3', description: 'go to v3', transitionsTo: 'v3' }],
    },
    v3: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
} as const;

function seedInstance(
  orchestrator: Orchestrator,
  args: { instanceId: string; vesselId: string; variant: string },
): InstanceId {
  const instanceId = InstanceId(args.instanceId);
  const instance: VesselInstance = {
    instanceId,
    vesselId: VesselId(args.vesselId),
    variant: VariantName(args.variant),
    position: { column: 0, row: 0 },
    size: { width: 1, height: 1 },
  };
  orchestrator.commandProcessor.store.setState((s) => ({
    ...s,
    instances: new Map([...s.instances, [instanceId, instance]]),
  }));
  return instanceId;
}

function currentVariant(
  orchestrator: Orchestrator,
  instanceId: InstanceId,
): string | undefined {
  return orchestrator.commandProcessor.store.state.instances.get(instanceId)
    ?.variant;
}

// Drains queued microtasks (command completion + revert continuation) without
// advancing timers past a still-pending deferred runner.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Polls until `predicate` holds, yielding microtasks between checks (without
// advancing timers past a still-pending deferred runner). Fails loudly rather
// than coupling assertions to a fixed microtask-hop count.
async function waitFor(predicate: () => boolean, maxTicks = 100): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('waitFor: condition did not settle');
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
      const resolvedViewState = capturedViewState as ReturnType<
        typeof orchestrator.getViewState
      > | null;
      if (!resolvedViewState) throw new Error('expected captured view state');
      expect(resolvedViewState.isProcessing).toBe(true);

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
              vesselId: VesselId('v-1'),
              variant: VariantName('default'),
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
          vesselId: VesselId('v-1'),
          variant: VariantName('default'),
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

      // Second intent while first is in-flight should throw the typed error
      // so callers (e.g. realtime barge-in handling) can branch on the class
      // rather than matching the message.
      await expect(orchestrator.processIntent('second')).rejects.toThrow(
        RequestInFlightError,
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

      await expect(orchestrator.getHistory(SessionId('any'))).rejects.toThrow(
        /transport down/,
      );

      orchestrator.dispose();
    });

    it('should reject after dispose', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.dispose();

      await expect(orchestrator.getHistory(SessionId('any'))).rejects.toThrow(
        /disposed/i,
      );
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
              typeof a === 'string' &&
              a.includes('Timer-flush dispatch failed'),
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

  // --------------------------------------------------------------------------
  // invokeAction — client-authoritative local action path (MAE-328)
  // --------------------------------------------------------------------------

  describe('invokeAction', () => {
    it('transitions the store immediately (before the runner resolves) and passes params', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      // A user click implies a live session — the mutation is only
      // scheduled immediately (rather than held pending reconnect) when
      // connected. See MAE-328 fix C.
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      let resolveExpand: (() => void) | undefined;
      let receivedParams: unknown;
      orchestrator.commandProcessor.registerRunner(instanceId, {
        expand: (...args: unknown[]) =>
          new Promise<ActionResult>((resolve) => {
            receivedParams = args[0];
            resolveExpand = () => resolve(ok(undefined));
          }),
      });

      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(instanceId, ActionName('expand'), {
        orderId: 'order-42',
      });

      // Transition is synchronous — the store is authoritative and updates
      // before the runner (still deferred) has even been invoked.
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');

      // The engine is informed of the mutation, naming both variants and
      // including the params (MAE-328 fix D) so the engine can tell which
      // item drove the mutation.
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const reason = scheduleSpy.mock.calls[0][0];
      expect(reason.type).toBe('vessel_mutation');
      if (reason.type === 'vessel_mutation') {
        expect(reason.instanceId).toBe(instanceId);
        expect(reason.changes).toContain('collapsed');
        expect(reason.changes).toContain('expanded');
        expect(reason.changes).toContain('order-42');
      }

      // Let the runner be invoked; it captures params but stays pending.
      await flushMicrotasks();
      expect(receivedParams).toEqual({ orderId: 'order-42' });
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');

      resolveExpand?.();
      await orchestrator.commandProcessor.waitForIdle();
      await flushMicrotasks();
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');

      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });

    it('warns and no-ops for an unknown instance', () => {
      const { orchestrator } = createTestOrchestrator();
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(InstanceId('nope'), ActionName('expand'));

      expect(scheduleSpy).not.toHaveBeenCalled();
      const warned = warnSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('unknown instance'),
        ),
      );
      expect(warned).toBe(true);

      warnSpy.mockRestore();
      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });

    it('warns and no-ops when the action is not on the current variant', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      // `collapse` exists on the vessel, but only on the `expanded` variant —
      // the instance is currently `collapsed`, so this must be rejected.
      orchestrator.invokeAction(instanceId, ActionName('collapse'));

      expect(currentVariant(orchestrator, instanceId)).toBe('collapsed');
      expect(scheduleSpy).not.toHaveBeenCalled();
      const warned = warnSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('not available on variant'),
        ),
      );
      expect(warned).toBe(true);

      warnSpy.mockRestore();
      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });

    it('reverts the variant when the runner fails, and emits action_error', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });

      orchestrator.commandProcessor.registerRunner(instanceId, {
        expand: () => Promise.resolve(err(new Error('boom'))),
      });

      const actionErrors: InstanceId[] = [];
      orchestrator.commandProcessor.events.on('action_error', (e) => {
        actionErrors.push(e.instanceId);
      });

      orchestrator.invokeAction(instanceId, ActionName('expand'));
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');

      await orchestrator.commandProcessor.waitForIdle();
      await waitFor(() => currentVariant(orchestrator, instanceId) === 'collapsed');

      expect(currentVariant(orchestrator, instanceId)).toBe('collapsed');
      expect(actionErrors).toContain(instanceId);

      orchestrator.dispose();
    });

    it('does not revert when a newer transition superseded this one (last-write-wins)', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(threeStateVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'tri',
        variant: 'v1',
      });

      let failA: (() => void) | undefined;
      orchestrator.commandProcessor.registerRunner(instanceId, {
        toV2: () =>
          new Promise<ActionResult>((resolve) => {
            failA = () => resolve(err(new Error('A failed')));
          }),
        toV3: () => ok(undefined),
      });

      // A: v1 → v2, runner deferred (will fail).
      orchestrator.invokeAction(instanceId, ActionName('toV2'));
      expect(currentVariant(orchestrator, instanceId)).toBe('v2');

      // B: v2 → v3, invoked before A resolves. B's runner is queued behind A.
      orchestrator.invokeAction(instanceId, ActionName('toV3'));
      expect(currentVariant(orchestrator, instanceId)).toBe('v3');

      // Let A's deferred runner actually start (so `failA` is wired) while B
      // waits its turn in the queue.
      await flushMicrotasks();

      // A fails now — its revert must NOT clobber v3.
      failA?.();
      await orchestrator.commandProcessor.waitForIdle();
      await waitFor(() => currentVariant(orchestrator, instanceId) === 'v3');

      expect(currentVariant(orchestrator, instanceId)).toBe('v3');

      orchestrator.dispose();
    });

    it('runs the runner without transitioning (and without an engine update) for a no-transitionsTo action', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });

      let pinged: unknown;
      orchestrator.commandProcessor.registerRunner(instanceId, {
        ping: (...args: unknown[]) => {
          pinged = args[0];
          return ok(undefined);
        },
      });
      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(instanceId, ActionName('ping'), { msg: 'hi' });

      expect(currentVariant(orchestrator, instanceId)).toBe('collapsed');
      await orchestrator.commandProcessor.waitForIdle();
      await flushMicrotasks();

      expect(pinged).toEqual({ msg: 'hi' });
      expect(scheduleSpy).not.toHaveBeenCalled();

      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });

    it('warns and runs the runner without transitioning when transitionsTo names a nonexistent variant', async () => {
      const { orchestrator } = createTestOrchestrator();

      // Bypass VesselManager validation (which would reject a dangling
      // transitionsTo) to exercise invokeAction's defensive runtime check.
      const ghostVessel = {
        id: VesselId('ghost-v'),
        name: 'Ghost',
        description: 'a vessel with a dangling transition',
        defaultVariant: VariantName('active'),
        variants: {
          active: {
            props: {},
            minSize: { width: 1, height: 1 },
            actions: [
              {
                name: ActionName('vanish'),
                description: 'vanish into a variant that does not exist',
                transitionsTo: VariantName('ghost'),
              },
            ],
          },
        },
      } as unknown as Vessel;
      orchestrator.vesselManager.store.setState((s) => ({
        ...s,
        vessels: new Map([[VesselId('ghost-v'), ghostVessel]]),
      }));

      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'ghost-v',
        variant: 'active',
      });

      let ran = false;
      orchestrator.commandProcessor.registerRunner(instanceId, {
        vanish: () => {
          ran = true;
          return ok(undefined);
        },
      });
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(instanceId, ActionName('vanish'));

      expect(currentVariant(orchestrator, instanceId)).toBe('active');
      expect(scheduleSpy).not.toHaveBeenCalled();

      await orchestrator.commandProcessor.waitForIdle();
      await flushMicrotasks();
      expect(ran).toBe(true);

      const warned = warnSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('unknown variant'),
        ),
      );
      expect(warned).toBe(true);

      warnSpy.mockRestore();
      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: compensating vessel_mutation on reverted failure (MAE-328 fix A)
  // If the debounce already flushed the original transition mutation before a
  // slow runner fails and reverts, the engine keeps the stale target variant
  // unless told about the rollback.
  // --------------------------------------------------------------------------

  describe('invokeAction compensating revert mutation (MAE-328 fix A)', () => {
    it('schedules a second vessel_mutation announcing the revert once the original mutation already flushed', async () => {
      const instanceId = InstanceId('i-1');
      // A custom response (not createMockResponse, which only ever includes
      // a single hardcoded 'instance-1' entry) whose layout echoes back
      // `i-1` still in its post-transition 'expanded' variant — a
      // `set_layout` dispatch replaces the whole instances map, so a
      // response that omitted `i-1` would wipe it out and hide the bug
      // this test is targeting.
      const mockResponse: MaelstromResponse = {
        type: 'maelstrom_response',
        requestId: MessageId('req-1'),
        userMessage: 'ok',
        rationale: 'test',
        executionPlan: [],
        layout: {
          type: 'tiling',
          tree: [],
          instances: [
            {
              instanceId,
              vesselId: VesselId('sm'),
              variant: VariantName('expanded'),
            },
          ],
        },
      };
      const connector = createMockConnector({
        process: mock(() => Promise.resolve(mockResponse)),
      });
      const { orchestrator } = createTestOrchestrator(connector);
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      let resolveExpand: ((result: ActionResult) => void) | undefined;
      orchestrator.commandProcessor.registerRunner(instanceId, {
        expand: () =>
          new Promise<ActionResult>((resolve) => {
            resolveExpand = resolve;
          }),
      });

      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(instanceId, ActionName('expand'));
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');
      expect(scheduleSpy).toHaveBeenCalledTimes(1);

      // Let the deferred runner actually start (wiring `resolveExpand`)
      // before advancing the clock.
      await flushMicrotasks();

      // Advance past the debounce delay so the ORIGINAL mutation flushes to
      // the engine — the runner is still pending at this point.
      await clock.tickAsync(350);
      expect(connector.process).toHaveBeenCalledTimes(1);

      // The slow runner now fails, well after its mutation already shipped.
      resolveExpand?.(err(new Error('boom')));
      await orchestrator.commandProcessor.waitForIdle();
      await waitFor(() => currentVariant(orchestrator, instanceId) === 'collapsed');

      // The guarded revert restored the local store...
      expect(currentVariant(orchestrator, instanceId)).toBe('collapsed');

      // ...and a SECOND vessel_mutation was scheduled so the engine learns
      // about the rollback instead of keeping the stale target variant.
      expect(scheduleSpy).toHaveBeenCalledTimes(2);
      const revertReason = scheduleSpy.mock.calls[1][0];
      expect(revertReason.type).toBe('vessel_mutation');
      if (revertReason.type === 'vessel_mutation') {
        expect(revertReason.instanceId).toBe(instanceId);
        expect(revertReason.changes).toContain('expanded');
        expect(revertReason.changes).toContain('collapsed');
        expect(revertReason.changes).toContain('reverted');
      }

      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: updates_flushed must requeue when a request is already
  // in flight (MAE-328 fix B). UpdateCoordinator.flush() clears its buffer
  // before emitting, so an early return without requeueing loses the update.
  // --------------------------------------------------------------------------

  describe('updates_flushed requeues on in-flight request (MAE-328 fix B)', () => {
    it('does not drop a mutation flushed while a request is already in flight', async () => {
      let resolveFirst: ((v: MaelstromResponse) => void) | undefined;
      const mockResponse = createMockResponse(
        MessageId('req-1'),
        'instance-1',
        'show',
      );
      const connector = createMockConnector({
        process: mock(
          () =>
            new Promise<MaelstromResponse>((resolve) => {
              resolveFirst = resolve;
            }),
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      // Start a request that stays in flight.
      const intentPromise = orchestrator.processIntent('first');
      expect(orchestrator.requestCoordinator.isProcessing).toBe(true);

      // Schedule a mutation while that request is in flight.
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'dropped-without-fix',
      });

      // Advance past the debounce delay: 'updates_flushed' fires while
      // isProcessing is still true. Before the fix, the early-return branch
      // dropped `event.updates` on the floor (UpdateCoordinator.flush()
      // already cleared its own buffer before emitting) — no second send
      // happens here either way, but the update must survive for later.
      await clock.tickAsync(350);
      expect(connector.process).toHaveBeenCalledTimes(1);

      // Resolve the in-flight request.
      resolveFirst?.(mockResponse);
      await intentPromise;
      expect(orchestrator.requestCoordinator.isProcessing).toBe(false);

      // A fresh debounce cycle (started by the requeue) should now deliver
      // the previously-scheduled mutation.
      await clock.tickAsync(400);
      expect(connector.process).toHaveBeenCalledTimes(2);

      const secondEnvelope = (connector.process as ReturnType<typeof mock>)
        .mock.calls[1][0] as ChartRequestMessage;
      const updateReasons = secondEnvelope.request.context.updateReasons;
      expect(
        updateReasons.some(
          (r) =>
            r.type === 'vessel_mutation' && r.changes === 'dropped-without-fix',
        ),
      ).toBe(true);

      resolveFirst?.(mockResponse);
      await flushMicrotasks();
      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: mutations invoked while disconnected/reconnecting must
  // be preserved and replayed on reconnect (MAE-328 fix C). Mirrors the
  // existing pendingResize pattern.
  // --------------------------------------------------------------------------

  describe('invokeAction mutations held while disconnected, replayed on reconnect (MAE-328 fix C)', () => {
    it('holds the vessel_mutation while disconnected and replays it once reconnected', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      orchestrator.commandProcessor.registerRunner(instanceId, {
        expand: () => ok(undefined),
      });

      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      // createTestOrchestrator leaves connectionStatus 'disconnected' — a
      // click here must not flush into a closed connector.
      orchestrator.invokeAction(instanceId, ActionName('expand'));

      // The transition still applies locally...
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');
      // ...but the engine notification is held rather than scheduled
      // immediately, since there's no live session to receive it.
      expect(scheduleSpy).not.toHaveBeenCalled();

      await orchestrator.commandProcessor.waitForIdle();
      await flushMicrotasks();

      // Drive the same reconnect flow the codebase uses: connect() takes the
      // ConnectionManager through 'connecting' -> 'connected', emitting a
      // genuine 'connection_status_changed' event — unlike directly poking
      // connectionManager.store.setState (which bypasses the emitter and so
      // wouldn't exercise the replay handler at all).
      await orchestrator.connect();

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const reason = scheduleSpy.mock.calls[0][0];
      expect(reason.type).toBe('vessel_mutation');
      if (reason.type === 'vessel_mutation') {
        expect(reason.instanceId).toBe(instanceId);
        expect(reason.changes).toContain('collapsed');
        expect(reason.changes).toContain('expanded');
      }

      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // Bug regression: disconnect() must not discard a vessel_mutation that was
  // scheduled into the UpdateCoordinator while connected but hasn't flushed
  // yet. Reconnect only replays #pendingMutations (mutations scheduled while
  // disconnected), so a mutation still sitting in the coordinator's debounce
  // buffer at disconnect time was previously lost forever.
  // --------------------------------------------------------------------------

  describe('disconnect preserves an unflushed vessel_mutation across reconnect', () => {
    it('replays exactly once, after reconnect, a vessel_mutation still buffered in the coordinator at disconnect time', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      orchestrator.commandProcessor.registerRunner(instanceId, {
        expand: () => ok(undefined),
      });

      // Simulate connected state so invokeAction schedules the mutation
      // straight into the UpdateCoordinator (not into #pendingMutations).
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      // Invoke a transitionsTo action — schedules a vessel_mutation into the
      // coordinator's debounce buffer. Do NOT advance the clock past the
      // debounce, so it is still unflushed at this point.
      orchestrator.invokeAction(instanceId, ActionName('expand'));
      expect(currentVariant(orchestrator, instanceId)).toBe('expanded');

      await orchestrator.commandProcessor.waitForIdle();
      await flushMicrotasks();

      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      // Disconnect while the mutation is still unflushed in the coordinator.
      await orchestrator.disconnect();

      // Reconnect through the real ConnectionManager flow (genuine
      // 'connection_status_changed' → 'connected' emission) — the same
      // mechanism the existing pendingMutations replay test above uses,
      // since poking connectionManager.store.setState directly bypasses the
      // emitter and wouldn't exercise the replay handler at all.
      await orchestrator.connect();

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const reason = scheduleSpy.mock.calls[0][0];
      expect(reason.type).toBe('vessel_mutation');
      if (reason.type === 'vessel_mutation') {
        expect(reason.instanceId).toBe(instanceId);
      }

      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });
  });
});
