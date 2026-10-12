import { afterEach, expect, test } from 'bun:test';
import { type DiagnosticObservation, Orchestrator } from '@maelstrom-co/client';
import { type DiagnosticEvent, ToolCallId } from '@maelstrom-co/protocol';
import {
  type AdapterDiagnosticObservation,
  type AdapterVoiceObservation,
  attachRealtimeDiagnostics,
  type RealtimeAdapterEvent,
  type RealtimeInstance,
  type RealtimeProviderAdapter,
  RealtimeSession,
} from '../index.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(override: Partial<RealtimeInstance> = {}) {
  const client = new Orchestrator({
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    process: async () => {
      throw new Error('Unexpected planner call');
    },
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
  });
  const events = new Set<(event: RealtimeAdapterEvent) => void>();
  const media = new Set<(event: AdapterVoiceObservation) => void>();
  const provider = new Set<(event: AdapterDiagnosticObservation) => void>();
  let nativeGeneration = 0;
  let state = 'idle';
  const adapter: RealtimeProviderAdapter = {
    connect: async () => {
      nativeGeneration++;
      state = 'connected';
    },
    disconnect: async () => {
      state = 'closed';
    },
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: (listener) => {
      events.add(listener);
      return () => {
        events.delete(listener);
      };
    },
    observations: {
      subscribe: (listener) => {
        media.add(listener);
        return () => {
          media.delete(listener);
        };
      },
    },
    diagnostics: {
      subscribe: (listener) => {
        provider.add(listener);
        return () => {
          provider.delete(listener);
        };
      },
    },
    getTransportSnapshot: () => ({ state, generation: nativeGeneration }),
  };
  const session = new RealtimeSession({
    adapter,
    sessionId: client.getConfig().sessionId,
    instance: {
      submitIntent: async () => ({}),
      waitForIdle: async () => {},
      getStructuralSnapshot: () => client.getStructuralSnapshot(),
      getCapabilitySnapshot: () => client.getCapabilitySnapshot(),
      onSettled: () => () => {},
      addAssistantMessageAcknowledged: async () => 'inserted',
      observeEngineConnection: () => () => {},
      ...override,
    },
  });
  const identity = {
    provider: 'example',
    providerInstanceId: 'voice-lifetime',
  };
  const retire = attachRealtimeDiagnostics({
    session,
    adapter,
    sink: client.diagnostics,
    identity,
  });
  cleanups.push(async () => {
    retire();
    await session.dispose();
    await client.dispose();
  });
  return {
    client,
    session,
    adapter,
    retire,
    identity,
    emit: (event: RealtimeAdapterEvent) => {
      for (const listener of [...events]) listener(event);
    },
    fragment: (text: string) => {
      for (const listener of [...media])
        listener({
          type: 'fragment',
          fragment: {
            id: 'fragment',
            role: 'user',
            speakerId: 'user',
            text,
            startMs: 0,
            endMs: 10,
          },
        });
    },
    provider: (observation: AdapterDiagnosticObservation) => {
      for (const listener of [...provider]) listener(observation);
    },
    providerSubscribers: () => provider.size,
  };
}

test('non-React sessions expose one validated fragment revision without recording earlier content', async () => {
  const h = harness();
  const observations: DiagnosticObservation[] = [];
  let detach = h.client.diagnostics.subscribe((observation) =>
    observations.push(observation),
  );
  await h.session.connect();
  h.fragment('before recording');
  expect(
    observations.filter(
      ({ event }) => event.kind === 'voice.transcript.fragment',
    ),
  ).toHaveLength(1);
  detach();
  const recorded: unknown[] = [];
  detach = h.client.diagnostics.subscribe(({ event, readContent }) => {
    if (event.kind === 'voice.transcript.fragment')
      recorded.push(readContent?.());
  });
  expect(recorded).toEqual([]);
  h.fragment('recorded revision');
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    id: 'fragment',
    text: 'recorded revision',
  });
  h.fragment('recorded revision');
  expect(recorded).toHaveLength(2);
  detach();
});

test('retirement during observation cannot leak a later fragment from the same callback', async () => {
  const h = harness();
  const events: DiagnosticEvent[] = [];
  let retireOnObservation = false;
  const detach = h.client.diagnostics.subscribe(({ event }) => {
    events.push(event);
    if (retireOnObservation && event.kind === 'voice.observations') h.retire();
  });
  await h.session.connect();
  events.length = 0;
  retireOnObservation = true;
  h.fragment('must not pass retirement');
  expect(
    events.filter((event) => event.kind === 'voice.transcript.fragment'),
  ).toEqual([]);
  expect(h.providerSubscribers()).toBe(0);
  detach();
});

