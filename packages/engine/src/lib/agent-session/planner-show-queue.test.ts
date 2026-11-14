import { describe, expect, test } from 'bun:test';

import {
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentActionOutcome,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  ChangeId,
  type ChartRequest,
  type DiagnosticMetadata,
  err,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
  type Result,
  RunId,
} from '@maelstrom-co/protocol';

import { defer, type Deferred } from '../__test-helpers__/defer.js';
import { makeGridRequest } from '../__test-helpers__/fixtures.js';
import { type EngineError, providerError } from '../errors.js';
import type { Logger } from '../logger.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import { createOrderedEmitter } from './ordered-emitter.js';
import {
  createPlannerShowQueue,
  type LoopDrivenPlanOutcome,
  type LoopDrivenShow,
  type ShowPlanInput,
  SHOW_PLANNING_TIMEOUT_MS,
} from './planner-show-queue.js';
import { describeScreenUpdate } from './screen-note.js';
import { buildShowRequest } from './show-request.js';

const ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;
const PROSE_SENTINEL = 'PLANNER PROSE SENTINEL';
const ERROR_SENTINEL = 'PLANNER ERROR SENTINEL';
const QUESTION_SENTINEL = 'PLANNER QUESTION SENTINEL';

const monthChart = makeGridRequest();
const weekChart = calendarChart('week');
const dayChart = calendarChart('day');

