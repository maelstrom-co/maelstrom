import { expect, test } from 'bun:test';
import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  type AgentUtteranceInput,
  ChangeId,
  type DiagnosticEvent,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import { install } from '@sinonjs/fake-timers';
import { createEngine } from '../../index.js';
import {
  buildGridResponse,
  makeGridRequest,
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

const utterance = (): AgentUtteranceInput => ({
  type: 'utterance',
  version: AGENT_WIRE_VERSION,
  inputId: MessageId('input-1'),
  text: 'Keep my calendar visible',
  source: 'text',
  chart: makeTilingRequest(),
});

test('a UI-only reply waits for its own applied acknowledgement before claiming completion', async () => {
  const events: AgentEvent[] = [];
  let now = 10;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      expect(events.map((event) => event.type)).toEqual([
        'placeholder',
        'accepted',
      ]);
      expect(input.request.context.updateReasons).toEqual([
        { type: 'user_intent', intent: 'Keep my calendar visible' },
      ]);
      expect(input.request.skipReply).not.toBe(true);
      now = 20;
      return ok({
        userMessage: 'Your calendar is visible.',
        rationale: 'Keep the requested Instance.',
        executionPlan: [],
        layout:
          input.request.layout.type === 'tiling'
            ? input.request.layout
            : { tree: [], instances: [] },
      });
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('session-1'),
    user: { id: 'private-user' },
    token: 'private-token',
    capabilities: [],
    clock: () => now,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  await connection.send(utterance());
  expect(events.map((event) => event.type)).toEqual([
    'placeholder',
    'accepted',
    'ui_change',
  ]);
  const accepted = events.find((event) => event.type === 'accepted');
  const change = events.find((event) => event.type === 'ui_change');
  if (!accepted?.runId || !change) throw new Error('Missing UI-only run');
  expect(accepted.disposition).toBe('ui_only');
  expect(change.runId).toBe(accepted.runId);
  now = 30;
  await connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart: utterance().chart,
    actionOutcomes: [],
  });
  expect(events.slice(3)).toEqual([
    {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId: accepted.runId,
      turnId: expect.any(String),
      delta: 'Your calendar is visible.',
    },
    {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId: accepted.runId,
      ok: true,
      reason: 'completed',
      reply: 'Your calendar is visible.',
      metrics: {
        turns: 0,
        toolCalls: 0,
        elapsedMs: 20,
        inputTokens: 0,
        outputTokens: 0,
      },
    },
  ]);
  expect(
    events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
  connection.close();
});

test('the placeholder reaches the browser before a slow Planner is called and never waits for it', async () => {
  const time = install({ toFake: ['setTimeout', 'clearTimeout'] });
  const events: AgentEvent[] = [];
  const plannerCalls: { at: number; seen: string[] }[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      plannerCalls.push({
        at: time.now,
        seen: events.map((event) => event.type),
      });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({
    sessionId: SessionId('slow-planner'),
    user: null,
    clock: () => time.now,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  try {
    let sent = false;
    const sending = connection.send(utterance()).then(() => {
      sent = true;
    });
    await time.tickAsync(0);
    expect(events.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
    ]);
    expect(plannerCalls).toEqual([
      { at: 0, seen: ['placeholder', 'accepted'] },
    ]);
    await time.tickAsync(4_999);
    expect(events.some((event) => event.type === 'ui_change')).toBe(false);
    expect(sent).toBe(false);
    await time.tickAsync(1);
    expect(events.at(-1)?.type).toBe('ui_change');
    await sending;
    expect(sent).toBe(true);
  } finally {
    connection.close();
    time.uninstall();
  }
});

test('a repeated input never repeats its layout or spends another Planner call', async () => {
  const events: AgentEvent[] = [];
  let plans = 0;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      plans++;
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('dedup'),
    user: null,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  const original = connection.send(utterance());
  await connection.send(utterance());
  await original;
  expect(events.map((event) => event.type)).toEqual([
    'placeholder',
    'accepted',
    'ui_change',
  ]);
  const change = events.find((event) => event.type === 'ui_change');
  if (!change) throw new Error('Missing change');
  await connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart: utterance().chart,
    actionOutcomes: [],
  });
  await connection.send(utterance());
  expect(plans).toBe(1);
  expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
  connection.close();
});

