import { expect, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type ChartRequest,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import { createEngine } from '../../index.js';
import {
  buildGridResponse,
  makeGridRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

test.each([false, true])(
  'Layout refusal cannot claim success even with no Action evidence (has Actions: %s)',
  async (hasActions) => {
    const events: AgentEvent[] = [];
    const chart = makeGridRequest();
    const connection = createEngine({
      logger: silentLogger,
      retry: false,
      planner: async () =>
        ok(
          buildGridResponse({
            executionPlan: hasActions
              ? [{ instanceId: 'calendar-main', action: 'showWeek' }]
              : [],
          }),
        ),
    }).openConnection({ sessionId: SessionId('layout-refusal'), user: null });
    connection.subscribe((event) => events.push(event));
    try {
      await connection.send({
        type: 'utterance',
        version: AGENT_WIRE_VERSION,
        inputId: MessageId('refused'),
        text: 'Show my calendar',
        source: 'text',
        chart,
      });
      const change = events.find((event) => event.type === 'ui_change');
      if (!change) throw new Error('Missing UI change');
      await connection.send({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        status: 'failed',
        chart,
        actionOutcomes: [],
      });
      expect(events.at(-1)).toMatchObject({
        type: 'finished',
        runId: change.runId,
        ok: false,
        reason: 'error',
        code: 'ui_apply_failed',
        reply: '',
      });
      expect(events.some((event) => event.type === 'message')).toBe(false);
    } finally {
      connection.close();
    }
  },
);

test.each([
  { status: 'applied', actionOutcomes: [] },
  { status: 'applied', actionOutcomes: [{ ok: true }, { ok: true }] },
  { status: 'unknown', actionOutcomes: [{ ok: true }, { ok: true }] },
])(
  'invalid Action evidence cannot finish the run or release queued work (%j)',
  async (evidence) => {
    const events: AgentEvent[] = [];
    const chart = makeGridRequest();
    let plans = 0;
    const connection = createEngine({
      logger: silentLogger,
      retry: false,
      planner: async () => {
        plans++;
        return ok(
          buildGridResponse({
            executionPlan: [
              { instanceId: 'calendar-main', action: 'showWeek' },
            ],
          }),
        );
      },
    }).openConnection({ sessionId: SessionId('invalid-evidence'), user: null });
    const submit = (inputId: string) =>
      connection.send({
        type: 'utterance',
        version: AGENT_WIRE_VERSION,
        inputId: MessageId(inputId),
        text: 'Show my calendar',
        source: 'text',
        chart,
      });
    let queued: Promise<void> | undefined;
    connection.subscribe((event) => events.push(event));
    try {
      await submit('active');
      const change = events.find((event) => event.type === 'ui_change');
      if (!change) throw new Error('Missing UI change');
      expect(change.response.executionPlan).toHaveLength(1);
      queued = submit('queued');
      await connection.send({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        ...evidence,
      });
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'invalid_action_outcomes',
      });
      expect(events.filter((event) => event.type === 'finished')).toEqual([]);
      expect(plans).toBe(1);
      await connection.send({
        type: 'ui_applied',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        chart,
        status: 'unknown',
        actionOutcomes: [],
      });
      await queued;
      expect(events.filter((event) => event.type === 'finished')).toMatchObject(
        [
          { reason: 'error', code: 'ui_apply_unknown' },
          { reason: 'cancelled', code: 'ui_apply_unknown' },
        ],
      );
      expect(plans).toBe(1);
    } finally {
      connection.close();
      await queued;
    }
  },
);

test('successful Action outcomes cannot override unknown whole-batch evidence', async () => {
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
  }).openConnection({ sessionId: SessionId('unknown-batch'), user: null });
  connection.subscribe((event) => events.push(event));
  try {
    await connection.send({
      type: 'utterance',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId('active'),
      text: 'Show my calendar',
      source: 'text',
      chart,
    });
    const change = events.find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing UI change');
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      chart,
      status: 'unknown',
      actionOutcomes: [{ ok: true }],
    });
    expect(events.at(-1)).toMatchObject({
      type: 'finished',
      ok: false,
      code: 'ui_apply_unknown',
      reply: '',
    });
    expect(events.filter((event) => event.type === 'message')).toEqual([]);
  } finally {
    connection.close();
  }
});

