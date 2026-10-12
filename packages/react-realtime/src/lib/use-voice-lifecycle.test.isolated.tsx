import { afterEach, expect, test } from 'bun:test';
import {
  type IntentSubmission,
  Orchestrator,
  type TimedTranscriptFragment,
  type VoiceObservationSnapshot,
} from '@maelstrom-co/client';
import {
  ActionName,
  type ChartRequestMessage,
  type DiagnosticEvent,
  defineVessel,
  InstanceId,
  type MaelstromResponse,
  ok,
  ToolCallId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import {
  createMaelstrom,
  type MaelstromState,
  useIntentSubmission,
  vessel,
} from '@maelstrom-co/react';
import type {
  AdapterVoiceObservation,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeSession,
  SessionEvent,
  ToolResult,
} from '@maelstrom-co/realtime';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import {
  type MaelstromRealtimeOptions,
  maelstromRealtime,
  type UseVoiceResult,
} from './maelstrom-realtime.js';

afterEach(cleanup);

test('one validated transcript revision produces one diagnostic fragment', async () => {
  const client = new Orchestrator(createMockConnector());
  const observers = new Set<(event: AdapterVoiceObservation) => void>();
  const adapter = Object.assign(makeAdapter(), {
    observations: {
      subscribe: (observer: (event: AdapterVoiceObservation) => void) => {
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
    },
  });
  const content: unknown[] = [];
  const detach = client.diagnostics.subscribe(({ event, readContent }) => {
    if (event.kind === 'voice.transcript.fragment')
      content.push(readContent?.());
  });
  const extension = maelstromRealtime({ createAdapter: () => adapter })(
    diagnosticContext(client),
  );
  let voice!: UseVoiceResult<undefined>;
  function Controls() {
    voice = extension.useVoice();
    return null;
  }
  try {
    render(<Controls />);
    await act(async () => voice.connect());
    await act(async () => {
      for (const observer of observers)
        observer({
          type: 'fragment',
          fragment: {
            id: 'revision-1',
            role: 'user',
            speakerId: 'user',
            text: 'new words',
            startMs: 0,
            endMs: 10,
          },
        });
    });
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ id: 'revision-1', text: 'new words' });
  } finally {
    detach();
    cleanup();
    await client.dispose();
  }
});

type Provider = 'first' | 'second';

