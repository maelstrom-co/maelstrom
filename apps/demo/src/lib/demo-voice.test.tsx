// @vitest-environment happy-dom

import { Orchestrator } from '@maelstrom-co/client';
import {
  SessionId as brandSessionId,
  type SessionId,
  ToolCallId,
} from '@maelstrom-co/protocol';
import {
  maelstromRealtime,
  type UseVoiceResult,
} from '@maelstrom-co/react-realtime';
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
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMockConnector } from './__tests__/mock-connector';
import {
  attachDemoVoice,
  demoVoiceOpening,
  demoVoiceSession,
} from './demo-voice';
import {
  DEMO_VOICE_PROVIDERS,
  type DemoVoiceProvider,
  selectVoiceProvider,
  voiceProviderStore,
} from './voice-provider';

class Adapter implements RealtimeProviderAdapter {
  listeners = new Set<(event: RealtimeAdapterEvent) => void>();
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

type Factory = (
  provider: DemoVoiceProvider,
  sessionId: SessionId,
) => RealtimeProviderAdapter;

/**
 * Mounts the demo's voice configuration on the public library extension, the
 * same way maelstrom.ts installs it, and drives it through useVoice().
 */
function mountDemoVoice(
  orchestrator: Orchestrator,
  factory: Factory,
  greeting = 'hello',
  failSessionAttach: () => boolean = () => false,
) {
  const hooks = maelstromRealtime({
    providers: DEMO_VOICE_PROVIDERS,
    initialProvider: () => voiceProviderStore.state.provider,
    createAdapter: ({ provider, sessionId }) => factory(provider, sessionId),
    opening: demoVoiceOpening(greeting),
    onSession: (session, context) => {
      if (failSessionAttach())
        throw new Error('fixture session construction failure');
      return attachDemoVoice(session, context);
    },
  })({ useMaelstromContext: () => ({ orchestrator }) } as never);
  let latest: UseVoiceResult<DemoVoiceProvider> | undefined;
  function Probe() {
    latest = hooks.useVoice();
    return null;
  }
  render(<Probe />);
  const voice = () => {
    if (!latest) throw new Error('useVoice has not rendered');
    return latest;
  };
  const flush = () => act(async () => {});
  const run = async (operation: () => Promise<void>) => {
    await flush();
    await act(operation);
  };
  const details = () => {
    const found = demoVoiceSession(voice().session);
    if (!found) throw new Error('session was not built by the demo wiring');
    return found;
  };
  return {
    voice,
    flush,
    get session() {
      return voice().session;
    },
    get provider() {
      return voice().provider;
    },
    get adapter() {
      return details().adapter;
    },
    get providerInstanceId() {
      return details().providerInstanceId;
    },
    get diagnostics() {
      return details().diagnostics;
    },
    get memory() {
      return voice().session.memory;
    },
    connect: () => run(() => voice().connect()),
    disconnect: () => run(() => voice().disconnect()),
    select: (provider: DemoVoiceProvider) =>
      run(() => voice().switchProvider(provider)),
  };
}

function newOrchestrator(connector = createMockConnector()) {
  return new Orchestrator(connector, { sessionId: brandSessionId() });
}

afterEach(() => {
  cleanup();
  selectVoiceProvider('realtime');
});

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
  const orchestrator = newOrchestrator();
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
  const voice = mountDemoVoice(orchestrator, (provider) =>
    provider === 'live' ? live : fixed,
  );
  await voice.connect();
  await dispatched.promise;
  await voice.select('live');
  await voice.connect();
  expect(live.openings).toBe(0);
  presentation.resolve();
  await voice.disconnect();
  orchestrator.dispose();
});

it('does not present the fixed greeting after a Live opening in the same session', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  await orchestrator.connect();
  const acknowledge = vi
    .spyOn(orchestrator, 'addAssistantMessageAcknowledged')
    .mockResolvedValue('inserted');
  const fixed = Object.assign(new Adapter(), {
    activateAudio() {},
    speakAssistantText: vi.fn(async () => 'accepted' as const),
  });
  const live = new Adapter();
  const voice = mountDemoVoice(orchestrator, (provider) =>
    provider === 'live' ? live : fixed,
  );
  await voice.connect();
  expect(live.openings).toBe(1);
  await voice.select('realtime');
  await voice.connect();
  expect(voice.session.greetingState).not.toBe('preparing');
  expect(fixed.speakAssistantText).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
  await voice.select('livekit');
  await voice.connect();
  expect(fixed.speakAssistantText).not.toHaveBeenCalled();
  await voice.disconnect();
  orchestrator.dispose();
});

