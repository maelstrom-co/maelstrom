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
  type ChartRequestMessage,
  err,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
  type SessionHistoryEntry,
  SessionId,
  type TilingLayout,
  VariantName,
  type Vessel,
  type VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import {
  createMockConnector,
  createTestOrchestrator,
} from '../../../test-utils/connector-mocks.js';
import {
  createMockEmptyResponse,
  createMockResponse,
} from '../../../test-utils/mocks.js';
import type { ActionResult } from '../command-processor/action-result.js';
import type {
  EngineConnector,
  PushConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe, VesselInstance } from '../types.js';
import { ConnectorSupersededError } from './connector-superseded-error.js';
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

// What a real transport does on a connector swap: ConnectionManager
// disconnects the outgoing connector, and WebSocketConnector.disconnect()
// rejects everything its correlator still has in flight. The default mock's
// no-op resolve hides that entire path, so a fenced send only ever *resolves*
// there.
function createDisconnectRejectingConnector(): EngineConnector {
  const inFlight = new Set<(error: Error) => void>();
  return createMockConnector({
    process: mock(
      () =>
        new Promise<MaelstromResponse>((_, reject) => {
          inFlight.add(reject);
        }),
    ),
    disconnect: mock(() => {
      for (const reject of inFlight) reject(new Error('Disconnected'));
      inFlight.clear();
      return Promise.resolve();
    }),
  });
}

type Settled<T> =
  | { readonly state: 'pending' }
  | { readonly state: 'resolved'; readonly value: T }
  | { readonly state: 'rejected'; readonly error: unknown };

// Observes how a promise settled without awaiting it — so a promise that
// never settles reads as 'pending' instead of hanging the test, and a
// rejection is captured rather than escaping as an unhandled rejection.
function track<T>(promise: Promise<T>): () => Settled<T> {
  let settled: Settled<T> = { state: 'pending' };
  promise.then(
    (value) => {
      settled = { state: 'resolved', value };
    },
    (error) => {
      settled = { state: 'rejected', error };
    },
  );
  return () => settled;
}

function sentReasons(
  connector: EngineConnector,
  callIndex = 0,
): readonly string[] {
  const envelope = (connector.process as ReturnType<typeof mock>).mock.calls[
    callIndex
  ][0] as ChartRequestMessage;
  return envelope.request.context.updateReasons.map((r) =>
    r.type === 'vessel_mutation' ? r.changes : r.type,
  );
}