const testVessel = defineVessel({
  id: 'voice-lifecycle',
  name: 'Voice lifecycle',
  description: 'Vessel for shared voice lifecycle tests',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

function makeAdapter(): RealtimeProviderAdapter & { active: boolean } {
  const adapter = {
    active: false,
    connect: async () => {
      adapter.active = true;
    },
    disconnect: async () => {
      adapter.active = false;
    },
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: () => () => {},
    observations: { subscribe: () => () => {} },
  };
  return adapter;
}

function setup(
  options: Pick<
    MaelstromRealtimeOptions<Provider>,
    'onSession' | 'initialProvider' | 'greeting'
  > = {},
) {
  const adapters: ReturnType<typeof makeAdapter>[] = [];
  const m = createMaelstrom({ vessels: [vessel(testVessel, () => null)] }).with(
    maelstromRealtime({
      providers: ['first', 'second'],
      initialProvider: options.initialProvider,
      createAdapter: () => {
        const adapter = makeAdapter();
        adapters.push(adapter);
        return adapter;
      },
      onSession: options.onSession,
      greeting: options.greeting,
    }),
  );
  let voice!: UseVoiceResult<Provider>;
  function Controls() {
    voice = m.useVoice();
    return null;
  }
  const view = render(
    <m.Provider connector={createMockConnector()}>
      <Controls />
    </m.Provider>,
  );
  return { adapters, current: () => voice, unmount: view.unmount };
}

test('retained controls stop the replacement provider they connected', async () => {
  const state = setup();
  const { switchProvider, connect, disconnect } = state.current();
  await act(async () => {
    await switchProvider('second');
    await connect();
  });
  expect(state.adapters.at(-1)?.active).toBe(true);

  await act(async () => disconnect());

  expect(state.adapters.at(-1)?.active).toBe(false);
  expect(state.current().state).toBe('idle');
});

test.each([
  false,
  true,
])('releases every session when the last consumer unmounts, reentrant: %s', async (reentrant) => {
  const released: Provider[] = [];
  let unmount = () => {};
  const state = setup({
    onSession:
      (_session, { provider }) =>
      () => {
        released.push(provider);
        if (reentrant && provider === 'first') unmount();
      },
  });
  unmount = state.unmount;

  await act(async () => state.current().switchProvider('second'));
  if (!reentrant) state.unmount();
  await act(async () => Promise.resolve());

  expect(released).toEqual(['first', 'second']);
});

test('rejects a stored initial provider outside the configured list before attaching a session', () => {
  let attached = false;
  expect(() =>
    setup({
      onSession: () => {
        attached = true;
      },
      initialProvider: () => 'missing' as Provider,
    }),
  ).toThrow(RangeError);
  expect(attached).toBe(false);
});

test('rejects an empty provider list rather than passing undefined to the adapter factory', () => {
  expect(() =>
    maelstromRealtime({ providers: [], createAdapter: makeAdapter }),
  ).toThrow(RangeError);
});

test('retained greeting controls skip the current provider opening', async () => {
  const state = setup({ greeting: { text: 'Hello.' } });
  const { skipGreeting } = state.current();
  await act(async () => state.current().switchProvider('second'));

  await act(async () => skipGreeting());

  expect(state.current().greetingState).toBe('skipped');
});

test('retained stop controls do not recreate a session after its last consumer unmounts', async () => {
  const state = setup();
  const { disconnect, skipGreeting } = state.current();
  state.unmount();
  await act(async () => Promise.resolve());

  await disconnect();
  skipGreeting();

  expect(state.adapters).toHaveLength(1);
  expect(state.adapters[0]?.active).toBe(false);
});

test('React typed and provider tool intents share FIFO after a 3s resize and atomic settlement', async () => {
  const clock = FakeTimers.install({
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
  try {
    const sent: ChartRequestMessage[] = [];
    const release: Array<(response: MaelstromResponse) => void> = [];
    const connector = createMockConnector({
      process: (request) => {
        sent.push(request);
        return new Promise((resolve) => release.push(resolve));
      },
    });
    const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
    const delivered: Array<{ callId: ToolCallId; result: ToolResult }> = [];
    const events: SessionEvent[] = [];
    const adapter: RealtimeProviderAdapter = {
      ...makeAdapter(),
      on: (handler) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      sendToolResult: async (callId, result) => {
        delivered.push({ callId, result });
      },
    };
    let client!: Orchestrator;
    const m = createMaelstrom({
      vessels: [vessel(testVessel, () => null)],
      intentQueue: { capacity: 3 },
    }).with(
      maelstromRealtime({
        createAdapter: () => adapter,
        onSession: (session, context) => {
          client = context.orchestrator;
          return session.events.subscribe((event) => events.push(event));
        },
      }),
    );
    let typed!: MaelstromState;
    let voice!: UseVoiceResult;
    let observe!: (ticket: IntentSubmission) => void;
    function Controls() {
      typed = m.useMaelstrom();
      voice = m.useVoice();
      const [ticket, setTicket] = useState<IntentSubmission | null>(null);
      observe = setTicket;
      const snapshot = useIntentSubmission(ticket);
      return <output>{snapshot?.status ?? 'none'}</output>;
    }
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <m.Provider connector={connector}>
          <Controls />
        </m.Provider>,
      );
    });
    await act(async () => {
      await voice.connect();
      client.chartManager.setDimensions({ columns: 10, rows: 6 });
      await clock.tickAsync(350);
    });
    const call = (id: string) => {
      for (const handler of handlers)
        handler({
          type: 'tool_call',
          callId: ToolCallId(id),
          name: 'update_ui',
          argumentsJson: JSON.stringify({ intent: id }),
        });
    };
    let first!: IntentSubmission;
    let last!: IntentSubmission;
    await act(async () => {
      first = typed.enqueueIntent('typed-first');
      observe(first);
      call('voice-second');
      last = typed.enqueueIntent('typed-third');
      for (let columns = 11; columns <= 20; columns++) {
        client.chartManager.setDimensions({ columns, rows: 6 });
        await clock.tickAsync(300);
      }
    });
    expect(sent).toHaveLength(1);
    expect(view.getByRole('status').textContent).toBe('queued');
    expect(typed.intentScheduler.pendingCount).toBe(3);
    expect(events.filter((event) => event.type === 'tool.queued')).toHaveLength(
      1,
    );
    expect(
      events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(0);

    const response = (index: number): MaelstromResponse => ({
      type: 'maelstrom_response',
      requestId: sent[index].id,
      userMessage: 'Settled reply',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
    let settleAction!: () => void;
    const action = new Promise<ReturnType<typeof ok<undefined>>>((resolve) => {
      settleAction = () => resolve(ok(undefined));
    });
    let layoutPrecedesAction = false;
    client.commandProcessor.registerRunner(InstanceId('introduced'), {
      show: () => {
        layoutPrecedesAction =
          client.commandProcessor.store.state.instances.has(
            InstanceId('introduced'),
          );
        return action;
      },
    });
    await act(async () => {
      release[0]({
        ...response(0),
        layout: {
          type: 'tiling',
          tree: [],
          instances: [
            {
              instanceId: InstanceId('introduced'),
              vesselId: VesselId('voice-lifecycle'),
              variant: VariantName('default'),
            },
          ],
        },
        executionPlan: [
          { instanceId: InstanceId('introduced'), action: ActionName('show') },
        ],
      });
    });
    expect(layoutPrecedesAction).toBe(true);
    expect(typed.isProcessing).toBe(false);
    expect(typed.intentScheduler.phase).toBe('applying');
    expect(sent).toHaveLength(1);
    expect(view.getByRole('status').textContent).toBe('queued');
    expect(delivered).toHaveLength(0);

    await act(async () => settleAction());
    expect(view.getByRole('status').textContent).toBe('processing');
    expect(sent[1].request.context.updateReasons).toContainEqual({
      type: 'chart_resize',
      previous: { columns: 19, rows: 6 },
      current: { columns: 20, rows: 6 },
    });
    expect(sent[1].request.instances).toEqual([
      expect.objectContaining({ instanceId: 'introduced', variant: 'default' }),
    ]);
    for (let index = 1; index <= 3; index++) {
      expect(sent).toHaveLength(index + 1);
      expect(sent[index].request.context.updateReasons.at(-1)).toEqual({
        type: 'user_intent',
        intent: ['typed-first', 'voice-second', 'typed-third'][index - 1],
      });
      await act(async () => release[index](response(index)));
      expect(view.getByRole('status').textContent).toBe('applied');
    }
    expect((await first.result).status).toBe('applied');
    expect((await last.result).status).toBe('applied');
    expect(delivered).toEqual([
      {
        callId: ToolCallId('voice-second'),
        result: {
          ok: true,
          summary: 'The screen is empty.',
          userMessage: 'Settled reply',
        },
      },
    ]);
    expect(
      events.filter((event) => event.type === 'tool.submitted'),
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.result')).toHaveLength(
      1,
    );
    expect(typed.intentScheduler.phase).toBe('idle');
    expect(typed.intentScheduler.pendingCount).toBe(0);
    await act(async () => clock.tickAsync(1000));
    expect(sent).toHaveLength(4);
    expect(delivered).toHaveLength(1);
  } finally {
    cleanup();
    clock.uninstall();
  }
});

function diagnosticContext(orchestrator: Orchestrator) {
  return {
    useMaelstromContext: () => ({
      orchestrator,
      connector: createMockConnector(),
      get config(): never {
        throw new Error(
          'Voice diagnostics do not need presentation configuration',
        );
      },
      onErrorRef: { current: undefined },
    }),
  };
}

test('a rejected application session hook releases diagnostics while the client remains alive', async () => {
  const client = new Orchestrator(createMockConnector());
  const observed: string[] = [];
  client.diagnostics.subscribe(({ event }) => observed.push(event.kind));
  let rejected: RealtimeSession | undefined;
  const extension = maelstromRealtime({
    createAdapter: makeAdapter,
    onSession: (session) => {
      rejected = session;
      throw new Error('application hook failed');
    },
  })(diagnosticContext(client));
  function Controls() {
    extension.useVoiceObservations();
    return null;
  }
  try {
    expect(() => render(<Controls />)).toThrow('application hook failed');
    expect(rejected).toBeDefined();
    if (!rejected)
      throw new Error('The application hook must receive a session');
    observed.length = 0;
    await rejected.connect();
    await rejected.disconnect();
    expect(observed.filter((kind) => kind.startsWith('voice.'))).toEqual([]);
  } finally {
    await client.dispose();
  }
});

test('a failed optional transport snapshot cannot keep a retired session observed', async () => {
  const client = new Orchestrator(createMockConnector());
  const observed: string[] = [];
  client.diagnostics.subscribe(({ event }) => observed.push(event.kind));
  const extension = maelstromRealtime({
    createAdapter: () =>
      Object.assign(makeAdapter(), {
        getTransportSnapshot: () => {
          throw new Error('snapshot unavailable');
        },
      }),
  })(diagnosticContext(client));
  let session: RealtimeSession | undefined;
  function Controls() {
    session = extension.useVoiceObservations().session;
    return null;
  }
  try {
    const view = render(<Controls />);
    view.unmount();
    await act(async () => Promise.resolve());
    if (!session) throw new Error('The observation hook must expose a session');
    observed.length = 0;
    await session.connect();
    await session.disconnect();
    expect(observed.filter((kind) => kind.startsWith('voice.'))).toEqual([]);
  } finally {
    await client.dispose();
  }
});

test('late diagnostic attachment keeps transport and lifecycle in the connected generation', async () => {
  const client = new Orchestrator(createMockConnector());
  const adapter = makeAdapter();
  const extension = maelstromRealtime({
    createAdapter: () =>
      Object.assign(adapter, {
        getTransportSnapshot: () => ({
          state: adapter.active ? 'connected' : 'closed',
          generation: 1,
          usageSeconds: 7,
          instructions: 'private transport configuration',
        }),
      }),
  })(diagnosticContext(client));
  let voice: UseVoiceResult | undefined;
  function Controls() {
    voice = extension.useVoice();
    return null;
  }
  try {
    render(<Controls />);
    if (!voice) throw new Error('The voice controls must be mounted');
    const mountedVoice = voice;
    await act(async () => mountedVoice.connect());
    expect(adapter.active).toBe(true);
    const events: DiagnosticEvent[] = [];
    const release = client.diagnostics.subscribe(({ event }) =>
      events.push(event),
    );
    try {
      expect(
        events.find((event) => event.kind === 'voice.transport'),
      ).toMatchObject({
        metadata: {
          state: 'connected',
          providerGeneration: 1,
          usageSeconds: 7,
        },
      });
      expect(JSON.stringify(events)).not.toContain(
        'private transport configuration',
      );
      await act(async () => mountedVoice.disconnect());
      expect(
        events
          .filter((event) => event.kind.startsWith('voice.session.'))
          .map((event) => [event.kind, event.metadata.generation]),
      ).toEqual([
        ['voice.session.disconnecting', 1],
        ['voice.session.disconnected', 1],
      ]);
    } finally {
      release();
    }
  } finally {
    cleanup();
    await client.dispose();
  }
});

test('a throwing initial transport snapshot preserves later diagnostics and cleanup', async () => {
  const client = new Orchestrator(createMockConnector());
  let reads = 0;
  const extension = maelstromRealtime({
    createAdapter: () =>
      Object.assign(makeAdapter(), {
        getTransportSnapshot: () => {
          reads++;
          if (reads === 1) throw new Error('snapshot unavailable');
          return { state: 'connected', generation: 1 };
        },
      }),
  })(diagnosticContext(client));
  let session: RealtimeSession | undefined;
  function Controls() {
    session = extension.useVoiceObservations().session;
    return null;
  }
  try {
    const view = render(<Controls />);
    const events: DiagnosticEvent[] = [];
    const release = client.diagnostics.subscribe(({ event }) =>
      events.push(event),
    );
    try {
      expect(reads).toBe(1);
      if (!session)
        throw new Error('The observation hook must expose a session');
      const mountedSession = session;
      await act(async () => mountedSession.connect());
      expect(
        events.some((event) => event.kind === 'voice.session.connected'),
      ).toBe(true);
      expect(events.some((event) => event.kind === 'voice.transport')).toBe(
        true,
      );
      view.unmount();
      await act(async () => Promise.resolve());
      events.length = 0;
      await session.connect();
      await session.disconnect();
      expect(events.filter((event) => event.kind.startsWith('voice.'))).toEqual(
        [],
      );
    } finally {
      release();
    }
  } finally {
    cleanup();
    await client.dispose();
  }
});

test('metadata observation never reads transcript text or replays it after reattachment', async () => {
  const client = new Orchestrator(createMockConnector());
  const extension = maelstromRealtime({ createAdapter: makeAdapter })(
    diagnosticContext(client),
  );
  let session: RealtimeSession | undefined;
  function Controls() {
    session = extension.useVoiceObservations().session;
    return null;
  }
  render(<Controls />);
  if (!session) throw new Error('Expected the mounted voice session');
  const source = session.observations;
  const read = source.getSnapshot;
  const subscribe = source.subscribe;
  const updates = new Set<() => void>();
  let reads = 0;
  const fragment = (value: string): TimedTranscriptFragment =>
    Object.freeze({
      id: 'private-fragment',
      role: 'user',
      speakerId: 'user',
      startMs: 0,
      endMs: 10,
      get text() {
        reads++;
        return value;
      },
    });
  let snapshot: VoiceObservationSnapshot = {
    ...read(),
    fragments: [fragment('before capture')],
  };
  source.getSnapshot = () => snapshot;
  source.subscribe = (listener) => {
    updates.add(listener);
    const release = subscribe(listener);
    return () => {
      updates.delete(listener);
      release();
    };
  };
  const publish = () => {
    for (const update of updates) update();
  };
  let recording = false;
  const content: string[] = [];
  const events: DiagnosticEvent[] = [];
  const observe = () =>
    client.diagnostics.subscribe(({ event, readContent }) => {
      events.push(event);
      if (recording && event.kind === 'voice.transcript.fragment')
        content.push((readContent?.() as TimedTranscriptFragment).text);
    });
  let detach = () => {};
  try {
    detach = observe();
    expect(reads).toBe(0);
    publish();
    snapshot = { ...snapshot, fragments: [fragment('unrecorded revision')] };
    publish();
    expect(reads).toBe(0);
    expect(content).toEqual([]);
    recording = true;
    snapshot = { ...snapshot, fragments: [fragment('recorded revision')] };
    publish();
    expect(content).toEqual(['recorded revision']);
    expect(reads).toBe(1);
    publish();
    detach();
    detach = observe();
    const retainedEvents = events.filter(
      (event) => event.kind === 'voice.transcript.fragment',
    ).length;
    publish();
    expect(
      events.filter((event) => event.kind === 'voice.transcript.fragment'),
    ).toHaveLength(retainedEvents);
    expect(content).toEqual(['recorded revision']);
    expect(reads).toBe(1);
  } finally {
    detach();
    source.getSnapshot = read;
    source.subscribe = subscribe;
    cleanup();
    await client.dispose();
  }
});

test('submitted tool results retain their original provider and generation after retirement', async () => {
  const pending = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const client = new Orchestrator(
    createMockConnector({
      process: async (message) => {
        started.resolve();
        await pending.promise;
        return {
          type: 'maelstrom_response',
          requestId: message.id,
          rationale: 'fixture',
          userMessage: 'applied',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        };
      },
    }),
  );
  const events: DiagnosticEvent[] = [];
  client.diagnostics.subscribe(({ event }) => events.push(event));
  const createAdapter = () => {
    const listeners = new Set<(event: RealtimeAdapterEvent) => void>();
    const results: ToolResult[] = [];
    return Object.assign(makeAdapter(), {
      results,
      on: (listener: (event: RealtimeAdapterEvent) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      emit: (event: RealtimeAdapterEvent) => {
        for (const listener of listeners) listener(event);
      },
      sendToolResult: async (_callId: ToolCallId, output: ToolResult) => {
        results.push(output);
      },
    });
  };
  const adapters = { first: createAdapter(), second: createAdapter() };
  const applicationEvents: string[] = [];
  const extension = maelstromRealtime({
    providers: ['first', 'second'],
    createAdapter: ({ provider }) =>
      provider === 'first' ? adapters.first : adapters.second,
    onEvent: (event) => applicationEvents.push(event.type),
  })(diagnosticContext(client));
  let voice: UseVoiceResult<Provider> | undefined;
  function Controls() {
    voice = extension.useVoice();
    return null;
  }
  const controls = () => {
    if (!voice) throw new Error('The voice controls must be mounted');
    return voice;
  };
  try {
    await client.connect();
    render(<Controls />);
    await act(async () => controls().connect());
    await act(async () => {
      adapters.first.emit({
        type: 'tool_call',
        callId: ToolCallId('retired-call'),
        name: 'update_ui',
        argumentsJson: '{"intent":"apply after replacement"}',
      });
      await started.promise;
    });
    const called = events.find((event) => event.kind === 'voice.tool.called');
    expect(called?.metadata).toMatchObject({
      provider: 'first',
      generation: 1,
    });
    await act(async () => controls().switchProvider('second'));
    await act(async () => {
      pending.resolve();
      await waitFor(
        () =>
          expect(
            events.find((event) => event.kind === 'voice.tool.result'),
          ).toBeDefined(),
        { timeout: 1000 },
      );
    });
    expect(
      events.find((event) => event.kind === 'voice.tool.result')?.metadata,
    ).toMatchObject({
      provider: 'first',
      generation: 1,
      callId: 'retired-call',
      ok: true,
      providerInstanceId: called?.metadata.providerInstanceId,
    });
    expect(adapters.second.results).toEqual([]);
    expect(
      applicationEvents.filter((type) => type === 'tool_result'),
    ).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('apply after replacement');
  } finally {
    pending.resolve();
    cleanup();
    await client.dispose();
  }
});
