import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  type EngineConnector,
  type IntentQueueOptions,
  type IntentScope,
  Orchestrator,
} from '@maelstrom-co/client';
import {
  ActionName,
  type ChartRequestMessage,
  err,
  InstanceId,
  type MaelstromResponse,
  ok,
  SessionId,
  ToolCallId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { GreetingCoordinator } from '../greeting-coordinator.js';
import { RealtimeVoiceError } from '../realtime-voice-error.js';
import type {
  RealtimeAdapterEvent,
  RealtimeGreetingAdapter,
  RealtimeProviderAdapter,
  ToolResult,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type { RealtimeInstance } from './realtime-session.types.js';
import type { SessionEvent } from './session-event-bus.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const sessionId = SessionId('voice-queue');

function adapter() {
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  const results: Array<{ callId: ToolCallId; result: ToolResult }> = [];
  const instance: RealtimeProviderAdapter & RealtimeGreetingAdapter = {
    activateAudio: () => {},
    speakAssistantText: async () => 'accepted',
    observations: { subscribe: () => () => {} },
    connect: async () => {},
    disconnect: async () => {},
    getAudioStreams: () => ({}),
    injectGrounding: () => {},
    sendToolResult: async (callId, result) => {
      results.push({ callId, result });
    },
    on: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
  return {
    instance,
    results,
    emit: (event: RealtimeAdapterEvent) => {
      for (const handler of handlers) handler(event);
    },
    call: (id: string) => {
      for (const handler of handlers)
        handler({
          type: 'tool_call',
          callId: ToolCallId(id),
          name: 'update_ui',
          argumentsJson: JSON.stringify({ intent: id }),
        });
    },
  };
}

function response(request: ChartRequestMessage): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: request.id,
    userMessage: 'Engine reply',
    rationale: '',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}

describe('RealtimeSession shared intent admission', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  const cleanup: Array<() => Promise<void>> = [];
  beforeEach(() => {
    clock = FakeTimers.install();
  });
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
    clock.uninstall();
  });

  async function setup(policy: IntentQueueOptions = {}, greeting = false) {
    const sent: ChartRequestMessage[] = [];
    const pending: ReturnType<typeof deferred<MaelstromResponse>>[] = [];
    const connector: EngineConnector = {
      capabilities: { voice: false, streaming: false, stateful: false },
      connect: async () => {},
      disconnect: async () => {},
      subscribe: () => () => {},
      getHistory: async () => [],
      addAssistantMessage: async () => {},
      process: (request) => {
        sent.push(request);
        const gate = deferred<MaelstromResponse>();
        pending.push(gate);
        return gate.promise;
      },
    };
    const client = new Orchestrator(connector, {
      sessionId,
      intentQueue: policy,
    });
    cleanup.push(() => client.dispose());
    await client.connect();
    const scopes: IntentScope[] = [];
    const bridge: RealtimeInstance = {
      createIntentScope: () => {
        const scope = client.createIntentScope();
        scopes.push(scope);
        return scope;
      },
      submitIntent: async () => {
        throw new Error('Queued bridge used legacy admission');
      },
      waitForIdle: async () => {
        throw new Error('Queued bridge used global idle');
      },
      waitForIdleResult: async () => {
        throw new Error('Queued bridge used global idle result');
      },
      getStructuralSnapshot: () => client.getStructuralSnapshot(),
      getCapabilitySnapshot: () => client.getCapabilitySnapshot(),
      onSettled: (cb) => client.onSettled(cb),
      addAssistantMessageAcknowledged: async () => 'inserted',
      observeEngineConnection: (cb) => {
        cb(true);
        return () => {};
      },
    };
    const provider = adapter();
    const session = new RealtimeSession({
      sessionId,
      instance: bridge,
      adapter: provider.instance,
      ...(greeting
        ? {
            greeting: {
              text: 'Hello.',
              coordinator: new GreetingCoordinator(),
            },
          }
        : {}),
    });
    cleanup.push(() => session.dispose());
    const events: SessionEvent[] = [];
    session.events.subscribe((event) => events.push(event));
    await session.connect();
    return {
      client,
      session,
      provider,
      bridge,
      scopes,
      connector,
      sent,
      pending,
      events,
      finish: async (index: number) => {
        pending[index].resolve(response(sent[index]));
        await clock.tickAsync(0);
      },
    };
  }

  it('holds a 3s resize through action settlement, then dispatches every typed/voice intent FIFO with latest state', async () => {
    const state = await setup();
    const { client, provider, sent, pending, events } = state;
    client.chartManager.setDimensions({ columns: 10, rows: 6 });
    await clock.tickAsync(350);
    const action = deferred<ReturnType<typeof ok<undefined>>>();
    client.commandProcessor.registerRunner(InstanceId('one'), {
      show: () => action.promise,
    });
    provider.call('voice-one');
    const typed = client.enqueueIntent('typed-two');
    provider.call('voice-three');
    for (let width = 11; width <= 20; width++) {
      client.chartManager.setDimensions({ columns: width, rows: 6 });
      await clock.tickAsync(300);
    }
    expect(sent).toHaveLength(1);
    expect(
      events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(0);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['queued', 'queued']);
    pending[0].resolve({
      ...response(sent[0]),
      layout: {
        type: 'tiling',
        tree: [],
        instances: [
          {
            instanceId: InstanceId('one'),
            vesselId: VesselId('vessel'),
            variant: VariantName('default'),
          },
        ],
      },
      executionPlan: [
        { instanceId: InstanceId('one'), action: ActionName('show') },
      ],
    });
    await clock.tickAsync(0);
    expect(client.requestCoordinator.isProcessing).toBe(false);
    expect(sent).toHaveLength(1);
    expect(provider.results).toHaveLength(0);
    action.resolve(ok(undefined));
    await clock.tickAsync(0);
    expect(sent).toHaveLength(2);
    expect(sent[1].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'voice-one',
    });
    expect(sent[1].request.context.updateReasons).toContainEqual({
      type: 'chart_resize',
      previous: { columns: 19, rows: 6 },
      current: { columns: 20, rows: 6 },
    });
    await state.finish(1);
    expect(provider.results).toEqual([
      {
        callId: ToolCallId('voice-one'),
        result: {
          ok: true,
          summary: 'The screen is empty.',
          userMessage: 'Engine reply',
        },
      },
    ]);
    expect(sent[2].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'typed-two',
    });
    await state.finish(2);
    expect((await typed.result).status).toBe('applied');
    expect(sent[3].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'voice-three',
    });
    await state.finish(3);
    await clock.tickAsync(1000);
    expect(sent).toHaveLength(4);
    expect(provider.results.map((value) => value.callId)).toEqual([
      ToolCallId('voice-one'),
      ToolCallId('voice-three'),
    ]);
    expect(events.filter((event) => event.type === 'tool.result')).toHaveLength(
      2,
    );
    expect(
      events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(2);
  });

  it('retires pending voice only, renews its scope and retains active outcomes across provider replacement', async () => {
    const state = await setup();
    state.provider.call('active');
    await clock.tickAsync(0);
    state.provider.call('pending');
    const typed = state.client.enqueueIntent('typed');
    await state.session.dispose();
    await clock.tickAsync(0);
    expect(state.session.memory.find(ToolCallId('pending'))?.status).toBe(
      'not_submitted',
    );
    expect(state.session.memory.find(ToolCallId('active'))?.status).toBe(
      'submitted',
    );
    const replacement = adapter();
    const next = new RealtimeSession({
      sessionId,
      adapter: replacement.instance,
      instance: state.bridge,
      memory: state.session.memory,
    });
    cleanup.push(() => next.dispose());
    await next.connect();
    replacement.call('replacement');
    await state.finish(0);
    expect(state.session.memory.find(ToolCallId('active'))?.status).toBe(
      'completed',
    );
    expect(state.provider.results).toHaveLength(0);
    expect(state.sent[1].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'typed',
    });
    await state.finish(1);
    expect((await typed.result).status).toBe('applied');
    await state.finish(2);
    expect(replacement.results.map((value) => value.callId)).toEqual([
      ToolCallId('replacement'),
    ]);
    expect(
      state.events.filter((event) => event.type === 'tool.result'),
    ).toHaveLength(2);
  });

  it('handles a reentrant disconnect on queued evidence without dispatch or stale delivery', async () => {
    const state = await setup();
    const active = state.client.enqueueIntent('typed');
    state.session.events.subscribe((event) => {
      if (event.type === 'tool.queued') void state.session.disconnect();
    });
    state.provider.call('retired');
    await clock.tickAsync(0);
    expect(state.session.memory.find(ToolCallId('retired'))?.status).toBe(
      'not_submitted',
    );
    expect(
      state.events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(0);
    expect(
      state.events.filter((event) => event.type === 'tool.result'),
    ).toHaveLength(1);
    expect(state.provider.results).toHaveLength(0);
    await state.finish(0);
    await active.result;
    expect(state.sent).toHaveLength(1);
  });

  for (const terminal of ['idle', 'fatal'] as const) {
    it(`retires pending on ${terminal}, preserves active and typed work, and ignores duplicate cleanup`, async () => {
      const state = await setup();
      state.provider.call('active');
      await clock.tickAsync(0);
      state.provider.call('retired');
      const typed = state.client.enqueueIntent('typed');
      const terminalEvent: RealtimeAdapterEvent =
        terminal === 'idle'
          ? { type: 'state', state: 'idle' }
          : {
              type: 'error',
              error: new RealtimeVoiceError('CONNECTION_FAILED', 'lost'),
            };
      state.provider.emit(terminalEvent);
      await clock.tickAsync(0);
      const snapshot = state.session.observations.getSnapshot();
      state.provider.emit(terminalEvent);
      expect(state.session.observations.getSnapshot()).toBe(snapshot);
      expect(state.session.memory.find(ToolCallId('retired'))?.status).toBe(
        'not_submitted',
      );
      expect(state.session.memory.find(ToolCallId('active'))?.status).toBe(
        'submitted',
      );
      await state.finish(0);
      expect(state.session.memory.find(ToolCallId('active'))?.status).toBe(
        'completed',
      );
      expect(state.provider.results).toHaveLength(0);
      expect(state.sent[1].request.context.updateReasons).toContainEqual({
        type: 'user_intent',
        intent: 'typed',
      });
      await state.finish(1);
      expect((await typed.result).status).toBe('applied');
      expect(
        state.events.filter((event) => event.type === 'tool.result'),
      ).toHaveLength(2);
      await state.session.connect();
      state.provider.call('new-lifetime');
      await clock.tickAsync(0);
      await state.finish(2);
      expect(state.provider.results.map((value) => value.callId)).toEqual([
        ToolCallId('new-lifetime'),
      ]);
    });
  }

  it('keeps pending work on live turn-idle, recoverable errors and bare error presentation', async () => {
    const state = await setup();
    state.provider.call('active');
    await clock.tickAsync(0);
    state.provider.call('pending');
    state.provider.emit({ type: 'state', state: 'connected' });
    state.provider.emit({ type: 'error', error: new Error('recoverable') });
    state.provider.emit({ type: 'state', state: 'error' });
    expect(state.session.memory.find(ToolCallId('pending'))?.status).toBe(
      'queued',
    );
    await state.finish(0);
    await state.finish(1);
    expect(state.provider.results.map((value) => value.callId)).toEqual([
      ToolCallId('active'),
      ToolCallId('pending'),
    ]);
  });

  it('retires the old pending voice scope on bare-error reconnect without releasing active ownership', async () => {
    const state = await setup();
    state.provider.call('active-old');
    await clock.tickAsync(0);
    state.provider.call('pending-old');
    const typed = state.client.enqueueIntent('typed');
    const other = state.client.createIntentScope().enqueueIntent('other-scope');
    state.provider.emit({ type: 'state', state: 'error' });
    await state.session.connect();
    await clock.tickAsync(0);
    expect(state.session.memory.find(ToolCallId('pending-old'))).toMatchObject({
      status: 'not_submitted',
      summary: 'This request was not submitted (owner_retired).',
    });
    expect(state.session.memory.find(ToolCallId('active-old'))?.status).toBe(
      'submitted',
    );
    state.provider.call('new-voice');
    await clock.tickAsync(0);
    expect(state.sent).toHaveLength(1);
    expect(state.provider.results).toHaveLength(0);
    await state.finish(0);
    expect(state.session.memory.find(ToolCallId('active-old'))?.status).toBe(
      'completed',
    );
    for (const [index, intent] of [
      'typed',
      'other-scope',
      'new-voice',
    ].entries()) {
      expect(
        state.sent[index + 1].request.context.updateReasons,
      ).toContainEqual({
        type: 'user_intent',
        intent,
      });
      await state.finish(index + 1);
    }
    expect((await typed.result).status).toBe('applied');
    expect((await other.result).status).toBe('applied');
    expect(state.sent).toHaveLength(4);
    expect(state.provider.results.map((value) => value.callId)).toEqual([
      ToolCallId('new-voice'),
    ]);
  });

  for (const reconnect of [false, true]) {
    it(`fences synchronous retirement-triggered disconnect with reconnect=${reconnect}`, async () => {
      const state = await setup({}, true);
      const active = state.client.enqueueIntent('typed-active');
      await clock.tickAsync(0);
      const old = state.scopes[0].enqueueIntent('old-voice');
      const connect = spyOn(state.provider.instance, 'connect');
      const activate = spyOn(state.provider.instance, 'activateAudio');
      const subscribe = spyOn(state.provider.instance, 'on');
      let ending: Promise<void> | undefined;
      let continuation: Promise<void> | undefined;
      let notifications = 0;
      const subscription = old.store.subscribe(() => {
        if (old.store.state.status !== 'not_submitted') return;
        notifications++;
        ending = state.session.disconnect();
        continuation = ending.then(async () => {
          if (reconnect) await state.session.connect();
        });
      });
      try {
        state.provider.emit({ type: 'state', state: 'error' });
        const outer = state.session.connect();
        expect(notifications).toBe(1);
        expect(ending).toBeDefined();
        expect(state.scopes).toHaveLength(1);
        expect(activate).not.toHaveBeenCalled();
        expect(subscribe).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        await outer;
        await continuation;
        expect(await old.result).toEqual({
          status: 'not_submitted',
          reason: 'owner_retired',
        });
        expect(state.session.state).toBe(reconnect ? 'connected' : 'idle');
        expect(state.scopes).toHaveLength(reconnect ? 2 : 1);
        expect(activate).toHaveBeenCalledTimes(reconnect ? 1 : 0);
        expect(subscribe).toHaveBeenCalledTimes(reconnect ? 1 : 0);
        expect(connect).toHaveBeenCalledTimes(reconnect ? 1 : 0);
        if (reconnect) {
          state.provider.call('replacement-pending');
          await state.session.disconnect();
          await clock.tickAsync(0);
          expect(
            state.session.memory.find(ToolCallId('replacement-pending')),
          ).toMatchObject({
            status: 'not_submitted',
            summary: 'This request was not submitted (owner_retired).',
          });
        }
        expect(state.sent).toHaveLength(1);
        await state.finish(0);
        expect((await active.result).status).toBe('applied');
        expect(state.sent).toHaveLength(1);
        expect(state.provider.results).toHaveLength(0);
      } finally {
        subscription.unsubscribe();
        await ending;
        await continuation;
        connect.mockRestore();
        activate.mockRestore();
        subscribe.mockRestore();
      }
    });
  }

  it('reports full and expired admission truthfully without fabricated submissions', async () => {
    const state = await setup({ capacity: 1, maxWaitMs: 1000 });
    state.provider.call('active');
    await clock.tickAsync(0);
    state.provider.call('expires');
    state.provider.call('full');
    await clock.tickAsync(1000);
    expect(state.session.memory.find(ToolCallId('full'))).toMatchObject({
      status: 'not_submitted',
      summary: 'This request was not submitted (queue_full).',
    });
    expect(state.session.memory.find(ToolCallId('expires'))).toMatchObject({
      status: 'not_submitted',
      summary: 'This request was not submitted (queue_expired).',
    });
    expect(
      state.events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(1);
    await state.finish(0);
    expect(state.provider.results).toHaveLength(3);
    expect(state.sent).toHaveLength(1);
  });

  for (const ending of ['reject', 'deadline', 'dispose', 'replace'] as const) {
    it(`settles ${ending} as unknown once with no retry or late success`, async () => {
      const state = await setup({ activeTimeoutMs: 1000 });
      state.provider.call('uncertain');
      await clock.tickAsync(0);
      if (ending === 'reject')
        state.pending[0].reject(new Error('transport lost'));
      if (ending === 'deadline') await clock.tickAsync(1000);
      if (ending === 'dispose') await state.client.dispose();
      if (ending === 'replace')
        state.client.setConnector({ ...state.connector });
      await clock.tickAsync(0);
      expect(state.session.memory.find(ToolCallId('uncertain'))?.status).toBe(
        'unknown',
      );
      await state.finish(0);
      expect(state.provider.results).toHaveLength(1);
      expect(
        state.events.filter((event) => event.type === 'tool.result'),
      ).toHaveLength(1);
      expect(state.session.memory.find(ToolCallId('uncertain'))?.status).toBe(
        'unknown',
      );
      expect(state.sent).toHaveLength(1);
    });
  }

  it('records action failure as unknown without contaminating the next queued batch', async () => {
    const state = await setup();
    state.client.commandProcessor.registerRunner(InstanceId('one'), {
      fail: () => err(new Error('action failed')),
    });
    state.provider.call('fails');
    await clock.tickAsync(0);
    state.provider.call('succeeds');
    state.pending[0].resolve({
      ...response(state.sent[0]),
      layout: {
        type: 'tiling',
        tree: [],
        instances: [
          {
            instanceId: InstanceId('one'),
            vesselId: VesselId('vessel'),
            variant: VariantName('default'),
          },
        ],
      },
      executionPlan: [
        { instanceId: InstanceId('one'), action: ActionName('fail') },
      ],
    });
    await clock.tickAsync(0);
    expect(state.session.memory.find(ToolCallId('fails'))?.status).toBe(
      'unknown',
    );
    await state.finish(1);
    expect(state.session.memory.find(ToolCallId('succeeds'))?.status).toBe(
      'completed',
    );
    expect(state.provider.results).toHaveLength(2);
  });

  it('does not let hanging provider delivery hold local terminal results or memory cleanup', async () => {
    const state = await setup();
    const send = spyOn(
      state.provider.instance,
      'sendToolResult',
    ).mockImplementation(() => new Promise(() => {}));
    state.provider.call('applies');
    await clock.tickAsync(0);
    await state.finish(0);
    expect(state.session.memory.find(ToolCallId('applies'))?.status).toBe(
      'completed',
    );
    expect(
      state.events.filter((event) => event.type === 'tool.result'),
    ).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    await state.session.dispose();
    send.mockRestore();
  });

  it('settles all queued calls behind a never-settling turn and never retries it', async () => {
    const state = await setup({ activeTimeoutMs: 1000, maxWaitMs: 2000 });
    state.provider.call('blocked');
    await clock.tickAsync(0);
    state.provider.call('expires-one');
    state.provider.call('expires-two');
    await clock.tickAsync(2000);
    expect(
      state.session.memory.getSnapshot().outcomes.map((value) => value.status),
    ).toEqual(['unknown', 'not_submitted', 'not_submitted']);
    expect(
      state.events.filter((event) => event.type === 'tool.result'),
    ).toHaveLength(3);
    expect(state.provider.results).toHaveLength(3);
    expect(state.sent).toHaveLength(1);
    await state.finish(0);
    expect(state.provider.results).toHaveLength(3);
  });

  it('bounds engine connection loss and reconnects voice with a fresh scope', async () => {
    const state = await setup({ connectionGraceMs: 500 });
    await state.client.disconnect();
    state.provider.call('disconnected');
    await clock.tickAsync(500);
    expect(state.session.memory.find(ToolCallId('disconnected'))).toMatchObject(
      {
        status: 'not_submitted',
        summary: 'This request was not submitted (disconnected).',
      },
    );
    expect(state.sent).toHaveLength(0);
    await state.session.disconnect();
    await state.client.connect();
    await state.session.connect();
    state.provider.call('reconnected');
    await clock.tickAsync(0);
    await state.finish(0);
    expect(state.session.memory.find(ToolCallId('reconnected'))?.status).toBe(
      'completed',
    );
    expect(state.sent).toHaveLength(1);
  });

  it('reports exact first-layout refusal as failed without waiting on global idle', async () => {
    const state = await setup();
    const dispatch = spyOn(
      state.client.commandProcessor,
      'dispatchSettled',
    ).mockResolvedValue({
      status: 'failed',
      error: new Error('layout refused'),
    });
    state.provider.call('refused');
    await clock.tickAsync(0);
    await state.finish(0);
    expect(state.session.memory.find(ToolCallId('refused'))?.status).toBe(
      'failed',
    );
    expect(state.provider.results[0].result).toEqual({
      ok: false,
      summary: 'Something went wrong applying that change.',
    });
    dispatch.mockRestore();
  });
});