it.each([
  'inert',
  'connection failure',
  'Engine wait',
  'history failure',
] as const)('still introduces on Live after an %s Realtime selection', async (scenario) => {
  selectVoiceProvider('realtime');
  const orchestrator = newOrchestrator();
  const fixed = Object.assign(new Adapter(), {
    activateAudio() {},
    speakAssistantText: vi.fn(async () => 'accepted' as const),
  });
  const live = new Adapter();
  const voice = mountDemoVoice(orchestrator, (provider) =>
    provider === 'live' ? live : fixed,
  );
  if (scenario === 'connection failure') {
    vi.spyOn(fixed, 'connect').mockRejectedValue(
      new Error('fixture connect failure'),
    );
    await expect(voice.connect()).rejects.toThrow();
    expect(fixed.connect).toHaveBeenCalledTimes(1);
  } else if (scenario === 'Engine wait') {
    await voice.connect();
  } else if (scenario === 'history failure') {
    await orchestrator.connect();
    vi.spyOn(orchestrator, 'addAssistantMessageAcknowledged').mockRejectedValue(
      new Error('fixture history failure'),
    );
    await voice.connect();
    await vi.waitFor(() => expect(voice.session.greetingState).toBe('settled'));
  }
  expect(fixed.speakAssistantText).not.toHaveBeenCalled();
  await voice.select('live');
  await voice.connect();
  expect(live.openings).toBe(1);
  await voice.disconnect();
  orchestrator.dispose();
});

it('retains a coherent disconnected session after factory failure and permits an unpaid retry', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  const factory = vi.fn<Factory>(() => new Adapter());
  const voice = mountDemoVoice(orchestrator, factory);
  await voice.connect();
  const original = {
    session: voice.session,
    adapter: voice.adapter,
    id: voice.providerInstanceId,
  };
  factory.mockImplementationOnce(() => {
    throw new Error('fixture construction failure');
  });
  await expect(voice.select('realtime')).rejects.toThrow(
    'fixture construction failure',
  );
  expect(voice.provider).toBe('live');
  expect(voice.providerInstanceId).toBe(original.id);
  expect(voice.session).toBe(original.session);
  expect(voice.adapter).toBe(original.adapter);
  expect(voice.session.state).toBe('idle');
  await voice.select('realtime');
  expect(factory).toHaveBeenCalledTimes(3);
  expect(voice.provider).toBe('realtime');
  expect((voice.adapter as Adapter).starts).toBe(0);
  await voice.disconnect();
  orchestrator.dispose();
});

it('preserves fixed-provider retries when presentation reports not_started', async () => {
  selectVoiceProvider('realtime');
  const orchestrator = newOrchestrator();
  await orchestrator.connect();
  vi.spyOn(orchestrator, 'addAssistantMessageAcknowledged')
    .mockResolvedValueOnce('inserted')
    .mockResolvedValue('deduped');
  const fixed = Object.assign(new Adapter(), {
    activateAudio() {},
    speakAssistantText: vi.fn(async () => 'not_started' as const),
  });
  const voice = mountDemoVoice(orchestrator, () => fixed);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await voice.connect();
    await vi.waitFor(() => expect(voice.session.greetingState).toBe('settled'));
    expect(fixed.speakAssistantText).toHaveBeenCalledTimes(attempt);
    await voice.flush();
    expect(voice.voice().assistantTranscript).toBeUndefined();
    await voice.disconnect();
  }
  orchestrator.dispose();
});

it('releases an uncommitted adapter if session construction fails', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  const adapters: Adapter[] = [];
  let failNext = false;
  const voice = mountDemoVoice(
    orchestrator,
    () => {
      const adapter = new Adapter();
      vi.spyOn(adapter, 'disconnect');
      adapters.push(adapter);
      return adapter;
    },
    'hello',
    () => {
      const fail = failNext;
      failNext = false;
      return fail;
    },
  );
  const oldSession = voice.session;
  failNext = true;
  await expect(voice.select('realtime')).rejects.toThrow(
    'fixture session construction failure',
  );
  expect(adapters[1]?.disconnect).toHaveBeenCalledTimes(1);
  expect(adapters[1]?.listeners.size).toBe(0);
  expect(voice.provider).toBe('live');
  expect(voice.session).toBe(oldSession);
  await voice.select('realtime');
  expect(adapters).toHaveLength(3);
  expect(adapters.every((adapter) => adapter.starts === 0)).toBe(true);
  await voice.disconnect();
  orchestrator.dispose();
});