test('invalid input and an unknown acknowledgement report their correlation without invoking the Planner', async () => {
  const events: AgentEvent[] = [];
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      throw new Error('The Planner must not receive invalid input');
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('invalid'),
    user: null,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  await connection.send({
    type: 'unknown',
    version: AGENT_WIRE_VERSION,
    inputId: 'bad-input',
  });
  await connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: 'unknown-change',
    chart: utterance().chart,
    actionOutcomes: [],
  });
  expect(events).toEqual([
    {
      type: 'error',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId('bad-input'),
      code: 'invalid_input',
      error: 'Invalid Agent Session input.',
    },
    {
      type: 'error',
      version: AGENT_WIRE_VERSION,
      changeId: ChangeId('unknown-change'),
      code: 'unknown_change',
      error: 'Unknown UI change.',
    },
  ]);
  connection.close();
});

test('closing a connection aborts its Planner and never emits its late result', async () => {
  const events: AgentEvent[] = [];
  const gate = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (_input, context) => {
      signal = context.signal;
      await gate.promise;
      return ok({
        userMessage: 'Late.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('closed'),
    user: null,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  const sent = connection.send(utterance());
  await Promise.resolve();
  connection.close();
  connection.close();
  await sent;
  gate.resolve();
  await connection.send(utterance());
  expect(signal?.aborted).toBe(true);
  expect(events.map((event) => event.type)).toEqual([
    'placeholder',
    'accepted',
  ]);
});

test('a failed Planner ends its run once without exposing provider errors or private identity', async () => {
  const events: AgentEvent[] = [];
  let plannerInput: unknown;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      plannerInput = input;
      throw new Error('private-provider-secret');
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('failure'),
    user: { id: 'private-user' },
    token: 'private-token',
    clock: () => 10,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  await connection.send(utterance());
  const finished = events.filter((event) => event.type === 'finished');
  expect(finished).toHaveLength(1);
  expect(finished[0]).toMatchObject({
    ok: false,
    reason: 'error',
    reply: '',
    error: 'The UI request failed.',
  });
  expect(events.some((event) => event.type === 'ui_change')).toBe(false);
  expect(JSON.stringify(events)).not.toContain('private-provider-secret');
  expect(JSON.stringify(plannerInput)).not.toContain('private-user');
  expect(JSON.stringify(plannerInput)).not.toContain('private-token');
  connection.close();
});

test('queued utterances plan against the acknowledged Chart rather than an earlier in-flight snapshot', async () => {
  const events: AgentEvent[] = [];
  const planned: unknown[] = [];
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      planned.push(input.request.layout);
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('queue'),
    user: null,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  await connection.send(utterance());
  const change = events.find((event) => event.type === 'ui_change');
  if (!change) throw new Error('Missing change');
  const second = connection.send({
    ...utterance(),
    inputId: MessageId('input-2'),
    text: 'Keep the Chart empty',
  });
  await Promise.resolve();
  expect(planned).toHaveLength(1);
  const acknowledged = makeTilingRequest({
    instances: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  });
  await connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart: acknowledged,
    actionOutcomes: [],
  });
  await second;
  expect(planned[1]).toEqual({ type: 'tiling', tree: [], instances: [] });
  expect(events.filter((event) => event.type === 'ui_change')).toHaveLength(2);
  connection.close();
});

test('a queued utterance plans against its own newer Chart when the run before it fails during planning', async () => {
  const planned: unknown[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      planned.push(input.request.layout);
      if (planned.length === 1) throw new Error('provider unavailable');
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({ sessionId: SessionId('failed-planning'), user: null });
  try {
    const failing = connection.send(utterance());
    const newer = connection.send({
      ...utterance(),
      inputId: MessageId('newer'),
      chart: makeTilingRequest({
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      }),
    });
    await failing;
    await newer;
    expect(planned[1]).toEqual({ type: 'tiling', tree: [], instances: [] });
  } finally {
    connection.close();
  }
});

test('a run that fails during planning leaves later queued utterances on the acknowledged Chart', async () => {
  const planned: unknown[] = [];
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      planned.push(input.request.layout);
      if (planned.length === 2) throw new Error('provider unavailable');
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({ sessionId: SessionId('failed-after-ack'), user: null });
  connection.subscribe((event) => {
    events.push(event);
  });
  try {
    await connection.send(utterance());
    const change = events.find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing change');
    const failing = connection.send({
      ...utterance(),
      inputId: MessageId('failing'),
    });
    const later = connection.send({
      ...utterance(),
      inputId: MessageId('later'),
    });
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart: makeTilingRequest({
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      }),
      actionOutcomes: [],
    });
    await failing;
    await later;
    expect(planned.slice(1)).toEqual([
      { type: 'tiling', tree: [], instances: [] },
      { type: 'tiling', tree: [], instances: [] },
    ]);
  } finally {
    connection.close();
  }
});