test('known Layout refusal releases FIFO work using the acknowledged Chart, then accepts a fresh client snapshot', async () => {
  const events: AgentEvent[] = [];
  const planned: ChartRequest[] = [];
  const chart = makeGridRequest();
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async (input) => {
      planned.push(input.request);
      return ok(buildGridResponse({ executionPlan: [] }));
    },
  }).openConnection({
    sessionId: SessionId('refusal-continuation'),
    user: null,
  });
  connection.subscribe((event) => events.push(event));
  const submit = (inputId: string, snapshot = chart) =>
    connection.send({
      type: 'utterance',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId(inputId),
      text: inputId,
      source: 'text',
      chart: snapshot,
    });
  const acknowledge = (
    status: 'failed' | 'applied',
    snapshot: ChartRequest,
  ) => {
    const change = events.filter((event) => event.type === 'ui_change').at(-1);
    if (!change) throw new Error('Missing UI change');
    return connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      status,
      chart: snapshot,
      actionOutcomes: [],
    });
  };
  const pending: Promise<void>[] = [];
  try {
    await submit('refused');
    pending.push(submit('queued-1'), submit('queued-2'));
    const observed = makeGridRequest({
      layout: { type: 'grid', positions: [] },
    });
    await acknowledge('failed', observed);
    await pending[0];
    expect(planned[1]).toMatchObject({
      layout: observed.layout,
      context: { updateReasons: [{ type: 'user_intent', intent: 'queued-1' }] },
    });
    await acknowledge('applied', chart);
    await pending[1];
    expect(planned[2]).toMatchObject({
      layout: chart.layout,
      context: { updateReasons: [{ type: 'user_intent', intent: 'queued-2' }] },
    });
    await acknowledge('applied', chart);
    await submit('fresh', observed);
    expect(planned[3]?.layout).toEqual(observed.layout);
    await acknowledge('applied', observed);
    expect(events.filter((event) => event.type === 'finished')).toMatchObject([
      { ok: false, code: 'ui_apply_failed' },
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
  } finally {
    connection.close();
    await Promise.all(pending);
  }
});

test('partial application stops queued and reentrant work, and late success cannot reopen the connection', async () => {
  const events: AgentEvent[] = [];
  const chart = makeGridRequest();
  let plans = 0;
  const connection = createEngine({
    logger: silentLogger,
    retry: false,
    planner: async () => {
      plans++;
      return ok(
        buildGridResponse({
          executionPlan: [
            { instanceId: 'calendar-main', action: 'showWeek' },
            { instanceId: 'calendar-main', action: 'showMonth' },
          ],
        }),
      );
    },
  }).openConnection({
    sessionId: SessionId('partial-application'),
    user: null,
  });
  const submit = (inputId: string) =>
    connection.send({
      type: 'utterance',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId(inputId),
      text: 'Show my calendar',
      source: 'text',
      chart,
    });
  let reentrant: Promise<void> | undefined;
  connection.subscribe((event) => {
    events.push(event);
    if (event.type === 'finished' && event.code === 'ui_apply_unknown')
      reentrant = submit('from-finished');
  });
  const pending: Promise<void>[] = [];
  try {
    await submit('partial');
    const change = events.find((event) => event.type === 'ui_change');
    if (!change) throw new Error('Missing UI change');
    expect(change.response.executionPlan).toHaveLength(2);
    pending.push(submit('queued-1'), submit('queued-2'));
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      status: 'unknown',
      chart,
      actionOutcomes: [{ ok: true }],
    });
    expect(events.filter((event) => event.type === 'finished')).toMatchObject([
      {
        runId: change.runId,
        reason: 'error',
        code: 'ui_apply_unknown',
        reply: '',
      },
      { reason: 'cancelled', code: 'ui_apply_unknown' },
      { reason: 'cancelled', code: 'ui_apply_unknown' },
    ]);
    await Promise.all(pending);
    await reentrant;
    await connection.send({
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: change.changeId,
      status: 'applied',
      chart,
      actionOutcomes: [{ ok: true }, { ok: true }],
    });
    await submit('after-late-success');
    expect(plans).toBe(1);
    expect(events.filter((event) => event.type === 'accepted')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'message')).toEqual([]);
    expect(events.filter((event) => event.type === 'error')).toMatchObject([
      { inputId: 'from-finished', code: 'session_stopped' },
      { changeId: change.changeId, code: 'unknown_change' },
      { inputId: 'after-late-success', code: 'session_stopped' },
    ]);
  } finally {
    connection.close();
    await Promise.all(pending);
  }
});
