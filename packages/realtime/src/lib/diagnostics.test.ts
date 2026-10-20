import { afterEach, expect, spyOn, test } from 'bun:test';
import {
  type DiagnosticObservation,
  type IntentResult,
  type IntentSnapshot,
  Orchestrator,
} from '@maelstrom-co/client';
import {
  type DiagnosticEvent,
  MessageId,
  ToolCallId,
} from '@maelstrom-co/protocol';
import { createTelemetry, type TelemetryRecord } from '@maelstrom-co/telemetry';
import { Store } from '@tanstack/store';
import {
  type AdapterDiagnosticObservation,
  type AdapterVoiceObservation,
  attachRealtimeDiagnostics,
  attachRealtimeTelemetry,
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

function telemetryFixture() {
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  cleanups.push(async () => {
    telemetry.dispose();
  });
  return { records, telemetry };
}

function pendingIntent() {
  let resolve!: (value: Record<string, never>) => void;
  const promise = new Promise<Record<string, never>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test('diagnostics distinguish overlapping reused tool IDs without exposing invocation identity to telemetry', async () => {
  const first = pendingIntent();
  const second = pendingIntent();
  let submitted = 0;
  const h = harness({
    submitIntent: () => (++submitted === 1 ? first.promise : second.promise),
  });
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  const { records, telemetry } = telemetryFixture();
  const operational = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
  });
  await h.session.connect();
  const call = {
    type: 'tool_call',
    callId: ToolCallId('reused'),
    name: 'update_ui',
    argumentsJson: '{"intent":"change"}',
  } as const;
  h.emit(call);
  h.emit(call);
  const called = events.filter((event) => event.kind === 'voice.tool.called');
  expect(called).toHaveLength(2);
  const ids = called.map((event) => event.metadata.invocationId);
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(ids[0]).not.toBe(ids[1]);

  second.resolve({});
  await tick();
  first.resolve({});
  await tick();

  expect(
    events
      .filter((event) => event.kind === 'voice.tool.result')
      .map((event) => event.metadata.invocationId),
  ).toEqual([ids[1], ids[0]]);
  await telemetry.flush();
  expect(JSON.stringify(records)).not.toMatch(/invocationId|reused/);
  operational.release();
  detach();
});

test('a successfully applied queued voice tool links only its authoritative Engine response', async () => {
  const result: Extract<IntentResult, { status: 'applied' }> = {
    status: 'applied',
    response: {
      type: 'maelstrom_response',
      requestId: MessageId('engine-request'),
      rationale: 'fixture',
      userMessage: 'Done',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    },
  };
  const h = harness({
    createIntentScope: () => ({
      enqueueIntent: () => ({
        id: 'admission-ticket-is-not-request-id',
        accepted: true,
        store: new Store<IntentSnapshot>(result),
        result: Promise.resolve(result),
      }),
      retire() {},
    }),
  });
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"change"}',
  });
  await tick();

  expect(
    events.find((event) => event.kind === 'voice.tool.result')?.requestId,
  ).toBe('engine-request');
  expect(
    events.find((event) => event.kind === 'voice.tool.called')?.requestId,
  ).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain(
    'admission-ticket-is-not-request-id',
  );
  detach();
});

test('live voice diagnostics expose media and fragment facts without reading transcript content', async () => {
  const h = harness();
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  await h.session.connect();
  h.fragment('CANARY_transcript');
  h.observe({
    type: 'media',
    media: { userSpeech: 'active', incomingAudio: 'inactive' },
  });

  const fragment = events.find(
    (event) => event.kind === 'voice.transcript.fragment',
  );
  expect(fragment?.metadata.fragmentId).toBe('fragment');
  expect(fragment?.metadata.role).toBe('user');
  const media = events.filter((event) => event.kind === 'voice.media').at(-1);
  expect(media?.metadata.userSpeech).toBe('active');
  expect(media?.metadata.incomingAudio).toBe('inactive');
  expect(JSON.stringify(events)).not.toContain('CANARY_transcript');
  detach();
});