describe('createPlannerShowQueue', () => {
  test('starts planning at once on the latest Chart with fresh ids', () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);

    harness.queue.request(show(1));

    expect(harness.planner.calls).toHaveLength(1);
    const input = harness.planner.input(0);
    expect(input.request).toEqual(
      buildShowRequest(monthChart, show(1).intent, show(1).intentFacts),
    );
    expect(input.runId).toBe(show(1).runId);
    expect(input.inputId).toBe(show(1).inputId);
    expect(input.turnId).toBe(show(1).turnId);
    expect(input.messageId).not.toBe(show(1).inputId);
    expect(input.signal.aborted).toBe(false);
  });

  test('emits the planned change with its run id and change id', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));

    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    expect(change).toEqual({
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId: show(1).runId,
      changeId: change.changeId,
      response: changeResponse(monthChart),
    });
    expect(change.changeId.length).toBeGreaterThan(0);
  });

  test('plans the next show only after the matching acknowledgement, on the acknowledged Chart', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));

    expect(harness.planner.calls).toHaveLength(1);
    harness.planner.respond(0, changeResponse(monthChart));
    const first = await harness.nextUiChange();
    expect(harness.planner.calls).toHaveLength(1);

    harness.queue.acknowledge(
      applied(first.changeId, weekChart, [{ ok: true }]),
    );

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).request).toEqual(
      buildShowRequest(weekChart, show(2).intent, show(2).intentFacts),
    );
    harness.planner.respond(1, changeResponse(weekChart));
    const second = await harness.nextUiChange();
    expect(second.runId).toBe(show(2).runId);
    expect(second.changeId).not.toBe(first.changeId);
  });

  test('mints a distinct change id and message id per show when planning starts', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    harness.planner.respond(0, changeResponse(monthChart));
    const first = await harness.nextUiChange();
    harness.queue.acknowledge(
      applied(first.changeId, weekChart, [{ ok: true }]),
    );
    harness.planner.respond(1, changeResponse(weekChart));
    const second = await harness.nextUiChange();

    expect(harness.planner.input(0).messageId).not.toBe(
      harness.planner.input(1).messageId,
    );
    expect(new Set([first.changeId, second.changeId]).size).toBe(2);
  });

  test('accepts an acknowledgement sent synchronously from inside the ui_change listener', async () => {
    const harness = createHarness();
    harness.events.subscribe((event) => {
      if (event.type === 'ui_change' && event.runId === show(1).runId)
        harness.queue.acknowledge(
          applied(event.changeId, weekChart, [{ ok: true }]),
        );
    });
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));

    harness.planner.respond(0, changeResponse(monthChart));
    await harness.planner.nextCall();

    expect(harness.errors()).toEqual([]);
    expect(harness.notes).toHaveLength(1);
    expect(harness.planner.input(1).request.instances).toEqual(
      weekChart.instances,
    );
  });

  test('refuses an acknowledgement of an unknown change and keeps the change pending', async () => {
    const harness = createHarness();
    harness.queue.acknowledge(
      applied(ChangeId('nothing-pending'), weekChart, []),
    );
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.acknowledge(
      applied(ChangeId('stale-change'), weekChart, [{ ok: true }]),
    );

    expect(harness.errors()).toEqual([
      unknownChangeError('nothing-pending'),
      unknownChangeError('stale-change'),
    ]);
    expect(harness.notes).toEqual([]);
    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    expect(harness.notes).toHaveLength(1);
  });

  test('refuses a wrong outcome count while the change stays pending until a valid acknowledgement', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.acknowledge(applied(change.changeId, weekChart, []));

    expect(harness.errors()).toEqual([
      {
        type: 'error',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        code: 'invalid_action_outcomes',
        error: 'Expected one outcome per Action.',
      },
    ]);
    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.time.pending()).toBe(1);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    expect(harness.errors()).toHaveLength(1);
    expect(harness.notes).toHaveLength(1);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('records the screen note of a valid acknowledgement for the run and turn that asked for the show', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    const response = changeResponse(monthChart, 2);
    harness.planner.respond(0, response);
    const change = await harness.nextUiChange();
    const outcomes: AgentActionOutcome[] = [
      { ok: true },
      { ok: false, error: 'browser failure detail' },
    ];

    harness.queue.acknowledge(applied(change.changeId, weekChart, outcomes));

    const text = describeScreenUpdate({
      executionPlan: response.executionPlan,
      actionOutcomes: outcomes,
      chart: weekChart,
    });
    expect(harness.notes).toEqual([
      { runId: show(1).runId, turnId: show(1).turnId, text },
    ]);
    expect(text).toStartWith('Screen updated: ran showWeek on calendar → week');
    expect(harness.time.pending()).toBe(0);
  });

  test('reports an acknowledgement timeout with an error event, a not-confirmed note and a diagnostic, then plans the next show on the last known Chart', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();
    expect(harness.time.scheduled()).toEqual([
      SHOW_PLANNING_TIMEOUT_MS,
      ACKNOWLEDGEMENT_TIMEOUT_MS,
    ]);

    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS - 1);
    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.errors()).toEqual([]);
    harness.time.advance(1);

    expect(harness.errors()).toEqual([
      {
        type: 'error',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        runId: show(1).runId,
        code: 'ui_ack_timeout',
        error: 'The UI acknowledgement did not arrive.',
      },
    ]);
    expect(harness.notes).toEqual([
      {
        runId: show(1).runId,
        turnId: show(1).turnId,
        text: 'Show not confirmed: the screen did not acknowledge the latest_order change.',
      },
    ]);
    expect(
      harness.observed.map(({ kind, metadata }) => ({ kind, metadata })),
    ).toEqual([
      expect.objectContaining({ kind: 'engine.agent.ui_change.emitted' }),
      {
        kind: 'engine.agent.ui_change.timed_out',
        metadata: { changeId: change.changeId, turnId: show(1).turnId },
      },
    ]);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).request).toEqual(
      buildShowRequest(monthChart, show(2).intent, show(2).intentFacts),
    );

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    expect(harness.errors().slice(1)).toEqual([
      unknownChangeError(change.changeId),
    ]);
    expect(harness.notes).toHaveLength(1);
  });

  test('ignores a Chart noted while a change awaits acknowledgement', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();

    harness.queue.noteChart(dayChart);
    harness.queue.request(show(2));
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(harness.planner.input(1).request.instances).toEqual(
      monthChart.instances,
    );
  });

  test('plans a show in planning again on a newer Chart that changes its request, with fresh ids', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    const first = harness.planner.input(0);

    harness.queue.noteChart(weekChart);

    expect(first.signal.aborted).toBe(true);
    expect(harness.planner.calls).toHaveLength(2);
    const replanned = harness.planner.input(1);
    expect(replanned.runId).toBe(show(1).runId);
    expect(replanned.turnId).toBe(show(1).turnId);
    expect(replanned.request).toEqual(
      buildShowRequest(weekChart, show(1).intent, show(1).intentFacts),
    );
    expect(replanned.messageId).not.toBe(first.messageId);
    expect(replanned.signal.aborted).toBe(false);

    harness.planner.respond(0, changeResponse(monthChart));
    await flushMicrotasks();
    expect(harness.received).toEqual([]);

    harness.planner.respond(1, changeResponse(weekChart));
    await flushMicrotasks();
    const changes = harness.received.filter(
      (event) => event.type === 'ui_change',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.runId).toBe(show(1).runId);
    expect(harness.observed[0]?.metadata).toMatchObject({
      changeId: changes[0]?.changeId,
    });
    expect(harness.warnings()).toEqual([]);
    expect(harness.notes).toEqual([]);
  });

  test('keeps planning when the Chart noted during planning leaves the request unchanged', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    const { signal } = harness.planner.input(0);

    harness.queue.noteChart(structuredClone(monthChart));
    harness.queue.noteChart({
      ...structuredClone(monthChart),
      context: {
        ...monthChart.context,
        updateReasons: [{ type: 'user_intent', intent: 'Something else' }],
      },
    });

    expect(signal.aborted).toBe(false);
    expect(harness.planner.calls).toHaveLength(1);
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();
    expect(change.runId).toBe(show(1).runId);
  });

  test('keeps queue order when a show in planning is planned again', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));

    harness.queue.noteChart(weekChart);

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).runId).toBe(show(1).runId);
    harness.planner.respond(1, nothingToShow(weekChart));
    await harness.planner.nextCall();
    expect(harness.planner.input(2).runId).toBe(show(2).runId);
    expect(harness.planner.input(2).request.instances).toEqual(
      weekChart.instances,
    );
  });

  test('takes a Chart noted after the slot is free', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.planner.respond(0, nothingToShow(monthChart));
    await flushMicrotasks();

    harness.queue.noteChart(dayChart);
    harness.queue.request(show(2));

    expect(harness.planner.input(1).request.instances).toEqual(
      dayChart.instances,
    );
  });

  test.each([
    {
      failure: 'returns an error result',
      code: 'ProviderError',
      errorContext: {},
      fail: (harness: Harness) =>
        harness.planner.fail(
          0,
          providerError(
            `RAW PROVIDER DETAIL ${ERROR_SENTINEL}`,
            ERROR_SENTINEL,
          ),
        ),
    },
    {
      failure: 'throws',
      code: 'internal_error',
      errorContext: { errorName: 'Error' },
      fail: (harness: Harness) =>
        harness.planner.throws(0, new Error(`thrown ${ERROR_SENTINEL}`)),
    },
    {
      failure: 'outlasts the planning timeout',
      code: 'planning_timeout',
      errorContext: {},
      fail: (harness: Harness) =>
        harness.time.advance(SHOW_PLANNING_TIMEOUT_MS),
    },
  ])(
    'reports a show whose Planner call $failure with an error event, a failed note, a diagnostic and one warning, then plans the next show',
    async ({ code, errorContext, fail }) => {
      const harness = createHarness();
      harness.queue.noteChart(monthChart);
      harness.queue.request(show(1));
      harness.queue.request(show(2));

      const nextCall = harness.planner.nextCall();
      fail(harness);
      await nextCall;

      const failed = harness.observed.find(
        (entry) => entry.kind === 'engine.agent.show.failed',
      );
      const changeId = failed?.metadata.changeId;
      expect(changeId).toEqual(expect.any(String));
      expect(harness.received).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: ChangeId(String(changeId)),
          runId: show(1).runId,
          code,
          error: 'The screen could not be updated.',
        },
      ]);
      expect(harness.notes).toEqual([
        {
          runId: show(1).runId,
          turnId: show(1).turnId,
          text: 'Show failed: latest_order result could not be shown.',
        },
      ]);
      expect(harness.observed).toEqual([
        {
          runId: show(1).runId,
          inputId: show(1).inputId,
          kind: 'engine.agent.show.failed',
          metadata: { changeId, turnId: show(1).turnId, code },
          readContent: undefined,
        },
      ]);
      expect(harness.warnings()).toEqual([
        {
          message: 'Loop-driven show failed',
          data: {
            changeId,
            messageId: harness.planner.input(0).messageId,
            runId: show(1).runId,
            turnId: show(1).turnId,
            toolNames: show(1).toolNames,
            code,
            ...errorContext,
          },
        },
      ]);
      expect(harness.planner.calls).toHaveLength(2);
      expect(harness.planner.input(1).runId).toBe(show(2).runId);
      expect(
        JSON.stringify([
          harness.received,
          harness.notes,
          harness.logs,
          harness.observed,
        ]),
      ).not.toContain(ERROR_SENTINEL);
    },
  );

  test('aborts the Planner call at the planning timeout and discards its late outcome', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    const { signal } = harness.planner.input(0);
    expect(SHOW_PLANNING_TIMEOUT_MS).toBe(30_000);
    expect(harness.time.scheduled()).toEqual([SHOW_PLANNING_TIMEOUT_MS]);

    harness.time.advance(SHOW_PLANNING_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    expect(harness.received).toEqual([]);
    harness.time.advance(1);
    expect(signal.aborted).toBe(true);
    expect(harness.errors().map((event) => event.code)).toEqual([
      'planning_timeout',
    ]);

    harness.planner.respond(0, changeResponse(monthChart));
    await flushMicrotasks();

    expect(harness.received.map((event) => event.type)).toEqual(['error']);
    expect(harness.notes).toHaveLength(1);
    expect(harness.time.pending()).toBe(0);
  });

  test('honours a planning timeout overridden through the factory options', () => {
    const harness = createHarness({ planningTimeoutMs: 100 });
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));

    harness.time.advance(100);

    expect(harness.planner.input(0).signal.aborted).toBe(true);
    expect(harness.errors().map((event) => event.code)).toEqual([
      'planning_timeout',
    ]);
  });

  test('cancels the planning timer once the Planner settles', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));

    harness.planner.respond(0, nothingToShow(monthChart));
    await flushMicrotasks();
    harness.time.advance(SHOW_PLANNING_TIMEOUT_MS);

    expect(harness.time.pending()).toBe(0);
    expect(harness.errors()).toEqual([]);
  });

  test('a restart on a newer Chart cancels the first planning timer and arms a fresh one, with no failed note or error event', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.time.advance(SHOW_PLANNING_TIMEOUT_MS - 1);

    harness.queue.noteChart(weekChart);

    expect(harness.time.scheduled()).toEqual([
      SHOW_PLANNING_TIMEOUT_MS,
      SHOW_PLANNING_TIMEOUT_MS,
    ]);
    expect(harness.time.pending()).toBe(1);
    harness.time.advance(1);
    expect(harness.planner.input(1).signal.aborted).toBe(false);
    expect(harness.received).toEqual([]);
    expect(harness.notes).toEqual([]);
    expect(harness.warnings()).toEqual([]);

    harness.time.advance(SHOW_PLANNING_TIMEOUT_MS - 1);
    expect(harness.planner.input(1).signal.aborted).toBe(true);
    expect(harness.errors().map((event) => event.code)).toEqual([
      'planning_timeout',
    ]);
    expect(harness.notes).toHaveLength(1);
  });

  test('a restart on a newer Chart keeps whenIdle waiting until the replanned show settles', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.queue.noteChart(weekChart);
    harness.planner.respond(0, nothingToShow(monthChart));
    await flushMicrotasks();
    expect(idle.settled).toBe(false);

    harness.planner.respond(1, nothingToShow(weekChart));
    await flushMicrotasks();
    expect(idle.settled).toBe(true);
  });

  test('close after a restart aborts the replanned call and records or emits nothing', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.noteChart(weekChart);

    harness.queue.close();

    expect(harness.planner.input(0).signal.aborted).toBe(true);
    expect(harness.planner.input(1).signal.aborted).toBe(true);
    expect(harness.time.pending()).toBe(0);
    harness.planner.respond(0, changeResponse(monthChart));
    harness.planner.respond(1, changeResponse(weekChart));
    await flushMicrotasks();
    harness.time.advance(SHOW_PLANNING_TIMEOUT_MS);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.received).toEqual([]);
    expect(harness.observed).toEqual([]);
    expect(harness.notes).toEqual([]);
  });

  test('logs a thrown Planner call once with its error name but without its message', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));

    harness.planner.throws(0, new TypeError(`thrown ${ERROR_SENTINEL}`));
    await flushMicrotasks();

    expect(harness.warnings()).toEqual([
      {
        message: 'Loop-driven show failed',
        data: {
          changeId: harness.errors()[0]?.changeId,
          messageId: harness.planner.input(0).messageId,
          runId: show(1).runId,
          turnId: show(1).turnId,
          toolNames: show(1).toolNames,
          code: 'internal_error',
          errorName: 'TypeError',
        },
      },
    ]);
    expect(JSON.stringify(harness.logs)).not.toContain(ERROR_SENTINEL);
  });

  test('records a skipped note and a diagnostic when there is nothing to show, sends nothing and plans the next show', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));

    harness.planner.respond(0, nothingToShow(monthChart));
    await harness.planner.nextCall();

    expect(harness.received).toEqual([]);
    expect(harness.notes).toEqual([
      {
        runId: show(1).runId,
        turnId: show(1).turnId,
        text: 'Show skipped: nothing new to show for latest_order result.',
      },
    ]);
    expect(harness.observed).toEqual([
      {
        runId: show(1).runId,
        inputId: show(1).inputId,
        kind: 'engine.agent.show.skipped',
        metadata: {
          changeId: expect.any(String),
          turnId: show(1).turnId,
          reason: 'nothing_to_show',
        },
        readContent: undefined,
      },
    ]);
    expect(harness.time.scheduled()).toEqual([
      SHOW_PLANNING_TIMEOUT_MS,
      SHOW_PLANNING_TIMEOUT_MS,
    ]);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('records the Planner question in a skipped note but never in diagnostics, logs or the wire', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    const question = `Which order do you mean? ${QUESTION_SENTINEL}`;

    harness.planner.outcome(0, { type: 'needs_clarification', question });
    await harness.planner.nextCall();

    expect(harness.received).toEqual([]);
    expect(harness.notes).toEqual([
      {
        runId: show(1).runId,
        turnId: show(1).turnId,
        text: `Show skipped: the Planner needs more detail to show latest_order result. Question: ${question}`,
      },
    ]);
    expect(
      harness.observed.map(({ kind, metadata }) => ({ kind, metadata })),
    ).toEqual([
      {
        kind: 'engine.agent.show.skipped',
        metadata: {
          changeId: expect.any(String),
          turnId: show(1).turnId,
          reason: 'needs_clarification',
        },
      },
    ]);
    expect(
      JSON.stringify([harness.observed, harness.logs, harness.received]),
    ).not.toContain(QUESTION_SENTINEL);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('emits a change whose plan is empty but whose layout differs from the request', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));

    harness.planner.respond(0, {
      ...nothingToShow(monthChart),
      layout: { type: 'grid', positions: [] },
    });
    const change = await harness.nextUiChange();

    expect(change.response.executionPlan).toEqual([]);
  });

  test('drops a show when no Chart is known yet and moves on', async () => {
    const harness = createHarness();
    harness.queue.request(show(1));

    expect(harness.planner.calls).toHaveLength(0);
    expect(harness.warnings()).toEqual([
      {
        message: 'Dropped a loop-driven show with no known Chart',
        data: { runId: show(1).runId, turnId: show(1).turnId },
      },
    ]);
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(2));
    expect(harness.planner.calls).toHaveLength(1);
  });

  test('never lets Planner prose reach events, notes, logs or diagnostic metadata', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));

    harness.planner.respond(0, {
      ...changeResponse(monthChart),
      userMessage: PROSE_SENTINEL,
    });
    const change = await harness.nextUiChange();
    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    expect('userMessage' in change.response).toBe(false);
    expect(JSON.stringify(harness.received)).not.toContain(PROSE_SENTINEL);
    expect(JSON.stringify(harness.notes)).not.toContain(PROSE_SENTINEL);
    expect(JSON.stringify(harness.logs)).not.toContain(PROSE_SENTINEL);
    expect(
      JSON.stringify(harness.observed.map((entry) => entry.metadata)),
    ).not.toContain(PROSE_SENTINEL);
  });

  test('observes the emitted and applied change with ids in metadata and text behind readContent', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.planner.respond(0, changeResponse(monthChart, 2));
    const change = await harness.nextUiChange();
    const outcomes: AgentActionOutcome[] = [{ ok: true }, { ok: false }];

    harness.queue.acknowledge(applied(change.changeId, weekChart, outcomes));

    expect(
      harness.observed.map(({ readContent: _, ...entry }) => entry),
    ).toEqual([
      {
        runId: show(1).runId,
        inputId: show(1).inputId,
        kind: 'engine.agent.ui_change.emitted',
        metadata: {
          changeId: change.changeId,
          turnId: show(1).turnId,
          actions: 2,
        },
      },
      {
        runId: show(1).runId,
        inputId: show(1).inputId,
        kind: 'engine.agent.ui_change.applied',
        metadata: {
          changeId: change.changeId,
          turnId: show(1).turnId,
          actions: 2,
          failed: 1,
        },
      },
    ]);
    const [emitted, appliedEntry] = harness.observed;
    expect(emitted?.readContent?.()).toEqual({
      intent: show(1).intent,
      intentFacts: show(1).intentFacts,
    });
    const screenNote = harness.notes[0]?.text;
    expect(appliedEntry?.readContent?.()).toEqual({
      chart: weekChart,
      actionOutcomes: outcomes,
      screenNote,
    });
    const metadataJson = JSON.stringify(
      harness.observed.map((entry) => entry.metadata),
    );
    expect(metadataJson).not.toContain(show(1).intent);
    expect(metadataJson).not.toContain('ORD-1');
    expect(metadataJson).not.toContain(screenNote ?? 'missing note');
  });

  test.each([
    {
      outcome: 'a change',
      settle: (harness: Harness) =>
        harness.planner.respond(0, changeResponse(monthChart)),
    },
    {
      outcome: 'an error result',
      settle: (harness: Harness) =>
        harness.planner.fail(0, providerError('provider down', undefined)),
    },
    {
      outcome: 'a clarifying question',
      settle: (harness: Harness) =>
        harness.planner.outcome(0, {
          type: 'needs_clarification',
          question: 'Which order?',
        }),
    },
  ])(
    'close aborts the Planner call in flight and discards its later $outcome and the queued shows',
    async ({ settle }) => {
      const harness = createHarness();
      harness.queue.noteChart(monthChart);
      harness.queue.request(show(1));
      harness.queue.request(show(2));
      const { signal } = harness.planner.input(0);

      harness.queue.close();
      expect(signal.aborted).toBe(true);
      expect(harness.time.pending()).toBe(0);
      settle(harness);
      await flushMicrotasks();
      harness.time.advance(SHOW_PLANNING_TIMEOUT_MS);
      harness.queue.request(show(3));
      harness.queue.noteChart(weekChart);

      expect(harness.planner.calls).toHaveLength(1);
      expect(harness.received).toEqual([]);
      expect(harness.observed).toEqual([]);
      expect(harness.notes).toEqual([]);
    },
  );

  test('close resolves idle waiters and ignores a later dropRun', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.queue.close();
    harness.queue.dropRun(show(1).runId);
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
    expect(
      await trackSettled(harness.queue.whenIdle()).promise,
    ).toBeUndefined();
    expect(harness.notes).toEqual([]);
    expect(harness.observed).toEqual([]);
  });

  test('whenIdle resolves at once when nothing is queued, planning or awaiting acknowledgement', async () => {
    const harness = createHarness();

    const idle = trackSettled(harness.queue.whenIdle());
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
  });

  test('whenIdle waits through planning and acknowledgement of every queued show', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    const first = trackSettled(harness.queue.whenIdle());
    const second = trackSettled(harness.queue.whenIdle());

    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();
    await flushMicrotasks();
    expect(first.settled).toBe(false);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    await flushMicrotasks();
    expect(first.settled).toBe(false);

    harness.planner.respond(1, nothingToShow(weekChart));
    await flushMicrotasks();
    expect(first.settled).toBe(true);
    expect(second.settled).toBe(true);
  });

  test('whenIdle resolves when the acknowledgement timeout ends the last show', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    const idle = trackSettled(harness.queue.whenIdle());

    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS - 1);
    await flushMicrotasks();
    expect(idle.settled).toBe(false);
    harness.time.advance(1);
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
  });

  test('whenIdle resolves when a failed show ends the last show', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.time.advance(SHOW_PLANNING_TIMEOUT_MS);
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
  });

  test('dropRun aborts the run planning show and drops its queued shows with cancelled notes and diagnostics while other runs move on', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1, 1));
    harness.queue.request(show(2, 2));
    harness.queue.request(show(3, 1));
    const { signal } = harness.planner.input(0);

    harness.queue.dropRun(show(1, 1).runId);

    expect(signal.aborted).toBe(true);
    expect(harness.notes).toEqual([
      {
        runId: show(1, 1).runId,
        turnId: show(1, 1).turnId,
        text: 'Show cancelled: latest_order result.',
      },
      {
        runId: show(3, 1).runId,
        turnId: show(3, 1).turnId,
        text: 'Show cancelled: latest_order result.',
      },
    ]);
    expect(harness.observed).toEqual([
      {
        runId: show(1, 1).runId,
        inputId: show(1, 1).inputId,
        kind: 'engine.agent.show.cancelled',
        metadata: { turnId: show(1, 1).turnId, changeId: expect.any(String) },
        readContent: undefined,
      },
      {
        runId: show(3, 1).runId,
        inputId: show(3, 1).inputId,
        kind: 'engine.agent.show.cancelled',
        metadata: { turnId: show(3, 1).turnId },
        readContent: undefined,
      },
    ]);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).runId).toBe(show(2, 2).runId);
    expect(harness.time.pending()).toBe(1);

    harness.planner.respond(0, changeResponse(monthChart));
    harness.planner.respond(1, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    expect(change.runId).toBe(show(2, 2).runId);
    expect(harness.received).toEqual([change]);
    expect(harness.observed.map((entry) => entry.kind)).toEqual([
      'engine.agent.show.cancelled',
      'engine.agent.show.cancelled',
      'engine.agent.ui_change.emitted',
    ]);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('dropRun keeps the run change already emitted awaiting its acknowledgement and records its screen note', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1, 1));
    harness.queue.request(show(2, 1));
    harness.queue.request(show(3, 3));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.dropRun(show(1, 1).runId);

    expect(harness.notes).toEqual([
      {
        runId: show(2, 1).runId,
        turnId: show(2, 1).turnId,
        text: 'Show cancelled: latest_order result.',
      },
    ]);
    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.time.pending()).toBe(1);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    expect(harness.errors()).toEqual([]);
    expect(harness.notes[1]).toEqual({
      runId: show(1, 1).runId,
      turnId: show(1, 1).turnId,
      text: expect.stringMatching(/^Screen updated: /),
    });
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).runId).toBe(show(3, 3).runId);
  });

  test('dropRun of a run without shows leaves the queue untouched', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));

    harness.queue.dropRun(RunId('another-run'));

    expect(harness.planner.input(0).signal.aborted).toBe(false);
    expect(harness.notes).toEqual([]);
    harness.planner.respond(0, changeResponse(monthChart));
    expect((await harness.nextUiChange()).runId).toBe(show(1).runId);
  });

  test('close cancels the acknowledgement timer and ignores a later acknowledgement', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(show(1));
    harness.queue.request(show(2));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.close();
    expect(harness.time.pending()).toBe(0);
    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.errors()).toEqual([]);
    expect(harness.notes).toEqual([]);
  });
});