test('a missing or failed Action outcome cannot turn a UI change into a successful reply', async () => {
  const events: AgentEvent[] = [];
  const chart = makeGridRequest();
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok(
        buildGridResponse({
          executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
        }),
      ),
  }).openConnection({ sessionId: SessionId('apply-failure'), user: null });
  connection.subscribe((event) => {
    events.push(event);
  });
  await connection.send({ ...utterance(), chart });
  const change = events.find((event) => event.type === 'ui_change');
  if (!change) throw new Error('Missing change');
  await connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart,
    actionOutcomes: [],
  });
  expect(events.at(-1)).toMatchObject({
    type: 'error',
    changeId: change.changeId,
    code: 'invalid_action_outcomes',
  });
  expect(events.some((event) => event.type === 'finished')).toBe(false);
  await connection.send({
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: change.changeId,
    chart,
    actionOutcomes: [{ ok: false, error: 'untrusted-error-content' }],
  });
  expect(events.at(-1)).toMatchObject({
    type: 'finished',
    runId: change.runId,
    ok: false,
    reason: 'error',
    code: 'ui_apply_failed',
  });
  expect(events.some((event) => event.type === 'message')).toBe(false);
  expect(JSON.stringify(events)).not.toContain('untrusted-error-content');
  connection.close();
});

test('an unacknowledged change times out once and releases the connection instead of waiting without a bound', async () => {
  const time = install({ toFake: ['setTimeout', 'clearTimeout'] });
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  }).openConnection({
    sessionId: SessionId('timeout'),
    user: null,
    clock: () => time.now,
    acknowledgementTimeoutMs: 100,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  try {
    await connection.send(utterance());
    await time.tickAsync(99);
    expect(events.some((event) => event.type === 'finished')).toBe(false);
    await time.tickAsync(1);
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      reason: 'error',
      ok: false,
      code: 'ui_ack_timeout',
      metrics: { elapsedMs: 100 },
    });
    await time.tickAsync(100);
    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
    expect(time.countTimers()).toBe(0);
  } finally {
    connection.close();
    time.uninstall();
  }
});

test('a client that does not acknowledge cannot grow an unbounded queue of paid Planner work', async () => {
  const events: AgentEvent[] = [];
  let plans = 0;
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      plans++;
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({ sessionId: SessionId('bounded'), user: null });
  connection.subscribe((event) => {
    events.push(event);
  });
  const sends: Promise<void>[] = [];
  try {
    await connection.send(utterance());
    for (let index = 2; index <= 33; index++)
      sends.push(
        connection.send({
          ...utterance(),
          inputId: MessageId(`input-${index}`),
        }),
      );
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      inputId: 'input-33',
      code: 'queue_full',
    });
    expect(events.filter((event) => event.type === 'accepted')).toHaveLength(
      32,
    );
    expect(plans).toBe(1);
  } finally {
    connection.close();
    await Promise.all(sends);
  }
});

test('a throwing observer cannot strand a run or change event order for other observers', async () => {
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  }).openConnection({ sessionId: SessionId('observer'), user: null });
  const events: AgentEvent[] = [];
  connection.subscribe(() => {
    throw new Error('observer failure');
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  try {
    await connection.send(utterance());
    const change = events.find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing change');
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart: utterance().chart,
      actionOutcomes: [],
    });
    expect(events.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'ui_change',
      'message',
      'finished',
    ]);
  } finally {
    connection.close();
  }
});