test('diagnostic attachment projects normalized responses and does not trust native lifecycle metadata', () => {
  const h = harness();
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  let reads = 0;
  h.provider({
    kind: 'wire',
    providerGeneration: 7,
    metadata: {
      type: 'native.finished',
      responseId: 'native-context',
      responsePhase: 'started',
      responseOutcome: 'failed',
    },
    response: { id: 'response', phase: 'finished', outcome: 'cancelled' },
    readContent: () => {
      reads++;
      return { text: 'private' };
    },
  });
  expect(events.at(-1)?.metadata).toMatchObject({
    type: 'native.finished',
    providerGeneration: 7,
    responseId: 'response',
    responsePhase: 'finished',
    responseOutcome: 'cancelled',
  });
  h.provider({
    kind: 'wire',
    providerGeneration: 7,
    metadata: {
      responseId: 'legacy',
      responsePhase: 'finished',
      responseOutcome: 'succeeded',
    },
  });
  expect(events.at(-1)?.metadata.responsePhase).toBeUndefined();
  expect(events.at(-1)?.metadata.responseOutcome).toBeUndefined();
  expect(reads).toBe(0);
  detach();
});

test('voice telemetry never activates provider diagnostics, transcript snapshots, or content readers', async () => {
  const h = harness();
  Object.defineProperty(h.adapter, 'diagnostics', {
    get() {
      throw new Error('CANARY_provider_diagnostics');
    },
  });
  Object.defineProperty(h.adapter, 'getTransportSnapshot', {
    get() {
      throw new Error('CANARY_transport_detail');
    },
  });
  Object.defineProperty(h.session, 'observations', {
    get() {
      throw new Error('CANARY_transcript_snapshot');
    },
  });
  const { records, telemetry } = telemetryFixture();
  const retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    providerCategory: 'custom',
  });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('CANARY_call'),
    name: 'get_ui_state',
    argumentsJson: '{"CANARY_argument":true}',
  });
  await tick();
  await telemetry.flush();
  expect(records.map((record) => record.attributes.outcome)).toEqual([
    'started',
    'succeeded',
  ]);
  expect(JSON.stringify(records)).not.toContain('CANARY');
  retire.release();
});

test('duplicate voice attachments share a lifetime and reject incompatible policies without replacing it', async () => {
  const h = harness();
  const { records, telemetry } = telemetryFixture();
  const options = {
    session: h.session,
    telemetry,
    providerCategory: 'custom' as const,
  };
  const first = attachRealtimeTelemetry(options);
  const second = attachRealtimeTelemetry(options);
  expect(() =>
    attachRealtimeTelemetry({ ...options, providerCategory: 'livekit' }),
  ).toThrow(RangeError);
  expect(() =>
    attachRealtimeTelemetry({ ...options, maxPendingTools: 1 }),
  ).toThrow(RangeError);
  first.release();
  first.release();
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('CANARY_call'),
    name: 'get_ui_state',
    argumentsJson: '{}',
  });
  await tick();
  await telemetry.flush();
  expect(records.map((record) => record.attributes.outcome)).toEqual([
    'started',
    'succeeded',
  ]);
  second.release();
  second.release();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('CANARY_other'),
    name: 'get_ui_state',
    argumentsJson: '{}',
  });
  await tick();
  await telemetry.flush();
  expect(records).toHaveLength(2);
  expect(telemetry.enabled).toBe(true);
});

