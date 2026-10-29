import { expect, test } from 'bun:test';
import {
  ChartRequestMessage,
  type DiagnosticEvent,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  buildGridResponse,
  makeGridRequest,
  silentLogger,
} from './__test-helpers__/fixtures.js';
import { scriptedPlanner } from './__test-helpers__/stub-planner.js';
import {
  createDiagnosticConnection,
  type DiagnosticConnectionOptions,
  EngineDiagnosticEmitter,
} from './diagnostics.js';
import type { Engine } from './engine.js';
import { createEngine } from './engine.js';

test('operational metadata preserves actual planner work when diagnostic IDs are ambiguous', () => {
  const emitter = new EngineDiagnosticEmitter();
  const operational: string[] = [];
  const diagnostic: string[] = [];
  emitter.subscribeMetadata((kind) => {
    operational.push(kind);
  });
  emitter.subscribe((event) => {
    diagnostic.push(event.kind);
  });
  const sessionId = SessionId('shared-session');
  const requestId = MessageId('reused-request');
  const first = emitter.trackRequest(sessionId, requestId);
  const second = emitter.trackRequest(sessionId, requestId);
  emitter.emit(sessionId, requestId, 'engine.planner.completed', {
    outcome: 'succeeded',
  });
  emitter.emit(sessionId, requestId, 'engine.planner.completed', {
    outcome: 'failed',
  });
  first();
  second();
  expect(
    operational.filter((kind) => kind === 'engine.planner.completed'),
  ).toHaveLength(2);
  expect(
    diagnostic.filter((kind) => kind === 'engine.planner.completed'),
  ).toEqual([]);
});

test('production metadata observations need neither diagnostic envelopes nor lazy content', () => {
  const emitter = new EngineDiagnosticEmitter();
  const observations: unknown[][] = [];
  emitter.subscribeMetadata((...args) => {
    observations.push(args);
  });
  const original = crypto.randomUUID;
  crypto.randomUUID = () => {
    throw new Error('Unexpected diagnostic envelope');
  };
  try {
    expect(() =>
      emitter.emit(
        SessionId('CANARY_session'),
        MessageId('CANARY_request'),
        'engine.stage.completed',
        { stage: 'test', durationMs: 4, outcome: 'succeeded' },
        () => {
          throw new Error('CANARY_prompt');
        },
      ),
    ).not.toThrow();
  } finally {
    crypto.randomUUID = original;
  }
  expect(observations).toEqual([
    [
      'engine.stage.completed',
      { stage: 'test', durationMs: 4, outcome: 'succeeded' },
    ],
  ]);
});

const request = (id: string) =>
  ChartRequestMessage({
    id: MessageId(id),
    sessionId: SessionId('authorized'),
    request: {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'fixture' }],
        chartDimensions: { rows: 12, columns: 16 },
        layoutMode: 'grid',
      },
      instances: [],
      vessels: [],
      layout: { type: 'grid', positions: [] },
    },
  });

test('Engine observation keeps authorized session and request identity domains distinct', () => {
  const sessionId = SessionId('authorized');
  const requestId = MessageId('owned-request');
  // @ts-expect-error A connection is bound to an application session, not a message.
  const wrongSession: DiagnosticConnectionOptions['sessionId'] = requestId;
  // @ts-expect-error Engine request tracking accepts a message, not a session.
  const wrongRequest: Parameters<EngineDiagnosticEmitter['trackRequest']>[1] =
    sessionId;
  void [wrongSession, wrongRequest];
  const emitter = new EngineDiagnosticEmitter();
  const observations: DiagnosticEvent[] = [];
  emitter.subscribe((event) => observations.push(event));
  const finish = emitter.trackRequest(sessionId, requestId);
  emitter.emit(sessionId, requestId, 'engine.fixture');
  finish();
  expect(observations).toMatchObject([
    {
      sessionId: SessionId('authorized'),
      requestId: 'owned-request',
      kind: 'engine.fixture',
    },
    {
      sessionId: SessionId('authorized'),
      requestId: 'owned-request',
      kind: 'engine.request.finished',
    },
  ]);
});