test('observer-triggered inputs and acknowledgements keep one event order and reserve admission before callbacks', async () => {
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  }).openConnection({ sessionId: SessionId('reentrant'), user: null });
  const observed: string[][] = [[], []];
  const sends: Promise<void>[] = [];
  connection.subscribe((event) => {
    observed[0].push(event.type);
    if (event.type === 'placeholder' && event.inputId === 'input-1')
      sends.push(
        connection.send({ ...utterance(), inputId: MessageId('input-2') }),
      );
    if (event.type === 'ui_change')
      sends.push(
        connection.send({
          type: 'ui_applied',
          version: AGENT_WIRE_VERSION,
          changeId: event.changeId,
          chart: utterance().chart,
          actionOutcomes: [],
        }),
      );
  });
  connection.subscribe((event) => {
    observed[1].push(event.type);
  });
  try {
    await connection.send(utterance());
    await Promise.all(sends);
    expect(observed[1]).toEqual([
      'placeholder',
      'accepted',
      'placeholder',
      'accepted',
      'ui_change',
      'message',
      'finished',
      'ui_change',
      'message',
      'finished',
    ]);
    expect(observed[0]).toEqual(observed[1]);
  } finally {
    connection.close();
  }
});

test('an unexpected planning-pipeline rejection finishes the run and releases its send promise', async () => {
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: {
      ...silentLogger,
      debug: () => {
        throw new Error('private-pipeline-failure');
      },
    },
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  }).openConnection({ sessionId: SessionId('pipeline-rejection'), user: null });
  connection.subscribe((event) => {
    events.push(event);
  });
  try {
    await connection.send(utterance());
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      ok: false,
      reason: 'error',
      code: 'internal_error',
    });
    expect(JSON.stringify(events)).not.toContain('private-pipeline-failure');
  } finally {
    connection.close();
  }
}, 1000);

test('server-minted run diagnostics remain isolated when two connections reuse a session and input id', async () => {
  const diagnostics: DiagnosticEvent[] = [];
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  });
  engine.observeDiagnostics?.((event) => {
    diagnostics.push(event);
  });
  const first = engine.openConnection({
    sessionId: SessionId('shared'),
    user: { id: 'user-a' },
    token: 'private-token',
  });
  const second = engine.openConnection({
    sessionId: SessionId('shared'),
    user: { id: 'user-b' },
  });
  const changes: AgentEvent[] = [];
  first.subscribe((event) => {
    changes.push(event);
  });
  second.subscribe((event) => {
    changes.push(event);
  });
  try {
    await Promise.all([first.send(utterance()), second.send(utterance())]);
    const runs: (string | null)[] = changes
      .filter((event) => event.type === 'accepted')
      .map((event) => event.runId);
    expect(new Set(runs).size).toBe(2);
    expect(
      diagnostics
        .filter((event) => event.kind === 'engine.planner.started')
        .map((event) => event.runId ?? null)
        .sort(),
    ).toEqual([...runs].sort());
    expect(
      new Set(
        diagnostics
          .map((event) => event.kind)
          .filter((kind) => kind.startsWith('engine.agent.')),
      ),
    ).toEqual(
      new Set([
        'engine.agent.input.accepted',
        'engine.agent.ui_change.emitted',
      ]),
    );
    expect(
      diagnostics.every(
        (event) =>
          !event.requestId &&
          runs.includes(event.runId ?? null) &&
          event.metadata.inputId === 'input-1',
      ),
    ).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain('private-token');
    expect(JSON.stringify(diagnostics)).not.toContain('user-a');
  } finally {
    first.close();
    second.close();
  }
});

test('run diagnostics describe acknowledgement and termination without publishing the product stream as content', async () => {
  const diagnostics: DiagnosticEvent[] = [];
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  });
  engine.observeDiagnostics?.((event) => {
    diagnostics.push(event);
  });
  const connection = engine.openConnection({
    sessionId: SessionId('lifecycle'),
    user: null,
  });
  let change: Extract<AgentEvent, { type: 'ui_change' }> | undefined;
  connection.subscribe((event) => {
    if (event.type === 'ui_change') change = event;
  });
  try {
    await connection.send(utterance());
    if (!change) throw new Error('Missing UI change');
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart: utterance().chart,
      actionOutcomes: [],
    });
    expect(diagnostics.map((event) => event.kind)).toContain(
      'engine.agent.ui_change.applied',
    );
    expect(diagnostics.at(-1)).toMatchObject({
      kind: 'engine.agent.run.finished',
      runId: change.runId,
      metadata: { reason: 'completed', outcome: 'succeeded' },
    });
    expect(diagnostics.every((event) => event.content === undefined)).toBe(
      true,
    );
  } finally {
    connection.close();
  }
});