test.each([
  'same_generation',
  'reconnect',
] as const)('accepted voice results preserve their original owner when call IDs repeat: %s', async (mode) => {
  const first = pendingIntent();
  const second = pendingIntent();
  let submitted = 0;
  const h = harness({
    submitIntent: () => (++submitted === 1 ? first.promise : second.promise),
  });
  const { records, telemetry } = telemetryFixture();
  let retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    providerCategory: 'openai-live',
  });
  await h.session.connect();
  const call = {
    type: 'tool_call' as const,
    callId: ToolCallId('CANARY_reused'),
    name: 'update_ui',
    argumentsJson: '{"intent":"CANARY_intent"}',
  };
  h.emit(call);
  await tick();
  retire.release();
  if (mode === 'reconnect') {
    await h.session.disconnect();
    await h.session.connect();
  }
  retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    providerCategory: 'livekit',
  });
  h.emit(call);
  await tick();
  first.resolve({});
  await tick();
  await telemetry.flush();
  expect(
    records
      .filter((record) => record.attributes.outcome === 'succeeded')
      .map((record) => record.attributes.provider),
  ).toEqual(['openai-live']);
  second.resolve({});
  await tick();
  await telemetry.flush();
  expect(
    records
      .filter((record) => record.attributes.outcome === 'succeeded')
      .map((record) => record.attributes.provider),
  ).toEqual(['openai-live', 'livekit']);
  expect(
    records.filter((record) => record.attributes.outcome === 'started'),
  ).toHaveLength(2);
  expect(JSON.stringify(records)).not.toMatch(
    /CANARY|callId|generation|providerInstanceId/,
  );
  retire.release();
});

test('a full pending-observation budget reports loss without evicting an accepted result or blocking work', async () => {
  const first = pendingIntent();
  const second = pendingIntent();
  let submitted = 0;
  const h = harness({
    submitIntent: () => (++submitted === 1 ? first.promise : second.promise),
  });
  const { records, telemetry } = telemetryFixture();
  const retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    maxPendingTools: 1,
  });
  await h.session.connect();
  const call = {
    type: 'tool_call' as const,
    callId: ToolCallId('CANARY_reused'),
    name: 'update_ui',
    argumentsJson: '{"intent":"CANARY_intent"}',
  };
  h.emit(call);
  h.emit(call);
  await tick();
  expect(submitted).toBe(2);
  second.resolve({});
  await tick();
  retire.release();
  first.resolve({});
  await tick();
  await telemetry.flush();
  expect(
    records
      .filter((record) => record.attributes.operation === 'voice.tool')
      .map((record) => record.attributes.outcome),
  ).toEqual(['started', 'succeeded']);
  expect(
    records
      .filter((record) => record.attributes.operation === 'telemetry.source')
      .map((record) => record.attributes.outcome),
  ).toEqual(['discarded']);
});

test('retirement bounds never-settling tool observation and ignores completion after its drain deadline', async () => {
  const pending = pendingIntent();
  const h = harness({ submitIntent: () => pending.promise });
  const { records, telemetry } = telemetryFixture();
  const retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    drainTimeoutMs: 10,
  });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('CANARY_call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"CANARY_intent"}',
  });
  await tick();
  retire.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await telemetry.flush();
  expect(records.map((record) => record.attributes.operation)).toEqual([
    'voice.tool',
    'telemetry.source',
  ]);
  pending.resolve({});
  await tick();
  await telemetry.flush();
  expect(records).toHaveLength(2);
});

test('undispatched cancellation reports no invented duration or provider failure', async () => {
  let submitted = 0;
  const h = harness({
    submitIntent: async () => {
      submitted++;
      return {};
    },
  });
  const { records, telemetry } = telemetryFixture();
  h.session.events.subscribe((event) => {
    if (event.type === 'tool.called') void h.session.disconnect();
  });
  const retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
  });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('CANARY_call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"CANARY_intent"}',
  });
  await tick();
  await telemetry.flush();
  expect(submitted).toBe(0);
  expect(records.map((record) => record.attributes.outcome)).toEqual([
    'started',
    'cancelled',
  ]);
  expect(records[1].measurements).toHaveLength(1);
  retire.release();
});

test('an uncertain application result remains unknown instead of becoming a tool failure', async () => {
  const h = harness({
    submitIntent: async () => {
      throw new Error('CANARY_transport');
    },
  });
  const { records, telemetry } = telemetryFixture();
  const retire = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
  });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('CANARY_call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"CANARY_intent"}',
  });
  await tick();
  await telemetry.flush();
  expect(records.map((record) => record.attributes.outcome)).toEqual([
    'started',
    'unknown',
  ]);
  expect(JSON.stringify(records)).not.toContain('CANARY');
  retire.release();
});