const subscription = (
  sessionId: string,
  enabled = true,
  includeContent = false,
) => ({
  type: 'client.diagnostics.subscribe',
  id: MessageId(),
  sessionId: SessionId(sessionId),
  enabled,
  includeContent,
});

test.each([
  'promise',
  'thenable',
  'throwing-then-getter',
] as const)('optional Engine observer failures cannot crash or delay requests: %s', (mode) => {
  const probe = `
    import { createEngine } from '../index.ts';
    import { ChartRequestMessage, MessageId, SessionId } from '@maelstrom-co/protocol';
    import { buildGridResponse, makeGridRequest, silentLogger } from './__test-helpers__/fixtures.ts';
    import { scriptedPlanner } from './__test-helpers__/stub-planner.ts';
    const engine = createEngine({
      logger: silentLogger,
      retry: false,
      planner: scriptedPlanner([buildGridResponse()]),
    });
    const mode = ${JSON.stringify(mode)};
    const fail = () => new Error('optional Engine observer failed');
    if (mode === 'promise') engine.observeDiagnostics(async () => { throw fail(); });
    else if (mode === 'thenable') engine.observeDiagnostics(() => {
      const rejected = Promise.reject(fail());
      return { then(resolve, reject) { return rejected.then(resolve, reject); } };
    });
    else engine.observeDiagnostics(() => ({ get then() { throw fail(); } }));
    engine.observeDiagnostics(() => new Promise(() => {}));
    const events = [];
    engine.observeDiagnostics(event => events.push(event.kind));
    const result = await engine.handle(ChartRequestMessage({
      id: MessageId('observer-request'),
      sessionId: SessionId('observer-session'),
      request: makeGridRequest(),
    }));
    if (!result.ok) throw new Error('Observer changed the request result');
    if (!events.includes('engine.request.finished')) throw new Error('Healthy observer missed completion');
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log('request completed');
  `;
  const child = Bun.spawnSync(
    [process.execPath, '--no-env-file', '--eval', probe],
    {
      cwd: import.meta.dir,
      env: { ...process.env, NODE_ENV: 'development' },
      timeout: 5000,
    },
  );
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  expect(child.stdout.toString()).toContain('request completed');
});

test('server forwarding requires host opt-in and matching session; stopping prevents later content access', async () => {
  const emitter = new EngineDiagnosticEmitter();
  const frames: string[] = [];
  let read = 0;
  const work = Promise.withResolvers<void>();
  const engine: Engine = {
    openConnection: () => {
      throw new Error('unexpected streaming connection');
    },
    handle: async (message) => {
      await work.promise;
      return ok({
        type: 'assistant_message_result',
        sessionId: message.sessionId,
        id: message.id,
        outcome: 'inserted',
      });
    },
    getHistory: async () => {
      throw new Error('unexpected history');
    },
    observeDiagnostics: (listener) => emitter.subscribe(listener),
  };
  const connection = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (frame) => frames.push(frame),
  });
  const pending = connection.handle(request('request'));
  const emit = () =>
    emitter.emit(
      SessionId('authorized'),
      MessageId('request'),
      'engine.fixture',
      {},
      () => {
        read++;
        return { apiKey: 'private', text: 'captured' };
      },
    );
  await connection.handle(subscription('other', true, true));
  emit();
  expect(frames).toHaveLength(0);
  expect(read).toBe(0);
  await connection.handle(subscription('authorized'));
  emit();
  expect(frames).toHaveLength(1);
  expect(read).toBe(0);
  await connection.handle(subscription('authorized', true, true));
  emit();
  expect(read).toBe(1);
  expect(frames.at(-1)).toContain('captured');
  expect(frames.at(-1)).not.toContain('private');
  await connection.handle(subscription('authorized', false));
  emit();
  expect(frames).toHaveLength(2);
  expect(read).toBe(1);
  connection.dispose();
  const disabled = createDiagnosticConnection(engine, {
    sessionId: SessionId('authorized'),
    send: (frame) => frames.push(frame),
  });
  await disabled.handle(subscription('authorized', true, true));
  emit();
  expect(frames).toHaveLength(2);
  disabled.dispose();
  work.resolve();
  await pending;
});