it.each([
  'end',
  'switch',
] as const)('publishes the %s barrier before reentrant diagnostic subscribers run', async (action) => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  const factory = vi.fn<Factory>(() => new Adapter());
  const voice = mountDemoVoice(orchestrator, factory);
  await voice.connect();
  const teardown = deferred();
  (voice.adapter as Adapter).close = () => teardown.promise;
  const diagnostics = voice.diagnostics;
  let nestedEnd: Promise<void> | undefined;
  let nestedSwitch: Promise<void> | undefined;
  let settled = false;
  const unsubscribe = diagnostics.subscribe(() => {
    if (diagnostics.getSnapshot().at(-1)?.state !== 'disconnecting') return;
    nestedEnd = voice.voice().disconnect();
    nestedSwitch = voice.voice().switchProvider('realtime');
    void nestedSwitch.then(() => {
      settled = true;
    });
  });
  const operation =
    action === 'end'
      ? voice.voice().disconnect()
      : voice.voice().switchProvider('realtime');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(action === 'end' ? nestedEnd : nestedSwitch).toBe(operation);
  await act(async () => {
    teardown.resolve();
    await Promise.all([operation, nestedEnd, nestedSwitch]);
  });
  expect(factory).toHaveBeenCalledTimes(2);
  unsubscribe();
  await voice.disconnect();
  orchestrator.dispose();
});

it('records the observed connection generation and distinguishes recreated provider instances', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  const voice = mountDemoVoice(orchestrator, () => new Adapter());
  await voice.connect();
  await voice.disconnect();
  await voice.connect();
  const diagnostics = voice.diagnostics;
  await voice.select('realtime');
  await voice.select('live');
  await voice.connect();
  const starts = diagnostics
    .getSnapshot()
    .filter((event) => event.state === 'connecting');
  expect(starts.map((event) => event.generation)).toEqual([1, 2, 1]);
  expect(starts[0]).toHaveProperty('providerInstanceId');
  expect(starts[1]?.providerInstanceId).toBe(starts[0]?.providerInstanceId);
  expect(starts[2]?.providerInstanceId).not.toBe(starts[0]?.providerInstanceId);
  await voice.disconnect();
  orchestrator.dispose();
});

it('retains bounded final and incomplete voice evidence across reconnect and provider replacement', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  let finalization: 'confirmed' | 'incomplete' = 'confirmed';
  const voice = mountDemoVoice(orchestrator, (provider) => {
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
  });
  const diagnostics = voice.diagnostics;
  await voice.connect();
  await voice.disconnect();
  const first = diagnostics.getTransportHistory()[0];
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
  await voice.connect();
  expect(diagnostics.getTransportHistory()).toEqual([first]);
  await voice.select('realtime');
  expect(diagnostics.getTransportHistory()).toHaveLength(2);
  expect(diagnostics.getTransportHistory()[1]).toMatchObject({
    generation: 2,
    finalization: 'incomplete',
    usageSeconds: 7,
  });
  expect(diagnostics.getTransportHistory()[1]?.finalUsageSeconds).toBe(
    undefined,
  );
  await voice.select('live');
  for (let index = 0; index < 20; index++) {
    await voice.connect();
    await voice.disconnect();
  }
  expect(diagnostics.getTransportHistory()).toHaveLength(16);
  expect(JSON.stringify(diagnostics.getTransportHistory())).not.toMatch(
    /private-final-config|closedEvent|instructions/,
  );
  orchestrator.dispose();
});