test('disabled voice telemetry adds no subscriptions or provider work', async () => {
  const h = harness();
  let subscribed = 0;
  const original = h.session.events.subscribe;
  h.session.events.subscribe = (listener) => {
    subscribed++;
    return original(listener);
  };
  attachRealtimeTelemetry({ session: h.session }).release();
  attachRealtimeTelemetry({
    session: h.session,
    telemetry: createTelemetry(),
  }).release();
  expect(() =>
    attachRealtimeTelemetry({
      session: h.session,
      maxPendingTools: 0,
      drainTimeoutMs: 0,
    }),
  ).not.toThrow();
  expect(() =>
    attachRealtimeTelemetry({
      session: h.session,
      telemetry: createTelemetry(),
      maxPendingTools: 0,
      drainTimeoutMs: 0,
    }),
  ).not.toThrow();
  expect(subscribed).toBe(0);
  expect(h.providerSubscribers()).toBe(0);
});

test('local operational observation does not activate provider diagnostic or transcript collection', async () => {
  const h = harness();
  const releaseMetadata = h.client.diagnostics.subscribeMetadata(() => {});
  expect(h.providerSubscribers()).toBe(0);
  const releaseDiagnostics = h.client.diagnostics.subscribe(() => {});
  expect(h.providerSubscribers()).toBe(1);
  releaseDiagnostics();
  expect(h.providerSubscribers()).toBe(0);
  expect(h.client.diagnostics.observed).toBe(false);
  expect(h.client.diagnostics.locallyObserved).toBe(true);
  releaseMetadata();
});

test('a legacy source scheduler cannot override an explicit diagnostic capability denial', async () => {
  const h = harness();
  const retire = attachRealtimeDiagnostics({
    session: h.session,
    adapter: h.adapter,
    identity: h.identity,
    sink: {
      observed: true,
      diagnosticsObserved: false,
      addSource: (start) => start(),
      emit() {},
    },
  });
  expect(h.providerSubscribers()).toBe(0);
  retire();
});

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
    observe: (event: AdapterVoiceObservation) => {
      for (const listener of [...media]) listener(event);
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

test('voice shutdown waits for accepted tool results before the final flush', async () => {
  const pending = pendingIntent();
  const h = harness({ submitIntent: () => pending.promise });
  const { records, telemetry } = telemetryFixture();
  const attachment = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    drainTimeoutMs: 100,
  });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('drain-call'),
    name: 'update_ui',
    argumentsJson: '{"intent":"test"}',
  });
  await tick();
  let drained = false;
  void attachment.drained.then(() => {
    drained = true;
  });
  attachment.release();
  await tick();
  expect(drained).toBe(false);
  pending.resolve({});
  await attachment.drained;
  await telemetry.flush();
  telemetry.dispose();
  expect(records.map((record) => record.attributes.outcome)).toEqual([
    'started',
    'succeeded',
  ]);
});

test('successful voice drain cancels its timer and releases the only telemetry subscription', async () => {
  const pending = pendingIntent();
  const h = harness({ submitIntent: () => pending.promise });
  let active = 0;
  const subscribe = h.session.events.subscribe;
  h.session.events.subscribe = (listener) => {
    active++;
    const release = subscribe(listener);
    return () => {
      active--;
      release();
    };
  };
  const { records, telemetry } = telemetryFixture();
  const attachment = attachRealtimeTelemetry({
    session: h.session,
    telemetry,
    drainTimeoutMs: 37,
  });
  expect(active).toBe(1);
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('drain-success'),
    name: 'update_ui',
    argumentsJson: '{"intent":"test"}',
  });
  await tick();
  const set = spyOn(globalThis, 'setTimeout');
  const clear = spyOn(globalThis, 'clearTimeout');
  try {
    attachment.release();
    const index = set.mock.calls.findIndex((args) => args[1] === 37);
    expect(index).toBeGreaterThanOrEqual(0);
    const timer = set.mock.results[index]?.value;
    pending.resolve({});
    await attachment.drained;
    expect(clear.mock.calls.some((args) => args[0] === timer)).toBe(true);
    expect(active).toBe(0);
    await telemetry.flush();
    expect(
      records.map((record) => [
        record.attributes.operation,
        record.attributes.outcome,
      ]),
    ).toEqual([
      ['voice.tool', 'started'],
      ['voice.tool', 'succeeded'],
    ]);
  } finally {
    pending.resolve({});
    attachment.release();
    set.mockRestore();
    clear.mockRestore();
  }
});