test('connections sharing a SessionId capture only their own in-flight requests, including subscriptions started mid-request', async () => {
  const emitter = new EngineDiagnosticEmitter();
  const work = Promise.withResolvers<void>();
  const engine: Engine = {
    openConnection: () => {
      throw new Error('unexpected streaming connection');
    },
    handle: async (message) => {
      await work.promise;
      return ok({
        type: 'assistant_message_result',
        sessionId: message.sessionId,
        id: message.id,
        outcome: 'inserted',
      });
    },
    getHistory: async () => ok([]),
    observeDiagnostics: (listener) => emitter.subscribe(listener),
  };
  const framesA: string[] = [];
  const framesB: string[] = [];
  const a = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (frame) => framesA.push(frame),
  });
  const b = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (frame) => framesB.push(frame),
  });
  const pendingA = a.handle(request('request-a'));
  const pendingB = b.handle(request('request-b'));
  await a.handle(subscription('authorized', true, true));
  await b.handle(subscription('authorized'));
  let reads = 0;
  const emit = (id: string) =>
    emitter.emit(
      SessionId('authorized'),
      MessageId(id),
      'engine.fixture',
      {},
      () => {
        reads++;
        return { text: `private-${id}` };
      },
    );
  emit('request-b');
  expect(framesA).toHaveLength(0);
  expect(framesB).toHaveLength(1);
  expect(reads).toBe(0);
  emit('request-a');
  expect(framesA).toHaveLength(1);
  expect(framesA[0]).toContain('private-request-a');
  expect(framesB).toHaveLength(1);
  expect(reads).toBe(1);
  await a.handle(subscription('authorized', false));
  await a.handle(subscription('authorized', true, true));
  emit('request-a');
  expect(framesA).toHaveLength(2);
  work.resolve();
  await Promise.all([pendingA, pendingB]);
  emit('request-a');
  emit('request-b');
  expect(framesA).toHaveLength(2);
  expect(framesB).toHaveLength(1);
  a.dispose();
  b.dispose();
});

test('planner stage evidence preserves request identity and does not replace existing instrumentation', async () => {
  const emitter = new EngineDiagnosticEmitter();
  const events: DiagnosticEvent[] = [];
  let baseCalls = 0;
  emitter.subscribe((event) => events.push(event));
  const instrument = emitter.instrument(
    {
      event: () => {
        baseCalls++;
      },
      stage: (_name, stage) => stage,
    },
    SessionId('session'),
    MessageId('request'),
  );
  instrument.event('llm.call', { 'gen_ai.usage.input_tokens': 17 });
  expect(baseCalls).toBe(1);
  expect(events[0]).toMatchObject({
    kind: 'engine.llm.call',
    requestId: 'request',
    sessionId: 'session',
    metadata: { 'gen_ai.usage.input_tokens': 17 },
  });
});

test.each([
  'connection',
  'direct',
] as const)('colliding request IDs cannot expose another execution through %s dispatch', async (dispatch) => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const scripted = scriptedPlanner([
    buildGridResponse(),
    buildGridResponse(),
    buildGridResponse(),
  ]);
  let calls = 0;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input, context) => {
      if (++calls === 2) started.resolve();
      await gate.promise;
      return scripted(input, context);
    },
  });
  const framesA: string[] = [];
  const framesB: string[] = [];
  const a = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (wire) => framesA.push(wire),
  });
  const b = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (wire) => framesB.push(wire),
  });
  await a.handle(subscription('authorized', true, true));
  await b.handle(subscription('authorized', true, true));
  const envelope = (intent: string) => {
    const value = makeGridRequest();
    return ChartRequestMessage({
      id: MessageId('collision'),
      sessionId: SessionId('authorized'),
      request: {
        ...value,
        context: {
          ...value.context,
          updateReasons: [{ type: 'user_intent', intent }],
        },
      },
    });
  };
  const pendingA = a.handle(envelope('private-A'));
  const pendingB =
    dispatch === 'direct'
      ? engine.handle(envelope('private-B'))
      : b.handle(envelope('private-B'));
  try {
    await started.promise;
    expect(framesA.some((wire) => wire.includes('private-B'))).toBe(false);
    expect(framesB.some((wire) => wire.includes('private-A'))).toBe(false);
    gate.resolve();
    await Promise.all([pendingA, pendingB]);
    expect(calls).toBe(2);
    const previousB = framesB.length;
    await a.handle(envelope('private-C'));
    expect(framesA.some((wire) => wire.includes('private-C'))).toBe(true);
    expect(framesB).toHaveLength(previousB);
  } finally {
    gate.resolve();
    await Promise.allSettled([pendingA, pendingB]);
    a.dispose();
    b.dispose();
  }
});

