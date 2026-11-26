import { afterEach, expect, spyOn, test } from 'bun:test';

import {
  type DiagnosticObservation,
  type IntentResult,
  type IntentSnapshot,
  Orchestrator,
} from '@maelstrom-co/client';
import { createTestConnector } from '@maelstrom-co/client/_testing';
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
  type RealtimeDiagnosticClock,
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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

test('user speech ending after it was active reports the speech span duration', async () => {
  const h = harness();
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  const now = spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    await h.session.connect();
    h.observe({ type: 'media', media: { userSpeech: 'active' } });
    now.mockReturnValue(1_750);
    h.observe({ type: 'media', media: { incomingAudio: 'active' } });
    h.observe({ type: 'media', media: { userSpeech: 'inactive' } });
    h.observe({ type: 'media', media: { userSpeech: 'unknown' } });
  } finally {
    now.mockRestore();
  }

  const media = events
    .filter((event) => event.kind === 'voice.media')
    .map((event) => event.metadata);
  expect(media[0]?.durationMs).toBeUndefined();
  expect(media[1]?.durationMs).toBeUndefined();
  expect(media[2]).toMatchObject({
    userSpeech: 'inactive',
    userSpeechStartedAt: 1_000,
    durationMs: 750,
  });
  expect(media[3]?.durationMs).toBeUndefined();
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

test.each(['same_generation', 'reconnect'] as const)(
  'accepted voice results preserve their original owner when call IDs repeat: %s',
  async (mode) => {
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
      name: 'submit_intent',
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
  },
);

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
    name: 'submit_intent',
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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

function harness(
  override: Partial<RealtimeInstance> = {},
  clock?: RealtimeDiagnosticClock,
) {
  const client = new Orchestrator(
    createTestConnector({
      process: async () => {
        throw new Error('Unexpected planner call');
      },
    }),
  );
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
    ...(clock ? { clock } : {}),
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
    say: (id: string, role: 'user' | 'assistant', startMs = 0) => {
      for (const listener of [...media])
        listener({
          type: 'fragment',
          fragment: {
            id,
            role,
            speakerId: role,
            text: `${role} ${id}`,
            startMs,
            endMs: startMs + 10,
          },
        });
    },
    call: (callId: string) =>
      [...events].forEach((listener) =>
        listener({
          type: 'tool_call',
          callId: ToolCallId(callId),
          name: 'submit_intent',
          argumentsJson: '{"intent":"change"}',
        }),
      ),
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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
    name: 'submit_intent',
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

test.each(['maxPendingTools', 'drainTimeoutMs'] as const)(
  'enabled %s limits reject invalid values before subscribing',
  (field) => {
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
  },
);

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

test('processing observations surface standby and active states without typed intents changing them', async () => {
  const h = harness();
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  await h.session.connect();

  h.observe({ type: 'processing', processing: 'standby' });
  expect(h.session.observations.getSnapshot().processing).toBe('standby');

  // Typed intent while voice processing is on standby does not change processing state.
  await h.client.processIntent('typed intent during pause').catch(() => {});
  expect(h.session.observations.getSnapshot().processing).toBe('standby');

  h.observe({ type: 'processing', processing: 'active' });
  expect(h.session.observations.getSnapshot().processing).toBe('active');

  const processingEvents = events.filter(
    (event) => event.kind === 'voice.processing',
  );
  expect(processingEvents.map((event) => event.metadata.processing)).toEqual([
    'standby',
    'active',
  ]);
  const observationStates = events
    .filter((event) => event.kind === 'voice.observations')
    .map((event) => event.metadata.processing);
  expect(observationStates).toContain('standby');
  expect(observationStates.at(-1)).toBe('active');
  detach();
});

function fakeClock() {
  let now = 0;
  let nextHandle = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: RealtimeDiagnosticClock = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const handle = ++nextHandle;
      timers.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    pending: () => timers.size,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
  };
}

function stallHarness(override: Partial<RealtimeInstance> = {}) {
  const time = fakeClock();
  const h = harness(override, time.clock);
  const events: DiagnosticEvent[] = [];
  const detach = h.client.diagnostics.subscribe(({ event }) =>
    events.push(event),
  );
  cleanups.push(async () => detach());
  return {
    ...h,
    ...time,
    detach,
    stalls: () =>
      events
        .filter((event) => event.kind === 'voice.stall_suspected')
        .map((event) => event.metadata),
  };
}

test('a user fragment without an assistant reply suspects one stall after 8 seconds', async () => {
  const h = stallHarness();
  await h.session.connect();
  h.say('question', 'user');
  h.advance(7_999);
  expect(h.stalls()).toEqual([]);
  h.advance(1);
  h.advance(60_000);

  expect(h.stalls()).toHaveLength(1);
  expect(h.stalls()[0]).toMatchObject({
    reason: 'no_assistant_response',
    fragmentId: 'question',
    provider: 'example',
    providerInstanceId: 'voice-lifetime',
    generationScope: 'session',
  });
});

test('a partial user fragment arms the response deadline and a later revision re-arms it', async () => {
  const h = stallHarness();
  await h.session.connect();
  h.observe({
    type: 'fragment',
    fragment: {
      id: 'question',
      role: 'user',
      speakerId: 'user',
      text: 'partial',
      startMs: 0,
      endMs: 10,
      final: false,
    },
  });
  h.advance(5_000);
  h.say('question', 'user');
  h.advance(7_999);
  expect(h.stalls()).toEqual([]);
  h.advance(1);

  expect(h.stalls().map((stall) => stall.reason)).toEqual([
    'no_assistant_response',
  ]);
});

test('an assistant fragment or a tool call before the deadline clears the response stall', async () => {
  const replied = stallHarness();
  await replied.session.connect();
  replied.say('question', 'user');
  replied.advance(3_000);
  replied.say('answer', 'assistant', 20);
  replied.advance(60_000);
  expect(replied.stalls()).toEqual([]);

  const delegated = stallHarness();
  await delegated.session.connect();
  delegated.say('question', 'user');
  delegated.advance(3_000);
  delegated.call('call');
  await tick();
  delegated.advance(60_000);
  expect(delegated.stalls()).toEqual([]);
});

test('a tool call without a result suspects one stall after 20 seconds', async () => {
  const never = pendingIntent();
  const h = stallHarness({ submitIntent: () => never.promise });
  await h.session.connect();
  h.call('stuck');
  h.advance(19_999);
  expect(h.stalls()).toEqual([]);
  h.advance(1);
  h.advance(60_000);

  expect(h.stalls()).toHaveLength(1);
  expect(h.stalls()[0]).toMatchObject({
    reason: 'tool_result_timeout',
    callId: 'stuck',
    tool: 'submit_intent',
    provider: 'example',
    generation: 1,
  });
});

test('a typed submit outcome the voice session awaits past 20 seconds is suspected once', async () => {
  const typed = pendingIntent();
  const h = stallHarness({ submitIntent: () => typed.promise });
  await h.session.connect();
  h.call('typed-intent');
  h.advance(20_000);
  typed.resolve({});
  await tick();
  h.advance(60_000);

  expect(h.stalls()).toEqual([
    expect.objectContaining({
      reason: 'tool_result_timeout',
      callId: 'typed-intent',
    }),
  ]);
});

test('replayed call scenarios suspect exactly one stall per stalled turn with its reason', async () => {
  const scenarios: {
    readonly name: string;
    readonly replay: (h: ReturnType<typeof stallHarness>) => Promise<void>;
    readonly expected: readonly string[];
  }[] = [
    {
      name: 'user speaks and the assistant stays silent',
      replay: async (h) => {
        h.say('turn-1', 'user');
        h.advance(30_000);
      },
      expected: ['no_assistant_response'],
    },
    {
      name: 'tool call never returns a result',
      replay: async (h) => {
        h.say('turn-1', 'user');
        h.advance(1_200);
        h.call('lost-result');
        await tick();
        h.advance(45_000);
      },
      expected: ['tool_result_timeout'],
    },
    {
      name: 'quick reply and a tool result in time',
      replay: async (h) => {
        h.say('turn-1', 'user');
        h.advance(900);
        h.say('reply-1', 'assistant', 20);
        h.advance(2_000);
        h.call('fast-result');
        await tick();
        h.advance(45_000);
      },
      expected: [],
    },
    {
      name: 'no user fragment at all',
      replay: async (h) => {
        h.advance(120_000);
      },
      expected: [],
    },
  ];
  for (const scenario of scenarios) {
    const never = pendingIntent();
    const h = stallHarness(
      scenario.name === 'tool call never returns a result'
        ? { submitIntent: () => never.promise }
        : {},
    );
    await h.session.connect();
    await scenario.replay(h);
    expect({
      name: scenario.name,
      reasons: h.stalls().map((stall) => stall.reason),
    }).toEqual({ name: scenario.name, reasons: [...scenario.expected] });
  }
});

test('stall timers stop on disconnect, detach, and retirement without publishing later', async () => {
  const never = pendingIntent();
  const disconnected = stallHarness({ submitIntent: () => never.promise });
  await disconnected.session.connect();
  disconnected.say('question', 'user');
  disconnected.call('stuck');
  await disconnected.session.disconnect();
  expect(disconnected.pending()).toBe(0);
  disconnected.advance(60_000);
  expect(disconnected.stalls()).toEqual([]);

  const detached = stallHarness({ submitIntent: () => never.promise });
  await detached.session.connect();
  detached.call('stuck');
  detached.say('question', 'user');
  detached.detach();
  expect(detached.pending()).toBe(0);

  const retired = stallHarness({ submitIntent: () => never.promise });
  await retired.session.connect();
  retired.call('stuck');
  retired.say('question', 'user');
  retired.retire();
  expect(retired.pending()).toBe(0);
  retired.advance(60_000);
  expect(retired.stalls()).toEqual([]);
});