test('accepted voice outcomes remain visible as refusals after delivery disposal', async () => {
  const pending = pendingIntent();
  const h = harness({ submitIntent: () => pending.promise });
  const { telemetry } = telemetryFixture();
  const attachment = attachRealtimeTelemetry({ session: h.session, telemetry });
  await h.session.connect();
  h.emit({
    type: 'tool_call',
    callId: ToolCallId('disposed-delivery'),
    name: 'update_ui',
    argumentsJson: '{"intent":"test"}',
  });
  await tick();
  await telemetry.flush();
  telemetry.dispose();
  attachment.release();
  pending.resolve({});
  await attachment.drained;
  expect(telemetry.getSnapshot()).toMatchObject({
    delivered: 1,
    dropped: { disposed: 1 },
  });
});

test.each([
  'maxPendingTools',
  'drainTimeoutMs',
] as const)('enabled %s limits reject invalid values before subscribing', (field) => {
  const h = harness();
  const { telemetry } = telemetryFixture();
  let subscriptions = 0;
  const subscribe = h.session.events.subscribe;
  h.session.events.subscribe = (listener) => {
    subscriptions++;
    return subscribe(listener);
  };
  for (const value of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    field === 'maxPendingTools' ? 65_537 : 60_001,
  ]) {
    expect(() =>
      attachRealtimeTelemetry({
        session: h.session,
        telemetry,
        [field]: value,
      }),
    ).toThrow(RangeError);
  }
  expect(subscriptions).toBe(0);
});

test('legacy diagnostic sources stop reads and publication after capability revocation', async () => {
  const h = harness();
  let allowed = true;
  const seen: string[] = [];
  const release = attachRealtimeDiagnostics({
    session: h.session,
    adapter: h.adapter,
    identity: h.identity,
    sink: {
      observed: true,
      get diagnosticsObserved() {
        return allowed;
      },
      addSource: (start) => start(),
      emit: (kind) => {
        seen.push(kind);
      },
    },
  });
  await h.session.connect();
  const snapshots = spyOn(h.session.observations, 'getSnapshot');
  try {
    seen.length = 0;
    allowed = false;
    h.provider({ kind: 'private', providerGeneration: 1, metadata: {} });
    h.fragment('CANARY_fragment');
    expect(seen).toEqual([]);
    expect(snapshots).not.toHaveBeenCalled();
  } finally {
    snapshots.mockRestore();
    release();
  }
});

test('voice diagnostic events stay out of client metadata subscriptions', async () => {
  const h = harness();
  const metadata: string[] = [];
  const releaseMetadata = h.client.diagnostics.subscribeMetadata((kind) => {
    metadata.push(kind);
  });
  const diagnostics: string[] = [];
  const releaseDiagnostics = h.client.diagnostics.subscribe(({ event }) => {
    diagnostics.push(event.kind);
  });
  const { records, telemetry } = telemetryFixture();
  const attachment = attachRealtimeTelemetry({ session: h.session, telemetry });
  try {
    await h.session.connect();
    h.emit({
      type: 'tool_call',
      callId: ToolCallId('diagnostic-only'),
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
    await tick();
    await telemetry.flush();
    expect(diagnostics).toContain('voice.tool.result');
    expect(metadata.filter((kind) => kind.startsWith('voice.'))).toEqual([]);
    expect(records.map((r) => r.attributes.outcome)).toEqual([
      'started',
      'succeeded',
    ]);
  } finally {
    attachment.release();
    await attachment.drained;
    releaseDiagnostics();
    releaseMetadata();
  }
});