test('host debug logs follow the event stream with correlation fields only and stop at close', async () => {
  const logs: { message: string; data?: Record<string, unknown> }[] = [];
  const gate = Promise.withResolvers<void>();
  let plans = 0;
  const connection = createEngine({
    logger: {
      ...silentLogger,
      debug: (message, data) => {
        logs.push({ message, data });
      },
    },
    retry: false,
    planner: async () => {
      if (++plans > 1) await gate.promise;
      return ok({
        userMessage: 'Your private calendar is visible.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({
    sessionId: SessionId('logged'),
    user: { id: 'private-user' },
    token: 'private-token',
  });
  let change: Extract<AgentEvent, { type: 'ui_change' }> | undefined;
  connection.subscribe((event) => {
    if (event.type === 'ui_change') change = event;
  });
  const agentLogs = () =>
    logs.filter((entry) => entry.message.startsWith('agent.'));
  try {
    await connection.send(utterance());
    if (!change) throw new Error('Missing UI change');
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart: utterance().chart,
      actionOutcomes: [],
    });
    expect(agentLogs().map((entry) => entry.message)).toEqual([
      'agent.placeholder',
      'agent.accepted',
      'agent.ui_change',
      'agent.message',
      'agent.finished',
    ]);
    expect(agentLogs().map((entry) => entry.data)).toEqual([
      { sessionId: 'logged', inputId: 'input-1' },
      {
        sessionId: 'logged',
        inputId: 'input-1',
        runId: change.runId,
        disposition: 'ui_only',
      },
      { sessionId: 'logged', runId: change.runId, changeId: change.changeId },
      { sessionId: 'logged', runId: change.runId },
      {
        sessionId: 'logged',
        runId: change.runId,
        ok: true,
        reason: 'completed',
      },
    ]);
    const logged = JSON.stringify(logs.map((entry) => entry.data));
    for (const secret of [
      'Keep my calendar visible',
      'Your private calendar is visible.',
      'private-user',
      'private-token',
    ])
      expect(logged).not.toContain(secret);

    const pending = connection.send({
      ...utterance(),
      inputId: MessageId('input-2'),
    });
    expect(agentLogs()).toHaveLength(7);
    connection.close();
    gate.resolve();
    await pending;
    await connection.send({ ...utterance(), inputId: MessageId('input-3') });
    expect(agentLogs()).toHaveLength(7);
  } finally {
    connection.close();
  }
});

test('closing from a placeholder observer releases admission without starting paid work or notifying later listeners', async () => {
  let plans = 0;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      plans++;
      throw new Error('must not plan');
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('close-observer'),
    user: null,
  });
  const events: AgentEvent[] = [];
  connection.subscribe(() => {
    connection.close();
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  await connection.send(utterance());
  expect(plans).toBe(0);
  expect(events).toEqual([]);
});

test('diagnostic observers cannot put another input ahead of the input being accepted', async () => {
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      throw new Error('provider unavailable');
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('diagnostic-reentrancy'),
    user: null,
  });
  const inputs: string[] = [];
  let nested: Promise<void> | undefined;
  connection.subscribe((event) => {
    if (event.type === 'placeholder') inputs.push(event.inputId);
  });
  engine.observeDiagnostics?.((event) => {
    if (
      event.kind === 'engine.agent.input.accepted' &&
      event.metadata.inputId === 'input-1'
    )
      nested = connection.send({
        ...utterance(),
        inputId: MessageId('input-2'),
      });
  });
  try {
    await connection.send(utterance());
    await nested;
    expect(inputs).toEqual(['input-1', 'input-2']);
  } finally {
    connection.close();
  }
});