test.each([
  'active',
  'late',
  'resubscribed',
] as const)('finished execution ownership closes before a wrapping handler settles, forwarding: %s', async (forwarding) => {
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: scriptedPlanner([buildGridResponse(), buildGridResponse()]),
  });
  const handle = engine.handle.bind(engine);
  let followup = false;
  const envelope = (intent: string) => {
    const value = makeGridRequest();
    return ChartRequestMessage({
      id: MessageId('collision'),
      sessionId: SessionId('authorized'),
      request: {
        ...value,
        context: {
          ...value.context,
          updateReasons: [{ type: 'user_intent', intent }],
        },
      },
    });
  };
  engine.handle = async (message, signal) => {
    const result = await handle(message, signal);
    if (!followup) {
      followup = true;
      if (forwarding !== 'active')
        await connection.handle(subscription('authorized', true, true));
      await handle(envelope('private-B'));
    }
    return result;
  };
  const frames: string[] = [];
  const connection = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (wire) => frames.push(wire),
  });
  try {
    if (forwarding !== 'late')
      await connection.handle(subscription('authorized', true, true));
    if (forwarding === 'resubscribed')
      await connection.handle(subscription('authorized', false));
    await connection.handle(envelope('private-A'));
    expect(followup).toBe(true);
    expect(frames.some((wire) => wire.includes('private-A'))).toBe(
      forwarding === 'active',
    );
    expect(frames.some((wire) => wire.includes('private-B'))).toBe(false);
  } finally {
    connection.dispose();
  }
});

test.each([
  'client.history.get',
  'assistant_message',
  'client.assistant_message.acknowledged',
] as const)('a pending %s cannot authorize chart diagnostic content', async (type) => {
  const emitter = new EngineDiagnosticEmitter();
  const gate = Promise.withResolvers<void>();
  let started = false;
  const engine: Engine = {
    openConnection: () => {
      throw new Error('unexpected streaming connection');
    },
    observeDiagnostics: (observer) => emitter.subscribe(observer),
    getHistory: async () => {
      started = true;
      await gate.promise;
      return ok([]);
    },
    handle: async (message) => {
      started = true;
      await gate.promise;
      return ok({
        type: 'assistant_message_result',
        sessionId: message.sessionId,
        id: message.id,
        outcome: 'inserted',
      });
    },
  };
  const frames: string[] = [];
  const connection = createDiagnosticConnection(engine, {
    enabled: true,
    sessionId: SessionId('authorized'),
    send: (wire) => frames.push(wire),
  });
  await connection.handle(subscription('authorized', true, true));
  const pending = connection.handle({
    type,
    id: MessageId('collision'),
    sessionId: SessionId('authorized'),
    timestamp: Date.now(),
    content: 'fixture',
  });
  let reads = 0;
  try {
    expect(started).toBe(true);
    emitter.emit(
      SessionId('authorized'),
      MessageId('collision'),
      'engine.planner.started',
      {},
      () => {
        reads++;
        return { text: 'private chart input' };
      },
    );
    expect(frames).toEqual([]);
    expect(reads).toBe(0);
  } finally {
    gate.resolve();
    await pending;
    connection.dispose();
  }
});