interface Observation {
  readonly runId: RunId;
  readonly inputId: MessageId;
  readonly kind: string;
  readonly metadata: DiagnosticMetadata;
  readonly readContent?: () => unknown;
}

interface LogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly data?: unknown;
}

type Harness = ReturnType<typeof createHarness>;

function createHarness({
  planningTimeoutMs,
}: { readonly planningTimeoutMs?: number } = {}) {
  const time = createFakeAgentRunTime();
  const events = createOrderedEmitter<AgentEvent>();
  const received: AgentEvent[] = [];
  const uiChangeWaiters: ((event: AgentUiChangeEvent) => void)[] = [];
  events.subscribe((event) => {
    received.push(event);
    if (event.type === 'ui_change') uiChangeWaiters.shift()?.(event);
  });
  const observed: Observation[] = [];
  const notes: { runId: RunId; turnId: string; text: string }[] = [];
  const logs: LogEntry[] = [];
  const logger: Logger = {
    debug: (message, data) => logs.push({ level: 'debug', message, data }),
    info: (message, data) => logs.push({ level: 'info', message, data }),
    warn: (message, data) => logs.push({ level: 'warn', message, data }),
    error: (message, error, data) =>
      logs.push({ level: 'error', message, data: { error, data } }),
  };
  const planner = createControlledPlanner();
  const queue = createPlannerShowQueue({
    planShow: planner.planShow,
    events,
    observe: (runId, inputId, kind, metadata, readContent) =>
      observed.push({ runId, inputId, kind, metadata, readContent }),
    recordShowNote: (runId, turnId, text) =>
      notes.push({ runId, turnId, text }),
    logger,
    scheduleTimeout: time.clock.scheduleTimeout,
    acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TIMEOUT_MS,
    planningTimeoutMs,
  });
  return {
    queue,
    planner,
    time,
    events,
    received,
    observed,
    notes,
    logs,
    errors: () => received.filter((event) => event.type === 'error'),
    warnings: () =>
      logs
        .filter((entry) => entry.level === 'warn')
        .map(({ message, data }) => ({ message, data })),
    nextUiChange: () =>
      new Promise<AgentUiChangeEvent>((resolve) => {
        uiChangeWaiters.push(resolve);
      }),
  };
}