test('a timeout cancels queued work, and the next input uses a fresh Chart instead of the uncertain one', async () => {
  const time = install({ toFake: ['setTimeout', 'clearTimeout'] });
  const planned: unknown[] = [];
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      planned.push(input.request.layout);
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({
    sessionId: SessionId('recover-timeout'),
    user: null,
    acknowledgementTimeoutMs: 100,
  });
  connection.subscribe((event) => {
    events.push(event);
  });
  try {
    await connection.send(utterance());
    const queued = connection.send({
      ...utterance(),
      inputId: MessageId('queued'),
    });
    await time.tickAsync(100);
    await queued;
    expect(
      events
        .filter((event) => event.type === 'finished')
        .map((event) => event.reason),
    ).toEqual(['error', 'cancelled']);
    expect(planned).toHaveLength(1);
    await connection.send({
      ...utterance(),
      inputId: MessageId('fresh'),
      chart: makeTilingRequest({
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      }),
    });
    expect(planned[1]).toEqual({ type: 'tiling', tree: [], instances: [] });
  } finally {
    connection.close();
    expect(time.countTimers()).toBe(0);
    time.uninstall();
  }
});

test('the input-id bound rejects new work without forgetting an old input that could repeat effects', async () => {
  let plans = 0;
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      plans++;
      throw new Error('provider unavailable');
    },
  }).openConnection({ sessionId: SessionId('seen-capacity'), user: null });
  connection.subscribe((event) => {
    if (event.type === 'error') events.push(event);
  });
  try {
    for (let index = 0; index < 4096; index++)
      await connection.send({
        ...utterance(),
        inputId: MessageId(`remember-${index}`),
      });
    await connection.send({
      ...utterance(),
      inputId: MessageId('remember-4096'),
    });
    await connection.send({ ...utterance(), inputId: MessageId('remember-0') });
    expect(events).toMatchObject([
      { type: 'error', code: 'session_capacity', inputId: 'remember-4096' },
    ]);
    expect(plans).toBe(4096);
  } finally {
    connection.close();
  }
});

test('an acknowledgement repeated from the run it finishes is unknown and cannot finish that run twice', async () => {
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () =>
      ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      }),
  }).openConnection({ sessionId: SessionId('repeated-ack'), user: null });
  let change: Extract<AgentEvent, { type: 'ui_change' }> | undefined;
  const repeats: Promise<void>[] = [];
  const acknowledge = (changeId: ChangeId) =>
    connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId,
      chart: utterance().chart,
      actionOutcomes: [],
    });
  connection.subscribe((event) => {
    events.push(event);
    if (event.type === 'ui_change') change = event;
    if (event.type === 'message' && change)
      repeats.push(acknowledge(change.changeId));
  });
  try {
    await connection.send(utterance());
    if (!change) throw new Error('Missing change');
    await acknowledge(change.changeId);
    await Promise.all(repeats);
    expect(events.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'ui_change',
      'message',
      'finished',
      'error',
    ]);
    expect(events.at(-1)).toMatchObject({
      changeId: change.changeId,
      code: 'unknown_change',
    });
  } finally {
    connection.close();
  }
});

test('an utterance sent while a timed-out run finishes is not cancelled with the queued work', async () => {
  const time = install({ toFake: ['setTimeout', 'clearTimeout'] });
  const planned: unknown[] = [];
  const events: AgentEvent[] = [];
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      planned.push(input.request.layout);
      return ok({
        userMessage: 'Done.',
        rationale: '',
        executionPlan: [],
        layout: { tree: [], instances: [] },
      });
    },
  }).openConnection({
    sessionId: SessionId('retry-after-timeout'),
    user: null,
    acknowledgementTimeoutMs: 100,
  });
  let retry: Promise<void> | undefined;
  connection.subscribe((event) => {
    events.push(event);
    if (event.type === 'finished' && !retry)
      retry = connection.send({
        ...utterance(),
        inputId: MessageId('retry'),
        chart: makeTilingRequest({
          instances: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        }),
      });
  });
  try {
    await connection.send(utterance());
    const queued = connection.send({
      ...utterance(),
      inputId: MessageId('queued'),
    });
    await time.tickAsync(100);
    await queued;
    await retry;
    const retried = events.find(
      (event) => event.type === 'accepted' && event.inputId === 'retry',
    );
    expect(
      events
        .filter((event) => event.type === 'finished')
        .map((event) => event.reason),
    ).toEqual(['error', 'cancelled']);
    expect(events.at(-1)).toMatchObject({
      type: 'ui_change',
      runId: retried?.runId,
    });
    expect(planned[1]).toEqual({ type: 'tiling', tree: [], instances: [] });
  } finally {
    connection.close();
    time.uninstall();
  }
});