// A vessel whose actions exercise every invokeAction branch: `expand` and
// `collapse` transition between variants, `ping` runs without transitioning,
// `refresh` self-transitions (transitionsTo names its own variant), and
// `collapse` lives only on `expanded` (to pin "current variant" semantics).
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
        {
          name: 'refresh',
          description: 'a self-transition back to the same variant',
          transitionsTo: 'collapsed',
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

// Polls until `predicate` holds, yielding microtasks between checks (without
// advancing timers past a still-pending deferred runner). Fails loudly rather
// than coupling assertions to a fixed microtask-hop count.
async function waitFor(
  predicate: () => boolean,
  maxTicks = 100,
): Promise<void> {
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

    it('rejects with ConnectorSupersededError when a connector swap fences the response', async () => {
      // Resolving with the ghost response would be indistinguishable from an
      // applied one: same non-nullable return type, same `userMessage`. A
      // realtime bridge hands that string straight to the speech adapter, so
      // the user hears a board change that never happened.
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      const pending = orchestrator.processIntent('show sales');
      orchestrator.setConnector(createMockConnector());

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );

      await expect(pending).rejects.toThrow(ConnectorSupersededError);

      orchestrator.dispose();
    });

    it('requeues a fenced-out processIntent() vessel_mutation instead of dropping it', async () => {
      // Same gap as flushUpdates() and the timer-flush handler: takeCoalesced()
      // already drained #pendingUpdates before the request was sent, so if the
      // fence at the top of processIntent just returns, the mutation reason is
      // gone for good — never dispatched, never returned to the coordinator.
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'must not vanish',
      });

      const pending = orchestrator.processIntent('show chart');
      // Bumps #connectorEpoch, fencing the in-flight intent's response.
      const second = createMockConnector();
      orchestrator.setConnector(second);

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      await expect(pending).rejects.toThrow(ConnectorSupersededError);

      // The mutation must have been requeued, not dropped — a subsequent
      // flush on the fresh connector must still carry it. Critically, the
      // synthetic user_intent from the fenced call must NOT be replayed —
      // only `pendingUpdates`, never `updates`.
      await orchestrator.flushUpdates();
      expect(second.process).toHaveBeenCalledTimes(1);
      const envelope = (second.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      expect(
        envelope.request.context.updateReasons.some(
          (r) =>
            r.type === 'vessel_mutation' && r.changes === 'must not vanish',
        ),
      ).toBe(true);
      expect(
        envelope.request.context.updateReasons.some(
          (r) => r.type === 'user_intent' && r.intent === 'show chart',
        ),
      ).toBe(false);

      orchestrator.dispose();
    });

    it('settles a queued flush promise instead of hanging it when processIntent()s in-flight request is fenced by a connector swap', async () => {
      // queueFlush()'s resolvers are cleared ONLY by resolveFlushPromises /
      // rejectFlushPromises / RequestCoordinator.dispose(). The fenced branch
      // above used to skip all three, so a flush queued behind an in-flight
      // processIntent() would hang forever once that intent got fenced out
      // by a connector swap — never resolved, never rejected.
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      const intentPromise = orchestrator.processIntent('show sales');

      // A concurrent flush queues behind the in-flight intent instead of
      // sending its own request.
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'queued behind the intent',
      });
      const flushPromise = orchestrator.flushUpdates();

      // Bumps #connectorEpoch, fencing the in-flight intent's response.
      orchestrator.setConnector(createMockConnector());

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      await expect(intentPromise).rejects.toThrow(ConnectorSupersededError);

      // The queued flush must settle, not hang — detect a hang via a
      // fake-timer race rather than letting the test itself stall.
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      );
      const racePromise = Promise.race([
        flushPromise.then((v) => ({ resolved: v }) as const),
        timeoutPromise,
      ]);
      await clock.tickAsync(6000);
      const result = await racePromise;

      expect(result).not.toBe('timeout');
      if (result !== 'timeout') {
        // The response was minted under a superseded connector and was
        // never applied — null (the same value flushUpdates() already
        // returns when there is nothing to report), not the ghost response.
        expect(result.resolved).toBeNull();
      }

      orchestrator.dispose();
    });

    it('recovers a fenced-out processIntent() whose send REJECTS on the connector swap', async () => {
      // A real swap makes the in-flight send reject, not resolve:
      // ConnectionManager.setConnector disconnects the outgoing connector and
      // WebSocketConnector.disconnect() rejects the correlator. That rejection
      // sails straight past a fence that only guards the success path, so the
      // drained updates vanish and the queued flush never settles.
      const first = createDisconnectRejectingConnector();
      const { orchestrator } = createTestOrchestrator(first);
      // Required: the swap only disconnects the outgoing connector when the
      // manager is already connected/connecting.
      await orchestrator.connect();

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'must not vanish',
      });

      const pending = orchestrator.processIntent('show chart');

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'queued behind the intent',
      });
      const queued = track(orchestrator.flushUpdates());

      const second = createMockConnector();
      orchestrator.setConnector(second);

      // processIntent keeps its rejection identity — a swap is not something
      // it can resolve a response for.
      await expect(pending).rejects.toThrow('Disconnected');
      await flushMicrotasks();

      expect(queued()).toEqual({ state: 'resolved', value: null });

      await orchestrator.flushUpdates();
      expect(second.process).toHaveBeenCalledTimes(1);
      const reasons = sentReasons(second);
      expect(reasons).toContain('must not vanish');
      expect(reasons).toContain('queued behind the intent');
      // Only `pendingUpdates` are replayed — the synthetic user_intent this
      // call appended is the caller's to re-issue.
      expect(reasons).not.toContain('user_intent');

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

    it('requeues a fenced-out flushUpdates() vessel_mutation instead of dropping it', async () => {
      // The fence in flushUpdates() discards the RESPONSE from a superseded
      // connector, correctly. But takeCoalesced() already drained
      // #pendingUpdates before the request was even sent — if the fenced
      // branch just returns, that update reason is gone for good: never
      // dispatched, never returned to the coordinator.
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'must not vanish',
      });

      const pending = orchestrator.flushUpdates();
      // Bumps #connectorEpoch, fencing the in-flight flush's response.
      const second = createMockConnector();
      orchestrator.setConnector(second);

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      const result = await pending;
      expect(result).toBeNull();

      // The mutation must have been requeued, not dropped — a subsequent
      // flush on the fresh connector must still carry it.
      await orchestrator.flushUpdates();
      expect(second.process).toHaveBeenCalledTimes(1);
      const envelope = (second.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      expect(
        envelope.request.context.updateReasons.some(
          (r) =>
            r.type === 'vessel_mutation' && r.changes === 'must not vanish',
        ),
      ).toBe(true);

      orchestrator.dispose();
    });

    it('requeues a fenced-out timer-triggered vessel_mutation instead of dropping it', async () => {
      // Same gap as above, in the internal updates_flushed handler that
      // fires from the debounce timer rather than a caller's flushUpdates().
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'must not vanish (timer path)',
      });

      // Fires the debounce timer → updates_flushed → #requestCoordinator.send
      // is now in flight against `first`.
      await clock.tickAsync(350);

      const second = createMockConnector();
      orchestrator.setConnector(second);

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      await waitFor(() => !orchestrator.requestCoordinator.isProcessing);

      await orchestrator.flushUpdates();
      expect(second.process).toHaveBeenCalledTimes(1);
      const envelope = (second.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      expect(
        envelope.request.context.updateReasons.some(
          (r) =>
            r.type === 'vessel_mutation' &&
            r.changes === 'must not vanish (timer path)',
        ),
      ).toBe(true);

      orchestrator.dispose();
    });

    it('settles a queued flush promise instead of hanging it when flushUpdates()s own in-flight request is fenced by a connector swap', async () => {
      // flushUpdates() itself sends the primary request here (nothing else
      // was in flight when it was called). A SECOND caller arriving while
      // that primary request is in flight queues via queueFlush() instead —
      // and that queued promise must settle too when the primary gets
      // fenced, not just the primary's own return value (already covered by
      // the requeue test above).
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'primary',
      });
      const primaryFlush = orchestrator.flushUpdates();

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'queued behind the primary',
      });
      const queuedFlush = orchestrator.flushUpdates();

      // Bumps #connectorEpoch, fencing the primary flush's response.
      orchestrator.setConnector(createMockConnector());

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      expect(await primaryFlush).toBeNull();

      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      );
      const racePromise = Promise.race([
        queuedFlush.then((v) => ({ resolved: v }) as const),
        timeoutPromise,
      ]);
      await clock.tickAsync(6000);
      const result = await racePromise;

      expect(result).not.toBe('timeout');
      if (result !== 'timeout') {
        expect(result.resolved).toBeNull();
      }

      orchestrator.dispose();
    });

    it("settles a queued flush promise instead of hanging it when the timer-triggered flush's own in-flight request is fenced by a connector swap", async () => {
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'timer-primary',
      });

      // Fires the debounce timer → updates_flushed → #requestCoordinator.send
      // is now in flight against `first`.
      await clock.tickAsync(350);

      // A caller arrives while the timer-triggered send is in flight — queues.
      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'queued behind the timer flush',
      });
      const queuedFlush = orchestrator.flushUpdates();

      // Bumps #connectorEpoch, fencing the timer-triggered request's response.
      orchestrator.setConnector(createMockConnector());

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      await waitFor(() => !orchestrator.requestCoordinator.isProcessing);

      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 5000),
      );
      const racePromise = Promise.race([
        queuedFlush.then((v) => ({ resolved: v }) as const),
        timeoutPromise,
      ]);
      await clock.tickAsync(6000);
      const result = await racePromise;

      expect(result).not.toBe('timeout');
      if (result !== 'timeout') {
        expect(result.resolved).toBeNull();
      }

      orchestrator.dispose();
    });

    it('recovers a fenced-out flushUpdates() whose send REJECTS on the connector swap', async () => {
      const first = createDisconnectRejectingConnector();
      const { orchestrator } = createTestOrchestrator(first);
      await orchestrator.connect();

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'primary',
      });
      const primary = track(orchestrator.flushUpdates());

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'queued behind the primary',
      });
      const queued = track(orchestrator.flushUpdates());

      const second = createMockConnector();
      orchestrator.setConnector(second);
      await flushMicrotasks();

      // A swap is not a failure: both settle with the same `null`
      // flushUpdates() already returns when there is nothing to report.
      expect(primary()).toEqual({ state: 'resolved', value: null });
      expect(queued()).toEqual({ state: 'resolved', value: null });

      await orchestrator.flushUpdates();
      expect(second.process).toHaveBeenCalledTimes(1);
      const reasons = sentReasons(second);
      expect(reasons).toContain('primary');
      expect(reasons).toContain('queued behind the primary');

      orchestrator.dispose();
    });

    it('logs the swallowed rejection with epoch context when a flush is fenced', async () => {
      // The `null` return is right — a swap is not a caller-visible failure —
      // but it is the same `null` that means "nothing to report", so without
      // a log a genuine transport rejection that merely raced the swap leaves
      // no trace at all. RequestCoordinator's own error log carries no epoch,
      // so it cannot say whether the fence ate this or something else did.
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const first = createDisconnectRejectingConnector();
      const { orchestrator } = createTestOrchestrator(first);

      try {
        await orchestrator.connect();
        orchestrator.scheduleUpdate({
          type: 'vessel_mutation',
          instanceId: InstanceId('i-1'),
          changes: 'primary',
        });
        const primary = track(orchestrator.flushUpdates());

        orchestrator.setConnector(createMockConnector());
        await flushMicrotasks();

        expect(primary()).toEqual({ state: 'resolved', value: null });

        const messages = warnSpy.mock.calls.map((args) => args.join(' '));
        expect(
          messages.some(
            (m) =>
              m.includes('epoch 0 → 1') &&
              m.includes('superseded') &&
              m.includes('Disconnected'),
          ),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
        orchestrator.dispose();
      }
    });

    it('recovers a fenced-out timer flush whose send REJECTS on the connector swap', async () => {
      const first = createDisconnectRejectingConnector();
      const { orchestrator } = createTestOrchestrator(first);
      await orchestrator.connect();

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'timer-primary',
      });

      // Fires the debounce timer → updates_flushed → #requestCoordinator.send
      // is now in flight against `first`.
      await clock.tickAsync(350);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-2'),
        changes: 'queued behind the timer flush',
      });
      const queued = track(orchestrator.flushUpdates());

      const second = createMockConnector();
      orchestrator.setConnector(second);
      await waitFor(() => !orchestrator.requestCoordinator.isProcessing);
      await flushMicrotasks();

      // This handler's catch rejects queued flushes, so a swap-induced
      // rejection used to surface as a `Disconnected` failure — contradicting
      // the success-path contract that a swap resolves `null`.
      expect(queued()).toEqual({ state: 'resolved', value: null });

      await orchestrator.flushUpdates();
      expect(second.process).toHaveBeenCalledTimes(1);
      const reasons = sentReasons(second);
      expect(reasons).toContain('timer-primary');
      expect(reasons).toContain('queued behind the timer flush');

      orchestrator.dispose();
    });

    it('still rejects a send failure that is NOT superseded', async () => {
      // The fence must only swallow rejections that a swap (or dispose)
      // caused. An ordinary transport failure under the current epoch keeps
      // propagating untouched.
      const connector = createMockConnector({
        process: mock(() => Promise.reject(new Error('engine down'))),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.scheduleUpdate({
        type: 'vessel_mutation',
        instanceId: InstanceId('i-1'),
        changes: 'test',
      });

      await expect(orchestrator.flushUpdates()).rejects.toThrow('engine down');

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

    it('discards a message from the OLD push transport delivered after a connector swap', () => {
      // Reproduces the dead epoch check: #attachPushSubscription used to
      // compare the LIVE #connectorEpoch field against itself
      // (`epoch !== this.#connectorEpoch`), which is always false. A
      // callback already queued by the old push transport when
      // setConnector() unsubscribes could therefore still dispatch a
      // layout minted by a superseded connector.
      let capturedCallback: ((response: MaelstromResponse) => void) | undefined;
      const first = createMockPushConnector({
        onPushMessage: mock(
          (cb: (response: MaelstromResponse) => void): Unsubscribe => {
            capturedCallback = cb;
            return () => {};
          },
        ),
      });
      const second = createMockPushConnector();
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.setConnector(second);

      // The old transport's callback fires anyway — modeling a message
      // already in flight when the unsubscribe happened.
      capturedCallback?.(
        createMockResponse(MessageId('req-ghost'), 'ghost-instance', 'show'),
      );

      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(0);

      orchestrator.dispose();
    });

    it('logs the discarded push message with epoch context', async () => {
      // An engine-authored layout is dropped whole here. Discarding is
      // legitimate, so the log is the only evidence it ever happened —
      // otherwise "the board stopped updating" is indistinguishable from a
      // message that was never sent.
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      let capturedCallback: ((response: MaelstromResponse) => void) | undefined;
      const first = createMockPushConnector({
        onPushMessage: mock(
          (cb: (response: MaelstromResponse) => void): Unsubscribe => {
            capturedCallback = cb;
            return () => {};
          },
        ),
      });
      const { orchestrator } = createTestOrchestrator(first);

      try {
        orchestrator.setConnector(createMockPushConnector());
        capturedCallback?.(
          createMockResponse(MessageId('req-ghost'), 'ghost-instance', 'show'),
        );

        const messages = warnSpy.mock.calls.map((args) => args.join(' '));
        expect(
          messages.some(
            (m) => m.includes('epoch 0 → 1') && m.includes('superseded'),
          ),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
        await orchestrator.dispose();
      }
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

    it('discards a response that resolves after dispose instead of throwing', async () => {
      let releaseResponse!: (response: MaelstromResponse) => void;
      const connector = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      // Start a request, then dispose while it is still in flight. This is the
      // exact shape the React Provider produced on every rebuild: dispose() runs
      // in effect cleanup while a processIntent promise is still pending.
      const pending = orchestrator.processIntent('show sales');
      await orchestrator.dispose();

      releaseResponse({
        type: 'maelstrom_response',
        requestId: MessageId('req-1'),
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      });

      // Must not reject with 'CommandProcessor is disposed'. The request was
      // legitimately issued, so the caller gets the response back — it simply is
      // never dispatched into a torn-down command processor.
      await expect(pending).resolves.toBeDefined();
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
          (a) =>
            typeof a === 'string' && a.includes('not available on variant'),
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
      await waitFor(
        () => currentVariant(orchestrator, instanceId) === 'collapsed',
      );

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

    it('runs the runner without transitioning (and without an engine update) for a self-transitioning action', async () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      let refreshed = false;
      orchestrator.commandProcessor.registerRunner(instanceId, {
        refresh: () => {
          refreshed = true;
          return ok(undefined);
        },
      });
      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(instanceId, ActionName('refresh'));

      // A self-transition (transitionsTo === current variant) is not a real
      // change — the variant must stay put immediately, and no engine update
      // is due once the runner has run.
      expect(currentVariant(orchestrator, instanceId)).toBe('collapsed');

      await orchestrator.commandProcessor.waitForIdle();
      await flushMicrotasks();

      expect(refreshed).toBe(true);
      expect(currentVariant(orchestrator, instanceId)).toBe('collapsed');
      expect(scheduleSpy).not.toHaveBeenCalled();

      scheduleSpy.mockRestore();
      orchestrator.dispose();
    });

    it('truncates an oversized serialized params blob in the scheduled vessel_mutation', () => {
      const { orchestrator } = createTestOrchestrator();
      orchestrator.vesselManager.registerVessel(stateMachineVessel);
      const instanceId = seedInstance(orchestrator, {
        instanceId: 'i-1',
        vesselId: 'sm',
        variant: 'collapsed',
      });
      orchestrator.connectionManager.store.setState((s) => ({
        ...s,
        connectionStatus: 'connected' as const,
      }));

      orchestrator.commandProcessor.registerRunner(instanceId, {
        expand: () => ok(undefined),
      });
      const scheduleSpy = spyOn(orchestrator, 'scheduleUpdate');

      orchestrator.invokeAction(instanceId, ActionName('expand'), {
        blob: 'x'.repeat(500),
      });

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const reason = scheduleSpy.mock.calls[0][0];
      expect(reason.type).toBe('vessel_mutation');
      if (reason.type === 'vessel_mutation') {
        // Truncated: bounded well under the ~500-char untruncated blob, and
        // carries the truncation marker so it's recognizable as cut off.
        expect(reason.changes).toContain('…');
        expect(reason.changes.length).toBeLessThan(300);
      }

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
      await waitFor(
        () => currentVariant(orchestrator, instanceId) === 'collapsed',
      );

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

      const secondEnvelope = (connector.process as ReturnType<typeof mock>).mock
        .calls[1][0] as ChartRequestMessage;
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

  // --------------------------------------------------------------------------
  // setLayoutMode
  // --------------------------------------------------------------------------

  describe('setLayoutMode', () => {
    it('changes the layoutMode carried by the next request without resetting the board', async () => {
      const sent: ChartRequestMessage[] = [];
      const connector = createMockConnector({
        process: mock(async (message: ChartRequestMessage) => {
          sent.push(message);
          return createMockEmptyResponse(message.id);
        }),
      });
      const { orchestrator } = createTestOrchestrator(connector, {
        layoutMode: 'tiling',
      });

      await orchestrator.processIntent('first');
      orchestrator.setLayoutMode('grid');
      await orchestrator.processIntent('second');

      expect(sent[0].request.context.layoutMode).toBe('tiling');
      expect(sent[1].request.context.layoutMode).toBe('grid');
      // The point of the setter: the engine sees the new mode without the
      // session being torn down. If a future change makes this rebuild
      // instead, the instance identity below changes and this assertion
      // catches it.
      expect(orchestrator.getViewState().layoutMode).toBe('grid');

      orchestrator.dispose();
    });

    it('carries a layout.type that agrees with context.layoutMode on the request built right after a mode change', async () => {
      const sent: ChartRequestMessage[] = [];
      const connector = createMockConnector({
        process: mock(async (message: ChartRequestMessage) => {
          sent.push(message);
          return createMockResponse(message.id, 'instance-1', 'show');
        }),
      });
      const { orchestrator } = createTestOrchestrator(connector, {
        layoutMode: 'tiling',
      });

      await orchestrator.processIntent('first');
      expect(orchestrator.commandProcessor.store.state.layout?.type).toBe(
        'tiling',
      );

      orchestrator.setLayoutMode('grid');
      await orchestrator.processIntent('second');

      // The wire schema rejects a request whose layout.type disagrees with
      // context.layoutMode. setLayoutMode itself does not touch the stored
      // layout (still 'tiling' in the store here) — buildChartRequest is
      // what reconciles the two at request-build time, so the request that
      // actually goes out must agree even though the store doesn't yet.
      expect(sent[1].request.context.layoutMode).toBe('grid');
      expect(sent[1].request.layout.type).toBe('grid');

      orchestrator.dispose();
    });

    it('keeps layout.type agreeing with the new mode even when an in-flight response lands a stale-type layout after the mode change (race)', async () => {
      // Empty execution plans (no runner-readiness wait involved) so the
      // command queue drains deterministically on `waitForIdle()` instead
      // of racing a real 500ms runner-timeout — that would be a second,
      // unrelated source of nondeterminism in this test.
      const sent: ChartRequestMessage[] = [];
      const resolvers: Array<(response: MaelstromResponse) => void> = [];
      const connector = createMockConnector({
        process: mock((message: ChartRequestMessage) => {
          sent.push(message);
          return new Promise<MaelstromResponse>((resolve) => {
            resolvers.push(resolve);
          });
        }),
      });
      const { orchestrator } = createTestOrchestrator(connector, {
        layoutMode: 'tiling',
      });

      // First request/response: seed a tiling layout into the store.
      const first = orchestrator.processIntent('first');
      resolvers[0]?.(createMockEmptyResponse(sent[0].id));
      await first;
      await orchestrator.commandProcessor.waitForIdle();
      expect(orchestrator.commandProcessor.store.state.layout?.type).toBe(
        'tiling',
      );

      // Second request goes out under the still-active 'tiling' mode and
      // stays in flight (its own response has not resolved yet).
      const second = orchestrator.processIntent('second');

      // The mode flips while that request is outstanding.
      orchestrator.setLayoutMode('grid');

      // The in-flight response now lands, carrying a tiling-typed layout —
      // it was planned by the engine under the mode that was active when
      // the request went out. #dispatchResponse writes it straight into the
      // store, regardless of what the mode has since become.
      resolvers[1]?.(createMockEmptyResponse(sent[1].id));
      await second;
      await orchestrator.commandProcessor.waitForIdle();

      // Confirms the race actually landed: the store now holds a 'tiling'
      // layout again even though the mode is 'grid'. A fix that clears the
      // stored layout only at setLayoutMode-time is too early — the write
      // above happened after that clear. If this assertion itself fails,
      // the race this test targets didn't occur and the test below proves
      // nothing.
      expect(orchestrator.commandProcessor.store.state.layout?.type).toBe(
        'tiling',
      );

      // The invariant has to hold at request-build time instead, so the
      // next request must still agree despite the stale store contents.
      const third = orchestrator.processIntent('third');
      resolvers[2]?.(createMockEmptyResponse(sent[2].id));
      await third;
      expect(sent[2].request.context.layoutMode).toBe('grid');
      expect(sent[2].request.layout.type).toBe('grid');

      orchestrator.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // setConnector
  // --------------------------------------------------------------------------

  describe('setConnector', () => {
    it('routes subsequent calls to the new connector', async () => {
      const first = createMockConnector();
      const second = createMockConnector();
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.setConnector(second);
      await orchestrator.processIntent('hello');

      expect(first.process).toHaveBeenCalledTimes(0);
      expect(second.process).toHaveBeenCalledTimes(1);

      orchestrator.dispose();
    });

    it('moves the push subscription and leaves the others attached', async () => {
      const firstUnsub = mock((): void => {});
      const first = createMockPushConnector({
        onPushMessage: mock(
          (_cb: (response: MaelstromResponse) => void): Unsubscribe =>
            firstUnsub,
        ),
      });
      const second = createMockPushConnector();
      const { orchestrator } = createTestOrchestrator(first);
      // The 'dimensions_changed' handler only schedules while connected, so
      // an unconnected orchestrator would no-op with the subscription intact
      // and prove nothing.
      await orchestrator.connect();

      orchestrator.setConnector(second);

      // Detached from the old connector...
      expect(firstUnsub).toHaveBeenCalledTimes(1);
      // ...re-attached to the new one.
      expect(second.onPushMessage).toHaveBeenCalledTimes(1);
      // The other three subscriptions are on internal microkernels and have
      // nothing to do with the connector. Asserting the ChartManager store
      // would prove nothing — setDimensions writes it whether or not anyone
      // is subscribed. What the surviving subscription buys is the scheduled
      // chart_resize, so assert on what actually reaches the wire.
      // The swap redials in the background; the handler is gated on
      // 'connected', so wait for the new connector to be live first.
      await waitFor(
        () =>
          orchestrator.connectionManager.store.state.connectionStatus ===
          'connected',
      );
      orchestrator.chartManager.setDimensions({ columns: 8, rows: 4 });
      await orchestrator.flushUpdates();

      expect(second.process).toHaveBeenCalledTimes(1);
      expect(sentReasons(second)).toContain('chart_resize');

      orchestrator.dispose();
    });

    it('applies a push message delivered through the NEW connector', () => {
      // The counterpart to the discard test: `setConnector` bumps the epoch
      // before re-attaching, so the new subscription captures the new epoch.
      // Reverse that ordering and every push message after a swap is silently
      // dropped — with the rest of the suite still green.
      let secondCallback: ((response: MaelstromResponse) => void) | undefined;
      const first = createMockPushConnector();
      const second = createMockPushConnector({
        onPushMessage: mock(
          (cb: (response: MaelstromResponse) => void): Unsubscribe => {
            secondCallback = cb;
            return () => {};
          },
        ),
      });
      const { orchestrator } = createTestOrchestrator(first);

      orchestrator.setConnector(second);
      secondCallback?.(
        createMockResponse(MessageId('req-live'), 'live-instance', 'show'),
      );

      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(1);

      orchestrator.dispose();
    });

    it('after dispose does not subscribe to the incoming connector', async () => {
      const first = createMockPushConnector();
      const second = createMockPushConnector();
      const { orchestrator } = createTestOrchestrator(first);

      await orchestrator.dispose();
      orchestrator.setConnector(second);

      // dispose() early-returns on a second call, so a subscription attached
      // after it is never torn down: the incoming connector would hold a live
      // callback closing over the disposed Orchestrator forever.
      expect(second.onPushMessage).not.toHaveBeenCalled();
    });

    it('after dispose leaves the layout mode alone', async () => {
      const { orchestrator } = createTestOrchestrator(createMockConnector(), {
        layoutMode: 'tiling',
      });

      await orchestrator.dispose();
      orchestrator.setLayoutMode('grid');

      expect(orchestrator.getConfig().layoutMode).toBe('tiling');
    });

    it('with the same reference is a no-op', () => {
      const unsub = mock((): void => {});
      const connector = createMockPushConnector({
        onPushMessage: mock(
          (_cb: (response: MaelstromResponse) => void): Unsubscribe => unsub,
        ),
      });
      const { orchestrator } = createTestOrchestrator(connector);

      orchestrator.setConnector(connector);

      expect(unsub).not.toHaveBeenCalled();

      orchestrator.dispose();
    });

    it('discards a response from a connector that has since been swapped', async () => {
      let releaseResponse!: (response: MaelstromResponse) => void;
      const first = createMockConnector({
        process: () =>
          new Promise<MaelstromResponse>((resolve) => {
            releaseResponse = resolve;
          }),
      });
      const { orchestrator } = createTestOrchestrator(first);

      const pending = orchestrator.processIntent('show sales');
      orchestrator.setConnector(createMockConnector());

      releaseResponse(
        createMockResponse(MessageId('req-ghost'), 'ghost', 'someAction'),
      );
      await expect(pending).rejects.toThrow(ConnectorSupersededError);

      // The whole point of the fence: a response minted by a connector that
      // has been replaced (the re-auth case) must never reach the screen.
      // Without this, a layout computed under revoked credentials lands on
      // the board.
      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(0);

      orchestrator.dispose();
    });
  });

  // A vessel a seed can validly reference — registered via the `vessels`
  // constructor option, which runs before the seed is validated (the
  // ordering that makes construction-time validation possible at all).
  const calendarVessel = {
    id: 'calendar',
    name: 'Calendar',
    description: 'a test calendar vessel',
    defaultVariant: 'day',
    variants: {
      day: { props: {}, minSize: { width: 2, height: 2 }, actions: [] },
    },
  } as const;

  // Fails VesselSchema: `variants` is empty and `defaultVariant` names a
  // variant that therefore cannot exist.
  const brokenVessel: VesselDefinition = {
    id: 'broken',
    name: 'Broken',
    description: 'a vessel with no variants',
    defaultVariant: 'x',
    variants: {},
  };

  // The minimal seed every initialLayout test starts from: one calendar
  // instance, treed. Tests spread and override the one field under test.
  const calendarSeed: TilingLayout = {
    type: 'tiling',
    tree: [InstanceId('calendar-main')],
    instances: [
      {
        instanceId: InstanceId('calendar-main'),
        vesselId: VesselId('calendar'),
        variant: VariantName('day'),
      },
    ],
  };

  describe('Orchestrator initialLayout', () => {
    it('seeds an instance before any engine response', async () => {
      const { connector, orchestrator } = createTestOrchestrator(undefined, {
        vessels: [calendarVessel],
        initialLayout: calendarSeed,
      });

      await orchestrator.commandProcessor.waitForIdle();

      const seeded = orchestrator.commandProcessor.store.state.instances.get(
        InstanceId('calendar-main'),
      );
      expect(seeded?.vesselId).toBe(VesselId('calendar'));
      expect(seeded?.variant).toBe(VariantName('day'));
      // The "before any engine response" half of the title: an eager
      // construction-time request would leave this test green and its name
      // false.
      expect(connector.process).not.toHaveBeenCalled();

      orchestrator.dispose();
    });

    // The store is an intermediate. What the feature promises is that the
    // engine *sees* the proposal, which means surviving buildChartRequest's
    // layout/mode reconciliation and landing on the wire.
    it('carries the seeded tree and instances into the first chart request', async () => {
      const { connector, orchestrator } = createTestOrchestrator(undefined, {
        vessels: [calendarVessel],
        initialLayout: calendarSeed,
      });

      await orchestrator.connect();
      orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });
      await orchestrator.flushUpdates();

      const { request } = (connector.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      expect(request.layout.type).toBe('tiling');
      expect(
        request.layout.type === 'tiling' ? request.layout.tree : [],
      ).toContain(InstanceId('calendar-main'));
      expect(request.instances).toEqual([
        {
          instanceId: InstanceId('calendar-main'),
          vesselId: VesselId('calendar'),
          variant: VariantName('day'),
        },
      ]);

      orchestrator.dispose();
    });

    it('rejects a grid initialLayout outright — a grid layout only repositions instances that already exist, and none do at construction', () => {
      expect(() =>
        createTestOrchestrator(undefined, {
          // @ts-expect-error initialLayout is typed TilingLayout-only; this
          // exercises the runtime guard a plain-JS or `as`-cast caller can
          // still trigger.
          initialLayout: { type: 'grid', positions: [] },
        }),
      ).toThrow(/grid layout/i);
    });

    // Guard ordering: a grid seed must still produce the grid-specific
    // message above, even though it is also a layoutMode mismatch whenever
    // layoutMode defaults to 'tiling' — the grid check must run first.
    it('still produces the grid-specific message for a grid seed, not the mismatch message, when layoutMode also happens to mismatch', () => {
      expect(() =>
        createTestOrchestrator(undefined, {
          layoutMode: 'tiling',
          // @ts-expect-error same runtime-guard exercise as above.
          initialLayout: { type: 'grid', positions: [] },
        }),
      ).toThrow(/grid layout/i);
    });

    it('rejects a layoutMode/initialLayout type mismatch — a mismatched seed would be silently discarded by buildChartRequest on the first request, so fail fast instead of half-applying it', () => {
      expect(() =>
        createTestOrchestrator(undefined, {
          layoutMode: 'grid',
          vessels: [calendarVessel],
          // @ts-expect-error the options union makes `initialLayout`
          // unrepresentable under layoutMode: 'grid'; this exercises the
          // runtime backstop a plain-JS or `as`-cast caller can still trip.
          initialLayout: calendarSeed,
        }),
      ).toThrow(/initialLayout.*"tiling".*layoutMode.*"grid"/is);
    });

    // The constructor guard makes the mismatch look impossible, but
    // setLayoutMode reopens it one call later through supported public API
    // — and the React Provider drives that setter straight from a prop.
    it('discards the seeded board with a warning when setLayoutMode flips to grid after construction', async () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const { connector, orchestrator } = createTestOrchestrator(undefined, {
        vessels: [calendarVessel],
        initialLayout: calendarSeed,
      });

      await orchestrator.commandProcessor.waitForIdle();
      await orchestrator.connect();
      orchestrator.setLayoutMode('grid');

      // The discard is announced, not silent — this warning is the only
      // signal a developer gets that their seeded screen just went away.
      const discardWarnings = warnSpy.mock.calls.filter((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('setLayoutMode("grid")'),
        ),
      );
      expect(discardWarnings).toHaveLength(1);

      orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });
      await orchestrator.flushUpdates();

      const { request } = (connector.process as ReturnType<typeof mock>).mock
        .calls[0][0] as ChartRequestMessage;
      expect(request.layout).toEqual({ type: 'grid', positions: [] });

      warnSpy.mockRestore();
      orchestrator.dispose();
    });

    describe('validated against the vessel registry', () => {
      // Discriminates the "never listed" branch from its sibling below:
      // both messages name the instance and the vessel, so only the
      // branch-specific phrase tells them apart.
      it('throws naming the instance and vessel when the vessel is unregistered', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            initialLayout: calendarSeed,
          }),
        ).toThrow(/calendar-main.*calendar.*is not registered/is);
      });

      it('throws naming the instance and variant when the variant is undeclared on the vessel', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            initialLayout: {
              ...calendarSeed,
              instances: [
                {
                  instanceId: InstanceId('calendar-main'),
                  vesselId: VesselId('calendar'),
                  variant: VariantName('week'),
                },
              ],
            },
          }),
        ).toThrow(/calendar-main.*week|week.*calendar-main/);
      });

      it('constructs and applies a seed whose vessel and variant are both valid', async () => {
        const { orchestrator } = createTestOrchestrator(undefined, {
          vessels: [calendarVessel],
          initialLayout: calendarSeed,
        });

        await orchestrator.commandProcessor.waitForIdle();
        expect(
          orchestrator.commandProcessor.store.state.instances.get(
            InstanceId('calendar-main'),
          )?.variant,
        ).toBe(VariantName('day'));

        orchestrator.dispose();
      });
    });

    describe('validated tiling tree invariants', () => {
      it('throws when initialLayout.instances contains a duplicate instanceId', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            initialLayout: {
              ...calendarSeed,
              instances: [...calendarSeed.instances, ...calendarSeed.instances],
            },
          }),
        ).toThrow(/duplicate.*calendar-main/i);
      });

      it('throws when initialLayout.tree references a leaf absent from initialLayout.instances', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            initialLayout: {
              ...calendarSeed,
              tree: [InstanceId('ghost-main')],
            },
          }),
        ).toThrow(/ghost-main/);
      });

      // The dual of the check above, and the likelier authoring slip: a
      // typo'd leaf already throws, but forgetting the leaf entirely used to
      // construct cleanly and render nothing — the empty launch screen this
      // whole feature exists to remove.
      it('throws when initialLayout.instances declares an instance no tree leaf references', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            initialLayout: {
              ...calendarSeed,
              instances: [
                ...calendarSeed.instances,
                {
                  instanceId: InstanceId('calendar-orphan'),
                  vesselId: VesselId('calendar'),
                  variant: VariantName('day'),
                },
              ],
            },
          }),
        ).toThrow(/calendar-orphan/);
      });

      it('throws when the whole seed is untreed (instances declared, tree empty)', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            initialLayout: { ...calendarSeed, tree: [] },
          }),
        ).toThrow(/calendar-main/);
      });

      it('constructs when the seed satisfies both invariants (two leaves joined by a split, no duplicates)', async () => {
        const { orchestrator } = createTestOrchestrator(undefined, {
          vessels: [calendarVessel],
          initialLayout: {
            type: 'tiling',
            tree: [
              'H',
              InstanceId('calendar-main'),
              InstanceId('calendar-side'),
            ],
            instances: [
              {
                instanceId: InstanceId('calendar-main'),
                vesselId: VesselId('calendar'),
                variant: VariantName('day'),
              },
              {
                instanceId: InstanceId('calendar-side'),
                vesselId: VesselId('calendar'),
                variant: VariantName('day'),
              },
            ],
          },
        });

        await orchestrator.commandProcessor.waitForIdle();
        expect(orchestrator.commandProcessor.store.state.instances.size).toBe(
          2,
        );

        orchestrator.dispose();
      });

      // A seed that proposes nothing is a legal no-op, not a wedge: there is
      // no instance to strand and nothing for the engine to reject.
      it('constructs with zero instances from an empty seed', async () => {
        const { orchestrator } = createTestOrchestrator(undefined, {
          vessels: [calendarVessel],
          initialLayout: { type: 'tiling', tree: [], instances: [] },
        });

        await orchestrator.commandProcessor.waitForIdle();
        expect(orchestrator.commandProcessor.store.state.instances.size).toBe(
          0,
        );

        orchestrator.dispose();
      });

      it('constructs when the tree carries a null empty-space node', async () => {
        const { orchestrator } = createTestOrchestrator(undefined, {
          vessels: [calendarVessel],
          initialLayout: {
            ...calendarSeed,
            tree: ['V', InstanceId('calendar-main'), null],
          },
        });

        await orchestrator.commandProcessor.waitForIdle();
        expect(orchestrator.commandProcessor.store.state.instances.size).toBe(
          1,
        );

        orchestrator.dispose();
      });

      // Tolerated rather than validated: both membership directions hold, so
      // the seed is coherent — the renderer decides what a twice-placed leaf
      // means. Pinned here so a future decision to reject it is a deliberate
      // change rather than an accident.
      it('constructs when the same instance appears as a tree leaf twice', async () => {
        const { orchestrator } = createTestOrchestrator(undefined, {
          vessels: [calendarVessel],
          initialLayout: {
            ...calendarSeed,
            tree: [
              'V',
              InstanceId('calendar-main'),
              InstanceId('calendar-main'),
            ],
          },
        });

        await orchestrator.commandProcessor.waitForIdle();
        expect(orchestrator.commandProcessor.store.state.instances.size).toBe(
          1,
        );

        orchestrator.dispose();
      });
    });

    // The bespoke invariant checks below assume a shape-valid seed, which an
    // untyped (JS) caller or a `JSON.parse`d/persisted layout does not
    // guarantee. Without a schema parse first, a missing array throws a bare
    // `TypeError: undefined is not iterable` and an empty-string instanceId
    // rides through to fail ChartRequestSchema on every later request.
    describe('shape-validated before the invariant checks', () => {
      it('throws a diagnostic error, not a TypeError, when instances is missing', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            // @ts-expect-error exercises the runtime backstop for a seed
            // that never passed through the type system.
            initialLayout: { type: 'tiling', tree: [] },
          }),
        ).toThrow(/initialLayout is not a valid tiling layout/i);
      });

      it('throws a diagnostic error, not a TypeError, when tree is missing', () => {
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            // @ts-expect-error same runtime-backstop exercise as above.
            initialLayout: { type: 'tiling', instances: [] },
          }),
        ).toThrow(/initialLayout is not a valid tiling layout/i);
      });

      it('rejects an empty-string instanceId that the compile-time brand cannot stop', () => {
        // The brand's own constructor rejects '', so a cast is how one
        // actually arrives — same as a `JSON.parse`d or persisted seed.
        const emptyId = '' as InstanceId;
        expect(() =>
          createTestOrchestrator(undefined, {
            vessels: [calendarVessel],
            initialLayout: {
              type: 'tiling',
              tree: [emptyId],
              instances: [
                {
                  instanceId: emptyId,
                  vesselId: VesselId('calendar'),
                  variant: VariantName('day'),
                },
              ],
            },
          }),
        ).toThrow(/initialLayout is not a valid tiling layout/i);
      });
    });

    // Every throwing check must run before #setupSubscriptions(), which
    // installs a push subscription on the caller-supplied connector that a
    // rejected construction can never dispose — the connector outlives the
    // failed attempt and the caller keeps using it.
    it('leaves no push subscription on the connector when construction throws', () => {
      const pushConnector = createMockPushConnector();

      expect(() =>
        createTestOrchestrator(pushConnector, {
          initialLayout: calendarSeed,
        }),
      ).toThrow();

      expect(pushConnector.onPushMessage).not.toHaveBeenCalled();
    });

    // Ordering hardening: the PushConnector interface makes no ordering
    // promise, so the seed is applied first to stay a proposal a replayed
    // response can overwrite.
    it('applies the seed before subscriptions attach, so a synchronously-replayed push response still lands on top of it', async () => {
      const pushedResponse: MaelstromResponse = {
        type: 'maelstrom_response',
        requestId: MessageId('req-push'),
        userMessage: 'pushed',
        rationale: 'test',
        executionPlan: [],
        layout: {
          type: 'tiling',
          tree: [InstanceId('pushed-main')],
          instances: [
            {
              instanceId: InstanceId('pushed-main'),
              vesselId: VesselId('calendar'),
              variant: VariantName('day'),
            },
          ],
        },
      };
      const pushConnector = createMockPushConnector({
        onPushMessage: mock((cb: (response: MaelstromResponse) => void) => {
          cb(pushedResponse);
          return () => {};
        }),
      });

      const { orchestrator } = createTestOrchestrator(pushConnector, {
        vessels: [calendarVessel],
        initialLayout: calendarSeed,
      });

      await orchestrator.commandProcessor.waitForIdle();

      const layout = orchestrator.commandProcessor.store.state.layout;
      expect(layout?.type).toBe('tiling');
      expect(
        layout?.type === 'tiling' &&
          layout.instances.some(
            (i) => i.instanceId === InstanceId('pushed-main'),
          ),
      ).toBe(true);

      orchestrator.dispose();
    });
  });

  describe('Orchestrator vessels option', () => {
    // One invalid vessel definition must not abort construction —
    // registerVessel reports and skips (see vessel-manager.ts); only a
    // vessel an initialLayout seed names escalates to a throw.
    it('skips an invalid vessel definition and registers the rest — an unrelated typo must not abort construction', () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const { orchestrator } = createTestOrchestrator(undefined, {
        vessels: [brokenVessel, calendarVessel],
      });

      // The invalid vessel never entered the registry...
      expect(orchestrator.vesselManager.has('broken')).toBe(false);
      // ...but the valid one alongside it did, and is actually usable.
      expect(orchestrator.vesselManager.has('calendar')).toBe(true);
      expect(orchestrator.vesselManager.get('calendar')?.defaultVariant).toBe(
        VariantName('day'),
      );
      // With the throw gone, this log IS the contract: it is the only way a
      // developer learns their vessel silently vanished, so assert it named
      // the vessel and said why — not merely that something logged.
      const brokenReports = errorSpy.mock.calls.filter((args) =>
        args.some((a) => typeof a === 'string' && a.includes('"broken"')),
      );
      expect(brokenReports).toHaveLength(1);
      expect(JSON.stringify(brokenReports[0])).toContain(
        'at least one variant',
      );

      errorSpy.mockRestore();
      orchestrator.dispose();
    });

    // Each invalid definition is skipped on its own: aggregating them into a
    // single throw is what let one bad vessel take down construction.
    it('skips multiple invalid vessel definitions independently instead of throwing', () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const { orchestrator } = createTestOrchestrator(undefined, {
        vessels: [
          { ...brokenVessel, id: 'broken-a', name: 'Broken A' },
          { ...brokenVessel, id: 'broken-b', name: 'Broken B' },
        ],
      });

      expect(orchestrator.vesselManager.has('broken-a')).toBe(false);
      expect(orchestrator.vesselManager.has('broken-b')).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(2);

      errorSpy.mockRestore();
      orchestrator.dispose();
    });

    it('registers a valid vessel with no error logged', () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      const { orchestrator } = createTestOrchestrator(undefined, {
        vessels: [calendarVessel],
      });

      expect(orchestrator.vesselManager.has('calendar')).toBe(true);
      expect(orchestrator.vesselManager.get('calendar')?.defaultVariant).toBe(
        VariantName('day'),
      );
      // The one thing the mixed valid/invalid test above cannot assert: a
      // clean vessel list reports nothing at all.
      expect(errorSpy).not.toHaveBeenCalled();

      errorSpy.mockRestore();
      orchestrator.dispose();
    });

    // The exception to report-don't-throw: a vessel an initialLayout seed
    // actually names is one construction cannot proceed without, so a
    // definition that failed validation (and therefore never made it into
    // the registry) must still surface as a throw naming the vessel —
    // silently producing a broken first screen would be worse than the
    // white-screen this fix removes for unrelated vessels.
    it('still throws naming the vessel when initialLayout seeds an instance whose vessel definition failed validation', () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      expect(
        () =>
          createTestOrchestrator(undefined, {
            vessels: [brokenVessel],
            initialLayout: {
              type: 'tiling',
              tree: [InstanceId('broken-main')],
              instances: [
                {
                  instanceId: InstanceId('broken-main'),
                  vesselId: VesselId('broken'),
                  variant: VariantName('x'),
                },
              ],
            },
          }),
        // The generic "is not registered" message would satisfy a looser
        // regex just as well; only the branch-specific phrase plus the
        // schema issue text proves the failed-validation diagnostic
        // survived.
      ).toThrow(/broken-main.*broken.*failed vessel validation/is);

      expect(() =>
        createTestOrchestrator(undefined, {
          vessels: [brokenVessel],
          initialLayout: {
            type: 'tiling',
            tree: [InstanceId('broken-main')],
            instances: [
              {
                instanceId: InstanceId('broken-main'),
                vesselId: VesselId('broken'),
                variant: VariantName('x'),
              },
            ],
          },
        }),
      ).toThrow(/at least one variant/);

      errorSpy.mockRestore();
    });
  });
});