function createControlledPlanner() {
  const calls: {
    readonly input: ShowPlanInput;
    readonly result: Deferred<Result<LoopDrivenPlanOutcome, EngineError>>;
  }[] = [];
  const callWaiters: (() => void)[] = [];
  const call = (index: number) => {
    const entry = calls[index];
    if (entry === undefined) throw new Error(`No Planner call ${index}`);
    return entry;
  };
  const outcome = (index: number, value: LoopDrivenPlanOutcome) =>
    call(index).result.resolve(ok(value));
  return {
    calls,
    planShow: (input: ShowPlanInput) => {
      const result = defer<Result<LoopDrivenPlanOutcome, EngineError>>();
      calls.push({ input, result });
      callWaiters.shift()?.();
      return result.promise;
    },
    input: (index: number) => call(index).input,
    outcome,
    respond: (index: number, response: MaelstromResponse) =>
      outcome(index, { type: 'response', response }),
    fail: (index: number, error: EngineError) =>
      call(index).result.resolve(err(error)),
    throws: (index: number, error: unknown) => call(index).result.reject(error),
    nextCall: () =>
      new Promise<void>((resolve) => {
        callWaiters.push(resolve);
      }),
  };
}

function show(index: number, run = index): LoopDrivenShow {
  return {
    runId: RunId(`run-${run}`),
    inputId: MessageId(`input-${run}`),
    turnId: `run-${run}:turn-${index}`,
    intent: `Show my latest order number ${index}`,
    toolNames: ['latest_order'],
    intentFacts: { [`latest_order:c${index}`]: { orderId: `ORD-${index}` } },
  };
}