it('serializes provider release without replacing the Engine session or duplicating a native opening', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  const adapters: Adapter[] = [];
  const voice = mountDemoVoice(orchestrator, () => {
    const adapter = new Adapter();
    adapters.push(adapter);
    return adapter;
  });
  await voice.flush();
  await act(() =>
    Promise.all([voice.voice().connect(), voice.voice().connect()]),
  );
  expect(adapters[0]?.starts).toBe(1);
  expect(adapters[0]?.openings).toBe(1);
  let release!: () => void;
  adapters[0]!.close = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const oldSession = voice.session;
  const switching = voice.voice().switchProvider('realtime');
  await voice.connect();
  expect(voice.voice().switching).toBe(true);
  expect(adapters).toHaveLength(1);
  await act(async () => {
    release();
    await switching;
  });
  expect(voice.session).not.toBe(oldSession);
  expect(voice.memory.sessionId).toBe(orchestrator.getConfig().sessionId);
  expect(voice.memory).toBe(oldSession.memory);
  expect(adapters[1]?.starts).toBe(0);
  await voice.select('live');
  await voice.connect();
  expect(adapters[2]?.openings).toBe(0);
  await voice.disconnect();
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
  const orchestrator = newOrchestrator(connector);
  await orchestrator.connect();
  const adapters: Adapter[] = [];
  const voice = mountDemoVoice(orchestrator, () => {
    const adapter = new Adapter();
    adapters.push(adapter);
    return adapter;
  });
  await voice.connect();
  const diagnostics = voice.diagnostics;
  const callId = ToolCallId('fixture-call');
  adapters[0]!.emit({
    type: 'tool_call',
    callId,
    name: 'update_ui',
    argumentsJson: '{"intent":"Arrange the workspace"}',
  });
  await vi.waitFor(() => expect(connector.process).toHaveBeenCalledTimes(1));
  await voice.disconnect();
  await voice.select('livekit');
  settle();
  await vi.waitFor(() =>
    expect(voice.memory.getSnapshot().outcomes[0]?.status).toBe('completed'),
  );
  expect(adapters[1]?.results).toHaveLength(0);
  expect(
    diagnostics
      .getSnapshot()
      .some((event) => event.kind === 'engine_completed'),
  ).toBe(true);
  expect(
    diagnostics
      .getSnapshot()
      .some((event) => event.kind === 'tool_result' && event.id === callId),
  ).toBe(true);
  await voice.disconnect();
  orchestrator.dispose();
});

it('records a call and a result for every tool, stamped with the session generation', async () => {
  selectVoiceProvider('live');
  const orchestrator = newOrchestrator();
  await orchestrator.connect();
  const adapter = new Adapter();
  const voice = mountDemoVoice(orchestrator, () => adapter);
  await voice.connect();
  await voice.disconnect();
  await voice.connect();
  const diagnostics = voice.diagnostics;
  for (const name of ['update_ui', 'get_ui_state', 'get_capabilities']) {
    adapter.emit({
      type: 'tool_call',
      callId: ToolCallId(`${name}-call`),
      name,
      argumentsJson: '{"intent":"Arrange the workspace"}',
    });
    await vi.waitFor(() =>
      expect(diagnostics.getSnapshot().at(-1)).toMatchObject({
        kind: 'tool_result',
        id: `${name}-call`,
      }),
    );
  }
  const providerInstanceId = voice.providerInstanceId;
  const tools = diagnostics
    .getSnapshot()
    .filter(
      (entry) => entry.kind === 'tool_call' || entry.kind === 'tool_result',
    )
    .map(({ kind, id, tool, ok, generation, providerInstanceId }) => ({
      kind,
      id,
      tool,
      ok,
      generation,
      providerInstanceId,
    }));
  expect(tools).toEqual(
    ['update_ui', 'get_ui_state', 'get_capabilities'].flatMap((name) => [
      {
        kind: 'tool_call',
        id: `${name}-call`,
        tool: name,
        ok: undefined,
        generation: 2,
        providerInstanceId,
      },
      {
        kind: 'tool_result',
        id: `${name}-call`,
        tool: undefined,
        ok: true,
        generation: 2,
        providerInstanceId,
      },
    ]),
  );
  expect(
    diagnostics
      .getSnapshot()
      .filter((entry) => entry.kind === 'voice_state')
      .map((entry) => [entry.state, entry.generation]),
  ).toEqual([
    ['connecting', 1],
    ['connected', 1],
    ['disconnecting', 1],
    ['disconnected', 1],
    ['connecting', 2],
    ['connected', 2],
  ]);
  await voice.disconnect();
  orchestrator.dispose();
});