test('provider generations do not masquerade as session generations after cancelled startup', async () => {
  const h = harness();
  let ending: Promise<void> | undefined;
  const cancel = h.session.events.subscribe((event) => {
    if (event.type === 'session.started' && event.generation === 1)
      ending = h.session.disconnect();
  });
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  await h.session.connect();
  await ending;
  cancel();
  await h.session.connect();
  expect(
    events.filter((event) => event.kind === 'voice.session.connected').at(-1)
      ?.metadata.generation,
  ).toBe(2);
  const transport = events
    .filter((event) => event.kind === 'voice.transport')
    .at(-1);
  expect(transport?.metadata.providerGeneration).toBe(1);
  expect(transport?.metadata.generation).toBeUndefined();
  detach();
});

test('accepted results retain their generation when call IDs repeat across reconnect and retirement', async () => {
  const pending = Promise.withResolvers<void>();
  let submitted = 0;
  const h = harness({
    submitIntent: async () => {
      if (++submitted === 1) await pending.promise;
      return {};
    },
  });
  const events: DiagnosticEvent[] = [];
  let detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  await h.session.connect();
  const call = {
    type: 'tool_call',
    callId: ToolCallId('reused-call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"one change"}',
  } as const;
  h.emit(call);
  await tick();
  detach();
  detach = h.client.diagnostics.subscribe(({ event }) => events.push(event));
  await h.session.disconnect();
  await h.session.connect();
  h.emit(call);
  await tick();
  h.retire();
  pending.resolve();
  await tick();
  expect(
    events
      .filter((event) => event.kind === 'voice.tool.result')
      .map((event) => event.metadata.generation),
  ).toEqual([2, 1]);
  expect(
    events
      .filter((event) => event.kind === 'voice.tool.result')
      .every((event) => event.metadata.providerInstanceId === 'voice-lifetime'),
  ).toBe(true);
  detach();
});

test('a cancelled undispatched call cannot keep a retired attachment subscribed', async () => {
  const h = harness();
  h.retire();
  const source = h.session.events;
  const subscribe = source.subscribe;
  let subscriptions = 0;
  source.subscribe = (listener) => {
    subscriptions++;
    const release = subscribe(listener);
    return () => {
      subscriptions--;
      release();
    };
  };
  const retire = attachRealtimeDiagnostics({
    session: h.session,
    adapter: h.adapter,
    sink: h.client.diagnostics,
    identity: h.identity,
  });
  const detach = h.client.diagnostics.subscribe(() => {});
  let ending: Promise<void> | undefined;
  const cancel = source.subscribe((event) => {
    if (event.type === 'tool.called') ending = h.session.disconnect();
  });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('cancelled'),
    name: 'get_ui_state',
    argumentsJson: '{}',
  });
  await ending;
  cancel();
  retire();
  expect(subscriptions).toBe(0);
  detach();
});

test('provider observations cannot replace attachment ownership or enter the control namespace', () => {
  const h = harness();
  const events: DiagnosticEvent[] = [];
  const controls: DiagnosticEvent[] = [];
  let reads = 0;
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  const release = h.client.diagnostics.observeControls((event) =>
    controls.push(event),
  );
  h.identity.providerInstanceId = 'mutated-after-attachment';
  h.provider({
    kind: 'devtools.capture.changed',
    providerGeneration: 3,
    metadata: {
      provider: 'spoof',
      providerInstanceId: 'spoof',
      generation: 99,
      clientId: 'spoof',
      enabled: true,
    },
    readContent: () => {
      reads++;
      return { intent: 'private' };
    },
  });
  const observation = events.find(
    (event) => event.kind === 'voice.provider.devtools.capture.changed',
  );
  expect(observation?.metadata).toEqual({
    enabled: true,
    provider: 'example',
    providerInstanceId: 'voice-lifetime',
    providerGeneration: 3,
  });
  expect(controls).toEqual([]);
  expect(reads).toBe(0);
  release();
  detach();
});

test('late application outcomes retain call identity without inventing a current generation', async () => {
  const pending = Promise.withResolvers<void>();
  const h = harness({
    submitIntent: async () => {
      await pending.promise;
      return {};
    },
  });
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('old-call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"old work"}',
  });
  await tick();
  await h.session.disconnect();
  await h.session.connect();
  pending.resolve();
  await tick();
  const outcome = events.find((event) => event.kind === 'voice.tool.completed');
  expect(outcome?.metadata.callId).toBe('old-call');
  expect(outcome?.metadata.generation).toBeUndefined();
  expect(
    events.find((event) => event.kind === 'voice.tool.result')?.metadata
      .generation,
  ).toBe(1);
  detach();
});