function changeResponse(request: ChartRequest, actions = 1): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId('planner-request'),
    rationale: 'Show the week.',
    executionPlan: Array.from({ length: actions }, () => ({
      instanceId: InstanceId('calendar-main'),
      action: ActionName('showWeek'),
    })),
    layout: request.layout as MaelstromResponse['layout'],
  };
}

function nothingToShow(request: ChartRequest): MaelstromResponse {
  return {
    ...changeResponse(request, 0),
    layout: structuredClone(request.layout) as MaelstromResponse['layout'],
  };
}

function applied(
  changeId: ChangeId,
  chart: ChartRequest,
  actionOutcomes: AgentActionOutcome[],
): AgentUiAppliedInput {
  return {
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId,
    chart,
    actionOutcomes,
  };
}

function unknownChangeError(changeId: string): AgentErrorEvent {
  return {
    type: 'error',
    version: AGENT_WIRE_VERSION,
    changeId: ChangeId(changeId),
    code: 'unknown_change',
    error: 'Unknown UI change.',
  };
}

function calendarChart(variant: string): ChartRequest {
  return makeGridRequest({
    instances: [{ instanceId: 'calendar-main', vesselId: 'calendar', variant }],
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

function trackSettled(promise: Promise<void>) {
  const tracked = { settled: false, promise };
  void promise.then(() => {
    tracked.settled = true;
  });
  return tracked;
}
