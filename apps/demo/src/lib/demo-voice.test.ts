import { Orchestrator } from '@maelstrom-co/client';
import { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeGreetingAdapter,
  RealtimeProviderAdapter,
  ToolResult,
} from '@maelstrom-co/realtime';
import {
  type LiveTransportSnapshot,
  OpenAILiveAdapter,
} from '@maelstrom-co/realtime-openai-live';
import { afterEach, expect, it, vi } from 'vitest';
import { createMockConnector } from './__tests__/mock-connector';
import { DemoVoiceOwner } from './demo-voice';
import { selectVoiceProvider } from './voice-provider';

class Adapter implements RealtimeProviderAdapter {
  listeners = new Set<(event: RealtimeAdapterEvent) => void>();
  observations = { subscribe: () => () => {} };
  starts = 0;
  openings = 0;
  results: ToolResult[] = [];
  close = () => Promise.resolve();
  generatedOpening = {
    request: async () => {
      this.openings++;
    },
  };
  async connect(_options: AdapterConnectOptions) {
    this.starts++;
    this.emit({ type: 'state', state: 'connected' });
  }
  disconnect() {
    this.emit({ type: 'state', state: 'idle' });
    return this.close();
  }
  getAudioStreams() {
    return {};
  }
  injectGrounding() {}
  async sendToolResult(_id: ToolCallId, output: ToolResult) {
    this.results.push(output);
  }
  on(handler: (event: RealtimeAdapterEvent) => void) {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  emit(event: RealtimeAdapterEvent) {
    for (const handler of this.listeners) handler(event);
  }
}

afterEach(() => selectVoiceProvider('realtime'));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([
  'playing',
  'ambiguous',
] as const)('does not introduce again when switching during a %s fixed greeting', async (phase) => {
  selectVoiceProvider('realtime');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  await orchestrator.connect();
  vi.spyOn(orchestrator, 'addAssistantMessageAcknowledged').mockResolvedValue(
    'inserted',
  );
  const presentation = deferred();
  const dispatched = deferred();
  class GreetingAdapter extends Adapter implements RealtimeGreetingAdapter {
    activateAudio() {}
    async speakAssistantText(
      args: Parameters<RealtimeGreetingAdapter['speakAssistantText']>[0],
    ) {
      if (phase === 'playing') args.onPlaybackStart?.();
      dispatched.resolve();
      await presentation.promise;
      return 'accepted' as const;
    }
  }
  const fixed = new GreetingAdapter();
  const live = new Adapter();
  const owner = new DemoVoiceOwner(
    orchestrator,
    (provider) => (provider === 'live' ? live : fixed),
    'hello',
  );
  await owner.connect();
  await dispatched.promise;
  const switching = owner.select('live');
  await switching;
  await owner.connect();
  expect(live.openings).toBe(0);
  presentation.resolve();
  await owner.disconnect();
  orchestrator.dispose();
});

it.each([
  'inert',
  'connection failure',
  'Engine wait',
  'history failure',
] as const)('still introduces on Live after an %s Realtime selection', async (scenario) => {
  selectVoiceProvider('realtime');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  const fixed = Object.assign(new Adapter(), {
    activateAudio() {},
    speakAssistantText: vi.fn(async () => 'accepted' as const),
  });
  const live = new Adapter();
  const owner = new DemoVoiceOwner(
    orchestrator,
    (provider) => (provider === 'live' ? live : fixed),
    'hello',
  );
  if (scenario === 'connection failure') {
    vi.spyOn(fixed, 'connect').mockRejectedValue(
      new Error('fixture connect failure'),
    );
    await expect(owner.connect()).rejects.toThrow();
    expect(fixed.connect).toHaveBeenCalledTimes(1);
  } else if (scenario === 'Engine wait') {
    await owner.connect();
  } else if (scenario === 'history failure') {
    await orchestrator.connect();
    vi.spyOn(orchestrator, 'addAssistantMessageAcknowledged').mockRejectedValue(
      new Error('fixture history failure'),
    );
    await owner.connect();
    await vi.waitFor(() => expect(owner.session.greetingState).toBe('settled'));
  }
  expect(fixed.speakAssistantText).not.toHaveBeenCalled();
  await owner.select('live');
  await owner.connect();
  expect(live.openings).toBe(1);
  await owner.disconnect();
  orchestrator.dispose();
});

it('retains a coherent disconnected owner after factory failure and permits an unpaid retry', async () => {
  selectVoiceProvider('live');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  const factory = vi.fn(() => new Adapter());
  const owner = new DemoVoiceOwner(orchestrator, factory, 'hello');
  await owner.connect();
  const original = {
    session: owner.session,
    adapter: owner.adapter,
    id: owner.providerInstanceId,
  };
  factory.mockImplementationOnce(() => {
    throw new Error('fixture construction failure');
  });
  await expect(owner.select('realtime')).rejects.toThrow(
    'fixture construction failure',
  );
  expect(owner.provider).toBe('live');
  expect(owner.providerInstanceId).toBe(original.id);
  expect(owner.session).toBe(original.session);
  expect(owner.adapter).toBe(original.adapter);
  expect(owner.session.state).toBe('idle');
  await owner.select('realtime');
  expect(factory).toHaveBeenCalledTimes(3);
  expect(owner.provider).toBe('realtime');
  expect((owner.adapter as Adapter).starts).toBe(0);
  await owner.disconnect();
  orchestrator.dispose();
});

it('preserves fixed-provider retries when presentation reports not_started', async () => {
  selectVoiceProvider('realtime');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  await orchestrator.connect();
  vi.spyOn(orchestrator, 'addAssistantMessageAcknowledged')
    .mockResolvedValueOnce('inserted')
    .mockResolvedValue('deduped');
  const fixed = Object.assign(new Adapter(), {
    activateAudio() {},
    speakAssistantText: vi.fn(async () => 'not_started' as const),
  });
  const owner = new DemoVoiceOwner(orchestrator, () => fixed, 'hello');
  for (let attempt = 1; attempt <= 2; attempt++) {
    await owner.connect();
    await vi.waitFor(() => expect(owner.session.greetingState).toBe('settled'));
    expect(fixed.speakAssistantText).toHaveBeenCalledTimes(attempt);
    expect(owner.read().assistantTranscript).toBeUndefined();
    await owner.disconnect();
  }
  orchestrator.dispose();
});

it('releases an uncommitted adapter if session construction fails', async () => {
  selectVoiceProvider('live');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  const adapters: Adapter[] = [];
  const owner = new DemoVoiceOwner(
    orchestrator,
    () => {
      const adapter = new Adapter();
      vi.spyOn(adapter, 'disconnect');
      adapters.push(adapter);
      return adapter;
    },
    'hello',
  );
  const oldSession = owner.session;
  vi.spyOn(owner.coordinator, 'getSnapshot').mockImplementationOnce(() => {
    throw new Error('fixture session construction failure');
  });
  await expect(owner.select('realtime')).rejects.toThrow(
    'fixture session construction failure',
  );
  expect(adapters[1]?.disconnect).toHaveBeenCalledTimes(1);
  expect(adapters[1]?.listeners.size).toBe(0);
  expect(owner.provider).toBe('live');
  expect(owner.session).toBe(oldSession);
  await owner.select('realtime');
  expect(adapters).toHaveLength(3);
  expect(adapters.every((adapter) => adapter.starts === 0)).toBe(true);
  await owner.disconnect();
  orchestrator.dispose();
});

it.each([
  'end',
  'switch',
] as const)('publishes the %s barrier before reentrant diagnostic subscribers run', async (action) => {
  selectVoiceProvider('live');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  const factory = vi.fn(() => new Adapter());
  const owner = new DemoVoiceOwner(orchestrator, factory, 'hello');
  await owner.connect();
  const teardown = deferred();
  (owner.adapter as Adapter).close = () => teardown.promise;
  let nestedEnd: Promise<void> | undefined;
  let nestedSwitch: Promise<void> | undefined;
  let settled = false;
  const unsubscribe = owner.diagnostics.subscribe(() => {
    if (owner.diagnostics.getSnapshot().at(-1)?.state !== 'disconnecting')
      return;
    nestedEnd = owner.disconnect();
    nestedSwitch = owner.select('realtime');
    void nestedSwitch.then(() => {
      settled = true;
    });
  });
  const operation =
    action === 'end' ? owner.disconnect() : owner.select('realtime');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(action === 'end' ? nestedEnd : nestedSwitch).toBe(operation);
  teardown.resolve();
  await Promise.all([operation, nestedEnd, nestedSwitch]);
  expect(factory).toHaveBeenCalledTimes(2);
  unsubscribe();
  await owner.disconnect();
  orchestrator.dispose();
});

it('records the observed connection generation and distinguishes recreated provider instances', async () => {
  selectVoiceProvider('live');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  const owner = new DemoVoiceOwner(orchestrator, () => new Adapter(), 'hello');
  await owner.connect();
  await owner.disconnect();
  await owner.connect();
  await owner.select('realtime');
  await owner.select('live');
  await owner.connect();
  const starts = owner.diagnostics
    .getSnapshot()
    .filter((event) => event.state === 'connecting');
  expect(starts.map((event) => event.generation)).toEqual([1, 2, 1]);
  expect(starts[0]).toHaveProperty('providerInstanceId');
  expect(starts[1]?.providerInstanceId).toBe(starts[0]?.providerInstanceId);
  expect(starts[2]?.providerInstanceId).not.toBe(starts[0]?.providerInstanceId);
  await owner.disconnect();
  orchestrator.dispose();
});

it('retains bounded final and incomplete voice evidence across reconnect and provider replacement', async () => {
  selectVoiceProvider('live');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  let finalization: 'confirmed' | 'incomplete' = 'confirmed';
  const owner = new DemoVoiceOwner(
    orchestrator,
    (provider) => {
      if (provider !== 'live') return new Adapter();
      const adapter = new OpenAILiveAdapter({
        model: 'gpt-live-1',
        responses: { model: 'gpt-6-luna' },
        exchange: async () => {
          throw new Error('No network in this test');
        },
      });
      let snapshot: LiveTransportSnapshot = {
        generation: 0,
        state: 'idle',
        finalization: 'pending',
        playback: 'unavailable',
      };
      vi.spyOn(adapter, 'connect').mockImplementation(async () => {
        snapshot = {
          generation: snapshot.generation + 1,
          sessionId: `fixture-${snapshot.generation + 1}`,
          state: 'connected',
          finalization: 'pending',
          playback: 'accepted',
        };
      });
      vi.spyOn(adapter.generatedOpening, 'request').mockResolvedValue();
      vi.spyOn(adapter, 'disconnect').mockImplementation(async () => {
        snapshot = {
          ...snapshot,
          state: 'closed',
          finalization,
          usageSeconds: 7,
          ...(finalization === 'confirmed' ? { finalUsageSeconds: 7 } : {}),
          closedEvent: {
            type: 'session.closed',
            event_id: 'fixture',
            session: { instructions: 'private-final-config' },
          },
        };
      });
      vi.spyOn(adapter, 'getTransportSnapshot').mockImplementation(
        () => snapshot,
      );
      return adapter;
    },
    'hello',
  );
  await owner.connect();
  await owner.disconnect();
  const first = owner.diagnostics.getTransportHistory()[0];
  expect(first).toMatchObject({
    provider: 'live',
    model: 'gpt-live-1',
    backendModel: 'gpt-6-luna',
    generation: 1,
    usageSeconds: 7,
    finalUsageSeconds: 7,
    finalization: 'confirmed',
  });
  finalization = 'incomplete';
  await owner.connect();
  expect(owner.diagnostics.getTransportHistory()).toEqual([first]);
  await owner.select('realtime');
  expect(owner.diagnostics.getTransportHistory()).toHaveLength(2);
  expect(owner.diagnostics.getTransportHistory()[1]).toMatchObject({
    generation: 2,
    finalization: 'incomplete',
    usageSeconds: 7,
  });
  expect(
    owner.diagnostics.getTransportHistory()[1]?.finalUsageSeconds,
  ).toBeUndefined();
  await owner.select('live');
  for (let index = 0; index < 20; index++) {
    await owner.connect();
    await owner.disconnect();
  }
  expect(owner.diagnostics.getTransportHistory()).toHaveLength(16);
  expect(JSON.stringify(owner.diagnostics.getTransportHistory())).not.toMatch(
    /private-final-config|closedEvent|instructions/,
  );
  orchestrator.dispose();
});

it('serializes provider release without replacing the Engine session or duplicating a native opening', async () => {
  selectVoiceProvider('live');
  const orchestrator = new Orchestrator(createMockConnector(), {
    sessionId: SessionId(),
  });
  const adapters: Adapter[] = [];
  const owner = new DemoVoiceOwner(
    orchestrator,
    () => {
      const adapter = new Adapter();
      adapters.push(adapter);
      return adapter;
    },
    'hello',
  );
  await Promise.all([owner.connect(), owner.connect()]);
  expect(adapters[0]?.starts).toBe(1);
  expect(adapters[0]?.openings).toBe(1);
  let release!: () => void;
  adapters[0]!.close = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const oldSession = owner.session;
  const releaseObserver = owner.subscribe(() => {
    if (owner.read().switching) void owner.connect();
  });
  const switching = owner.select('realtime');
  await owner.connect();
  expect(owner.read().switching).toBe(true);
  expect(adapters).toHaveLength(1);
  release();
  await switching;
  releaseObserver();
  expect(owner.session).not.toBe(oldSession);
  expect(owner.memory.sessionId).toBe(orchestrator.getConfig().sessionId);
  expect(adapters[1]?.starts).toBe(0);
  await owner.select('live');
  await owner.connect();
  expect(adapters[2]?.openings).toBe(0);
  await owner.disconnect();
  orchestrator.dispose();
});

it('keeps submitted application outcomes after End voice and never delivers them to a replacement provider', async () => {
  selectVoiceProvider('live');
  const connector = createMockConnector();
  let settle!: () => void;
  const originalProcess = connector.process;
  connector.process = vi.fn(async (request) => {
    await new Promise<void>((resolve) => {
      settle = resolve;
    });
    return originalProcess(request);
  });
  const orchestrator = new Orchestrator(connector, { sessionId: SessionId() });
  await orchestrator.connect();
  const adapters: Adapter[] = [];
  const owner = new DemoVoiceOwner(
    orchestrator,
    () => {
      const adapter = new Adapter();
      adapters.push(adapter);
      return adapter;
    },
    'hello',
  );
  await owner.connect();
  const callId = ToolCallId('fixture-call');
  adapters[0]!.emit({
    type: 'tool_call',
    callId,
    name: 'update_ui',
    argumentsJson: '{"intent":"Arrange the workspace"}',
  });
  await vi.waitFor(() => expect(connector.process).toHaveBeenCalledTimes(1));
  await owner.disconnect();
  await owner.select('livekit');
  settle();
  await vi.waitFor(() =>
    expect(owner.memory.getSnapshot().outcomes[0]?.status).toBe('completed'),
  );
  expect(adapters[1]?.results).toHaveLength(0);
  expect(
    owner.diagnostics
      .getSnapshot()
      .some((event) => event.kind === 'engine_completed'),
  ).toBe(true);
  expect(
    owner.diagnostics
      .getSnapshot()
      .some((event) => event.kind === 'tool_result' && event.id === callId),
  ).toBe(true);
  await owner.disconnect();
  orchestrator.dispose();
});
