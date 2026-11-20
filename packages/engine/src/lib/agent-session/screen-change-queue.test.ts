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
  createScreenChangeQueue,
  type ScreenChangeJob,
  SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
} from './screen-change-queue.js';
import { buildScreenChangeRequest } from './screen-change-request.js';
import type { ScreenChangeResult } from './screen-change-result.js';
import { SCREEN_NOTE_MAX_CHARS } from './screen-note.js';
import type { PlanOutcome, SessionPlanInput } from './session-planner.js';

const ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;
const PROSE_SENTINEL = 'PLANNER PROSE SENTINEL';
const ERROR_SENTINEL = 'PLANNER ERROR SENTINEL';
const QUESTION_SENTINEL = 'PLANNER QUESTION SENTINEL';
const LATE_NOTE_PREFIX =
  'Screen change settled after the run stopped waiting: ';

const monthChart = makeGridRequest();
const weekChart = calendarChart('week');
const dayChart = calendarChart('day');

describe('createScreenChangeQueue', () => {
  test('starts planning at once on the latest Chart with fresh ids', () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);

    harness.queue.request(screenChange(1));

    expect(harness.planner.calls).toHaveLength(1);
    const input = harness.planner.input(0);
    expect(input.request).toEqual(
      buildScreenChangeRequest(monthChart, screenChange(1).goals),
    );
    expect(input.owner.runId).toBe(screenChange(1).runId);
    expect(input.owner.inputId).toBe(screenChange(1).inputId);
    expect(input.owner.turnId).toBe(screenChange(1).turnId);
    expect(input.messageId).not.toBe(screenChange(1).inputId);
    expect(input.signal.aborted).toBe(false);
  });

  test('returns one answer per goal, in order', () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);

    const answers = harness.queue.request(screenChange(1, 1, 3));

    expect(answers).toHaveLength(3);
  });

  test('emits the planned change with its run id and change id', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));

    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    expect(change).toEqual({
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId: screenChange(1).runId,
      changeId: change.changeId,
      response: changeResponse(monthChart),
    });
    expect(change.changeId.length).toBeGreaterThan(0);
  });

  test('plans the next Screen Change only after the matching acknowledgement, on the acknowledged Chart', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));

    expect(harness.planner.calls).toHaveLength(1);
    harness.planner.respond(0, changeResponse(monthChart));
    const first = await harness.nextUiChange();
    expect(harness.planner.calls).toHaveLength(1);

    harness.queue.acknowledge(
      applied(first.changeId, weekChart, [{ ok: true }]),
    );

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).request).toEqual(
      buildScreenChangeRequest(weekChart, screenChange(2).goals),
    );
    harness.planner.respond(1, changeResponse(weekChart));
    const second = await harness.nextUiChange();
    expect(second.runId).toBe(screenChange(2).runId);
    expect(second.changeId).not.toBe(first.changeId);
  });

  test('mints a distinct change id and message id per Screen Change when planning starts', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
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
      if (event.type === 'ui_change' && event.runId === screenChange(1).runId)
        harness.queue.acknowledge(
          applied(event.changeId, weekChart, [{ ok: true }]),
        );
    });
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));

    harness.planner.respond(0, changeResponse(monthChart));
    await harness.planner.nextCall();

    expect(harness.errors()).toEqual([]);
    expect((await answer)?.status).toBe('applied');
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
    const answer = trackSettled(harness.queue.request(screenChange(1))[0]);
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.acknowledge(
      applied(ChangeId('stale-change'), weekChart, [{ ok: true }]),
    );
    await flushMicrotasks();

    expect(harness.errors()).toEqual([
      unknownChangeError('nothing-pending'),
      unknownChangeError('stale-change'),
    ]);
    expect(harness.sessionObserved).toEqual([
      {
        kind: 'engine.agent.ui_applied.rejected',
        metadata: { changeId: 'nothing-pending', code: 'unknown_change' },
      },
      {
        kind: 'engine.agent.ui_applied.rejected',
        metadata: { changeId: 'stale-change', code: 'unknown_change' },
      },
    ]);
    expect(answer.settled).toBe(false);
    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    expect(await answer.promise).toEqual({
      status: 'applied',
      summary: 'applied: "Show order 1.1"',
      changeId: change.changeId,
    });
  });

  test('refuses a wrong outcome count while the change stays pending until a valid acknowledgement', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answer = trackSettled(harness.queue.request(screenChange(1))[0]);
    harness.queue.request(screenChange(2));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.acknowledge(applied(change.changeId, weekChart, []));
    await flushMicrotasks();

    expect(harness.errors()).toEqual([
      {
        type: 'error',
        version: AGENT_WIRE_VERSION,
        changeId: change.changeId,
        code: 'invalid_action_outcomes',
        error: 'Expected one outcome per Action.',
      },
    ]);
    expect(harness.sessionObserved).toEqual([]);
    expect(
      harness
        .observedOf('engine.agent.ui_applied.rejected')
        .map(({ readContent: _, ...entry }) => entry),
    ).toEqual([
      {
        runId: screenChange(1).runId,
        inputId: screenChange(1).inputId,
        kind: 'engine.agent.ui_applied.rejected',
        metadata: {
          changeId: change.changeId,
          turnId: screenChange(1).turnId,
          code: 'invalid_action_outcomes',
        },
      },
    ]);
    expect(answer.settled).toBe(false);
    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.time.pending()).toBe(1);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    expect(harness.errors()).toHaveLength(1);
    expect((await answer.promise).status).toBe('applied');
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('answers every goal applied with the change id after a valid acknowledgement and records no note while the run waits', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));
    harness.planner.respond(0, changeResponse(monthChart, 2));
    const change = await harness.nextUiChange();

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }, { ok: true }]),
    );

    expect(await Promise.all(answers)).toEqual([
      {
        status: 'applied',
        summary: 'applied: "Show order 1.1"',
        changeId: change.changeId,
      },
      {
        status: 'applied',
        summary: 'applied: "Show order 1.2"',
        changeId: change.changeId,
      },
    ]);
    expect(harness.notes).toEqual([]);
    expect(harness.time.pending()).toBe(0);
  });

  test('answers every goal failed (some steps did not run) with the change id when an Action outcome is not ok', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));
    harness.planner.respond(0, changeResponse(monthChart, 2));
    const change = await harness.nextUiChange();

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [
        { ok: true },
        { ok: false, error: 'browser failure detail' },
      ]),
    );

    expect(await Promise.all(answers)).toEqual([
      {
        status: 'failed',
        summary: 'failed (some steps did not run): "Show order 1.1"',
        changeId: change.changeId,
      },
      {
        status: 'failed',
        summary: 'failed (some steps did not run): "Show order 1.2"',
        changeId: change.changeId,
      },
    ]);
    expect(harness.notes).toEqual([]);
    expect(
      JSON.stringify(harness.observed.map((entry) => entry.metadata)),
    ).not.toContain('browser failure detail');
  });

  test('reports an acknowledgement timeout with an error event and a diagnostic, answers unknown with the change id, then plans the next Screen Change on the last known Chart', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();
    expect(harness.time.scheduled()).toEqual([
      SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
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
        runId: screenChange(1).runId,
        code: 'ui_ack_timeout',
        error: 'The UI acknowledgement did not arrive.',
      },
    ]);
    expect(await answer).toEqual({
      status: 'unknown',
      summary: 'unknown (the screen did not confirm): "Show order 1.1"',
      changeId: change.changeId,
    });
    expect(harness.notes).toEqual([]);
    expect(
      harness
        .observedFor(screenChange(1).runId)
        .filter(({ kind }) => kind !== 'engine.agent.screen_change.requested')
        .map(({ kind, metadata }) => ({ kind, metadata })),
    ).toEqual([
      expect.objectContaining({ kind: 'engine.agent.ui_change.emitted' }),
      {
        kind: 'engine.agent.ui_change.timed_out',
        metadata: { changeId: change.changeId, turnId: screenChange(1).turnId },
      },
      {
        kind: 'engine.agent.screen_change.settled',
        metadata: {
          turnId: screenChange(1).turnId,
          callId: 'call-1-1',
          reasonId: 'r1',
          status: 'unknown',
          changeId: change.changeId,
        },
      },
    ]);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).request).toEqual(
      buildScreenChangeRequest(monthChart, screenChange(2).goals),
    );

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    expect(harness.errors().slice(1)).toEqual([
      unknownChangeError(change.changeId),
    ]);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('ignores a Chart noted while a change awaits acknowledgement', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();

    harness.queue.noteChart(dayChart);
    harness.queue.request(screenChange(2));
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(harness.planner.input(1).request.instances).toEqual(
      monthChart.instances,
    );
  });

  test('plans a Screen Change in planning again on a newer Chart that changes its request, with fresh ids', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answer = trackSettled(harness.queue.request(screenChange(1))[0]);
    const first = harness.planner.input(0);

    harness.queue.noteChart(weekChart);

    expect(first.signal.aborted).toBe(true);
    expect(harness.planner.calls).toHaveLength(2);
    const replanned = harness.planner.input(1);
    expect(replanned.owner.runId).toBe(screenChange(1).runId);
    expect(replanned.owner.turnId).toBe(screenChange(1).turnId);
    expect(replanned.request).toEqual(
      buildScreenChangeRequest(weekChart, screenChange(1).goals),
    );
    expect(replanned.messageId).not.toBe(first.messageId);
    expect(replanned.signal.aborted).toBe(false);

    harness.planner.respond(0, changeResponse(monthChart));
    await flushMicrotasks();
    expect(harness.received).toEqual([]);
    expect(answer.settled).toBe(false);

    harness.planner.respond(1, changeResponse(weekChart));
    await flushMicrotasks();
    const changes = harness.received.filter(
      (event) => event.type === 'ui_change',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.runId).toBe(screenChange(1).runId);
    expect(
      harness.observedOf('engine.agent.ui_change.emitted')[0]?.metadata,
    ).toMatchObject({ changeId: changes[0]?.changeId });
    expect(
      harness.observedOf('engine.agent.screen_change.requested'),
    ).toHaveLength(1);
    expect(harness.warnings()).toEqual([]);
    expect(answer.settled).toBe(false);
  });

  test('keeps planning when the Chart noted during planning leaves the request unchanged', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
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
    expect(change.runId).toBe(screenChange(1).runId);
  });

  test('keeps queue order when a Screen Change in planning is planned again', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));

    harness.queue.noteChart(weekChart);

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).owner.runId).toBe(screenChange(1).runId);
    harness.planner.respond(1, noScreenChange(weekChart));
    await harness.planner.nextCall();
    expect(harness.planner.input(2).owner.runId).toBe(screenChange(2).runId);
    expect(harness.planner.input(2).request.instances).toEqual(
      weekChart.instances,
    );
  });

  test('takes a Chart noted after the slot is free', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.planner.respond(0, noScreenChange(monthChart));
    await flushMicrotasks();

    harness.queue.noteChart(dayChart);
    harness.queue.request(screenChange(2));

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
        harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS),
    },
  ])(
    'answers every goal failed without a change id when the Planner call $failure, keeps the wire error, a diagnostic and one warning, then plans the next Screen Change',
    async ({ code, errorContext, fail }) => {
      const harness = createHarness();
      harness.queue.noteChart(monthChart);
      const answers = harness.queue.request(screenChange(1, 1, 2));
      harness.queue.request(screenChange(2));

      const nextCall = harness.planner.nextCall();
      fail(harness);
      await nextCall;

      const failed = harness.observedOf('engine.agent.screen_change.failed');
      const changeId = failed[0]?.metadata.changeId;
      expect(changeId).toEqual(expect.any(String));
      expect(await Promise.all(answers)).toEqual([
        { status: 'failed', summary: 'failed: "Show order 1.1"' },
        { status: 'failed', summary: 'failed: "Show order 1.2"' },
      ]);
      expect(harness.received).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: ChangeId(String(changeId)),
          runId: screenChange(1).runId,
          code,
          error: 'The screen could not be updated.',
        },
      ]);
      expect(harness.notes).toEqual([]);
      expect(
        harness
          .observedFor(screenChange(1).runId)
          .filter(
            ({ kind }) => kind !== 'engine.agent.screen_change.requested',
          ),
      ).toEqual([
        {
          runId: screenChange(1).runId,
          inputId: screenChange(1).inputId,
          kind: 'engine.agent.screen_change.failed',
          metadata: { changeId, turnId: screenChange(1).turnId, code },
          readContent: undefined,
        },
        ...[1, 2].map((goal) => ({
          runId: screenChange(1).runId,
          inputId: screenChange(1).inputId,
          kind: 'engine.agent.screen_change.settled',
          metadata: {
            turnId: screenChange(1).turnId,
            callId: `call-1-${goal}`,
            reasonId: `r${goal}`,
            status: 'failed',
          },
          readContent: undefined,
        })),
      ]);
      expect(harness.warnings()).toEqual([
        {
          message: 'Screen Change failed',
          data: {
            changeId,
            messageId: harness.planner.input(0).messageId,
            runId: screenChange(1).runId,
            turnId: screenChange(1).turnId,
            goals: 2,
            code,
            ...errorContext,
          },
        },
      ]);
      expect(harness.planner.calls).toHaveLength(2);
      expect(harness.planner.input(1).owner.runId).toBe(screenChange(2).runId);
      expect(
        JSON.stringify([
          harness.received,
          await Promise.all(answers),
          harness.logs,
          harness.observed,
        ]),
      ).not.toContain(ERROR_SENTINEL);
    },
  );

  test('aborts the Planner call at the planning timeout and discards its late outcome', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    const { signal } = harness.planner.input(0);
    expect(SCREEN_CHANGE_PLANNING_TIMEOUT_MS).toBe(30_000);
    expect(harness.time.scheduled()).toEqual([
      SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
    ]);

    harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS - 1);
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
    expect((await answer)?.status).toBe('failed');
    expect(
      harness.observedOf('engine.agent.screen_change.settled'),
    ).toHaveLength(1);
    expect(harness.time.pending()).toBe(0);
  });

  test('honours a planning timeout overridden through the factory options', () => {
    const harness = createHarness({ planningTimeoutMs: 100 });
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));

    harness.time.advance(100);

    expect(harness.planner.input(0).signal.aborted).toBe(true);
    expect(harness.errors().map((event) => event.code)).toEqual([
      'planning_timeout',
    ]);
  });

  test('cancels the planning timer once the Planner settles', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));

    harness.planner.respond(0, noScreenChange(monthChart));
    await flushMicrotasks();
    harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS);

    expect(harness.time.pending()).toBe(0);
    expect(harness.errors()).toEqual([]);
  });

  test('a restart on a newer Chart cancels the first planning timer and arms a fresh one, with no failure or error event', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answer = trackSettled(harness.queue.request(screenChange(1))[0]);
    harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS - 1);

    harness.queue.noteChart(weekChart);

    expect(harness.time.scheduled()).toEqual([
      SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
      SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
    ]);
    expect(harness.time.pending()).toBe(1);
    harness.time.advance(1);
    await flushMicrotasks();
    expect(harness.planner.input(1).signal.aborted).toBe(false);
    expect(harness.received).toEqual([]);
    expect(answer.settled).toBe(false);
    expect(harness.warnings()).toEqual([]);

    harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS - 1);
    expect(harness.planner.input(1).signal.aborted).toBe(true);
    expect(harness.errors().map((event) => event.code)).toEqual([
      'planning_timeout',
    ]);
    expect((await answer.promise).status).toBe('failed');
  });

  test('a restart on a newer Chart keeps whenIdle waiting until the replanned Screen Change settles', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.queue.noteChart(weekChart);
    harness.planner.respond(0, noScreenChange(monthChart));
    await flushMicrotasks();
    expect(idle.settled).toBe(false);

    harness.planner.respond(1, noScreenChange(weekChart));
    await flushMicrotasks();
    expect(idle.settled).toBe(true);
  });

  test('close after a restart aborts the replanned call, answers cancelled and records or emits nothing', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    harness.queue.noteChart(weekChart);
    const observedBeforeClose = harness.observed.length;

    harness.queue.close();

    expect(harness.planner.input(0).signal.aborted).toBe(true);
    expect(harness.planner.input(1).signal.aborted).toBe(true);
    expect(harness.time.pending()).toBe(0);
    expect((await answer)?.status).toBe('cancelled');
    harness.planner.respond(0, changeResponse(monthChart));
    harness.planner.respond(1, changeResponse(weekChart));
    await flushMicrotasks();
    harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.received).toEqual([]);
    expect(harness.observed).toHaveLength(observedBeforeClose);
    expect(harness.notes).toEqual([]);
  });

  test('logs a thrown Planner call once with its error name but without its message', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));

    harness.planner.throws(0, new TypeError(`thrown ${ERROR_SENTINEL}`));
    await flushMicrotasks();

    expect(harness.warnings()).toEqual([
      {
        message: 'Screen Change failed',
        data: {
          changeId: harness.errors()[0]?.changeId,
          messageId: harness.planner.input(0).messageId,
          runId: screenChange(1).runId,
          turnId: screenChange(1).turnId,
          goals: 1,
          code: 'internal_error',
          errorName: 'TypeError',
        },
      },
    ]);
    expect(JSON.stringify(harness.logs)).not.toContain(ERROR_SENTINEL);
  });

  test('answers applied (already on screen) without a change id when the response changes nothing, sends nothing and plans the next Screen Change', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));

    harness.planner.respond(0, noScreenChange(monthChart));
    await harness.planner.nextCall();

    expect(await answer).toEqual({
      status: 'applied',
      summary: 'applied (already on screen): "Show order 1.1"',
    });
    expect(harness.received).toEqual([]);
    expect(harness.notes).toEqual([]);
    expect(
      harness
        .observedFor(screenChange(1).runId)
        .map(({ kind, metadata }) => ({ kind, metadata })),
    ).toEqual([
      expect.objectContaining({ kind: 'engine.agent.screen_change.requested' }),
      {
        kind: 'engine.agent.screen_change.settled',
        metadata: {
          turnId: screenChange(1).turnId,
          callId: 'call-1-1',
          reasonId: 'r1',
          status: 'applied',
        },
      },
    ]);
    expect(harness.time.scheduled()).toEqual([
      SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
      SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
    ]);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('answers every goal needs_clarification with the capped Planner question and what is on screen, sends nothing and keeps the question out of diagnostics, logs and the wire', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));
    harness.queue.request(screenChange(2));
    const question = `Which order do you mean? ${QUESTION_SENTINEL} ${'x'.repeat(400)}`;

    harness.planner.outcome(0, { type: 'needs_clarification', question });
    await harness.planner.nextCall();

    const capped = `${question.slice(0, SCREEN_NOTE_MAX_CHARS - 1)}…`;
    expect(capped).toHaveLength(300);
    expect(await Promise.all(answers)).toEqual([
      {
        status: 'needs_clarification',
        summary: 'needs clarification: "Show order 1.1"',
        question: capped,
        onScreen: ['calendar'],
      },
      {
        status: 'needs_clarification',
        summary: 'needs clarification: "Show order 1.2"',
        question: capped,
        onScreen: ['calendar'],
      },
    ]);
    expect(harness.received).toEqual([]);
    expect(harness.notes).toEqual([]);
    expect(
      harness
        .observedFor(screenChange(1).runId)
        .map(({ kind, metadata }) => ({ kind, metadata }))
        .slice(1),
    ).toEqual(
      [1, 2].map((goal) => ({
        kind: 'engine.agent.screen_change.settled',
        metadata: {
          turnId: screenChange(1).turnId,
          callId: `call-1-${goal}`,
          reasonId: `r${goal}`,
          status: 'needs_clarification',
        },
      })),
    );
    expect(
      JSON.stringify([
        harness.observed.map((entry) => entry.metadata),
        harness.logs,
        harness.received,
      ]),
    ).not.toContain(QUESTION_SENTINEL);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('emits a change whose plan is empty but whose layout differs from the request', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));

    harness.planner.respond(0, {
      ...noScreenChange(monthChart),
      layout: { type: 'grid', positions: [] },
    });
    const change = await harness.nextUiChange();

    expect(change.response.executionPlan).toEqual([]);
  });

  test('answers every goal failed when no Chart is known yet and moves on', async () => {
    const harness = createHarness();
    const answers = harness.queue.request(screenChange(1, 1, 2));

    expect(harness.planner.calls).toHaveLength(0);
    expect(await Promise.all(answers)).toEqual([
      { status: 'failed', summary: 'failed: "Show order 1.1"' },
      { status: 'failed', summary: 'failed: "Show order 1.2"' },
    ]);
    expect(harness.received).toEqual([]);
    expect(harness.warnings()).toEqual([
      {
        message: 'Dropped a Screen Change with no known Chart',
        data: { runId: screenChange(1).runId, turnId: screenChange(1).turnId },
      },
    ]);
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(2));
    expect(harness.planner.calls).toHaveLength(1);
  });

  test('never lets Planner prose reach events, answers, logs or diagnostic metadata', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));

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
    expect(JSON.stringify(await answer)).not.toContain(PROSE_SENTINEL);
    expect(JSON.stringify(harness.logs)).not.toContain(PROSE_SENTINEL);
    expect(
      JSON.stringify(harness.observed.map((entry) => entry.metadata)),
    ).not.toContain(PROSE_SENTINEL);
  });

  test('observes the request with goal counts and ids in metadata and the goals and referents behind readContent', () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const job: ScreenChangeJob = {
      ...screenChange(1, 1, 2),
      goals: [
        { callId: 'c1', reasonId: 'r1', goal: 'Show order o-1' },
        {
          callId: 'c3',
          reasonId: 'r2',
          goal: 'Show the shipping address',
          referents: { orderId: 'ORD-1' },
        },
      ],
    };

    harness.queue.request(job);

    const [requested] = harness.observedOf(
      'engine.agent.screen_change.requested',
    );
    expect(requested).toEqual({
      runId: job.runId,
      inputId: job.inputId,
      kind: 'engine.agent.screen_change.requested',
      metadata: {
        turnId: job.turnId,
        goals: 2,
        reasonIds: 'r1,r2',
        callIds: 'c1,c3',
      },
      readContent: expect.any(Function),
    });
    expect(requested?.readContent?.()).toEqual({
      goals: [
        { goal: 'Show order o-1' },
        { goal: 'Show the shipping address', referents: { orderId: 'ORD-1' } },
      ],
    });
    const metadataJson = JSON.stringify(requested?.metadata);
    expect(metadataJson).not.toContain('Show order');
    expect(metadataJson).not.toContain('ORD-1');
  });

  test('observes the emitted and applied change with ids in metadata and the goals, response and Chart behind readContent', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1, 1, 2));
    harness.planner.respond(0, changeResponse(monthChart, 2));
    const change = await harness.nextUiChange();
    const outcomes: AgentActionOutcome[] = [{ ok: true }, { ok: false }];

    harness.queue.acknowledge(applied(change.changeId, weekChart, outcomes));

    expect(
      harness.observed
        .filter(({ kind }) => kind.startsWith('engine.agent.ui_change.'))
        .map(({ readContent: _, ...entry }) => entry),
    ).toEqual([
      {
        runId: screenChange(1).runId,
        inputId: screenChange(1).inputId,
        kind: 'engine.agent.ui_change.emitted',
        metadata: {
          changeId: change.changeId,
          turnId: screenChange(1).turnId,
          actions: 2,
        },
      },
      {
        runId: screenChange(1).runId,
        inputId: screenChange(1).inputId,
        kind: 'engine.agent.ui_change.applied',
        metadata: {
          changeId: change.changeId,
          turnId: screenChange(1).turnId,
          actions: 2,
          failed: 1,
        },
      },
    ]);
    const [emitted] = harness.observedOf('engine.agent.ui_change.emitted');
    const [appliedEntry] = harness.observedOf('engine.agent.ui_change.applied');
    expect(emitted?.readContent?.()).toEqual({
      goals: ['Show order 1.1', 'Show order 1.2'],
      response: change.response,
    });
    expect(appliedEntry?.readContent?.()).toEqual({
      chart: weekChart,
      actionOutcomes: outcomes,
    });
    expect(
      harness
        .observedOf('engine.agent.screen_change.settled')
        .map(({ metadata }) => metadata),
    ).toEqual(
      [1, 2].map((goal) => ({
        turnId: screenChange(1).turnId,
        callId: `call-1-${goal}`,
        reasonId: `r${goal}`,
        status: 'failed',
        changeId: change.changeId,
      })),
    );
    const metadataJson = JSON.stringify(
      harness.observed.map((entry) => entry.metadata),
    );
    expect(metadataJson).not.toContain('Show order');
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
    'close aborts the Planner call in flight, answers every goal cancelled and discards its later $outcome and the queued Screen Changes',
    async ({ settle }) => {
      const harness = createHarness();
      harness.queue.noteChart(monthChart);
      const first = harness.queue.request(screenChange(1, 1, 2));
      const second = harness.queue.request(screenChange(2));
      const { signal } = harness.planner.input(0);
      const observedBeforeClose = harness.observed.length;

      harness.queue.close();
      expect(signal.aborted).toBe(true);
      expect(harness.time.pending()).toBe(0);
      settle(harness);
      await flushMicrotasks();
      harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS);
      const afterClose = harness.queue.request(screenChange(3));
      harness.queue.noteChart(weekChart);

      expect(
        (await Promise.all([...first, ...second, ...afterClose])).map(
          (answer) => answer.status,
        ),
      ).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
      expect(harness.planner.calls).toHaveLength(1);
      expect(harness.received).toEqual([]);
      expect(harness.observed).toHaveLength(observedBeforeClose);
      expect(harness.notes).toEqual([]);
    },
  );

  test('close answers the goals of a change awaiting acknowledgement cancelled', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.queue.close();

    expect(await answer).toEqual({
      status: 'cancelled',
      summary: 'cancelled: "Show order 1.1"',
      changeId: change.changeId,
    });
    expect(harness.notes).toEqual([]);
  });

  test('close from inside the acknowledgement timeout error listener answers the goals cancelled with the change id', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.events.subscribe((event) => {
      if (event.type === 'error' && event.code === 'ui_ack_timeout')
        harness.queue.close();
    });
    const [answer] = harness.queue.request(screenChange(1));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(await answer).toEqual({
      status: 'cancelled',
      summary: 'cancelled: "Show order 1.1"',
      changeId: change.changeId,
    });
  });

  test('close while a Screen Change is planning answers cancelled without a change id', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));

    harness.queue.close();

    expect(await answer).toEqual({
      status: 'cancelled',
      summary: 'cancelled: "Show order 1.1"',
    });
  });

  test('a Screen Change whose requested observer closes the queue answers cancelled and is never planned', async () => {
    let close = () => {};
    const harness = createHarness({
      onRunDiagnostic: (kind) => {
        if (kind === 'engine.agent.screen_change.requested') close();
      },
    });
    close = () => harness.queue.close();
    harness.queue.noteChart(monthChart);

    const answers = harness.queue.request(screenChange(1, 1, 2));

    expect(await Promise.all(answers)).toEqual([
      { status: 'cancelled', summary: 'cancelled: "Show order 1.1"' },
      { status: 'cancelled', summary: 'cancelled: "Show order 1.2"' },
    ]);
    expect(harness.planner.calls).toHaveLength(0);
  });

  test('after an acknowledgement timeout a response that changes nothing answers unknown until a fresh Chart confirms the screen', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    const [unconfirmed] = harness.queue.request(screenChange(2));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    harness.planner.respond(1, noScreenChange(monthChart));

    expect(await unconfirmed).toEqual({
      status: 'unknown',
      summary: 'unknown (the screen did not confirm): "Show order 2.1"',
    });
    expect(uiChangesIn(harness.received)).toHaveLength(1);

    harness.queue.noteChart(weekChart);
    const [confirmed] = harness.queue.request(screenChange(3));
    harness.planner.respond(2, noScreenChange(weekChart));

    expect(await confirmed).toEqual({
      status: 'applied',
      summary: 'applied (already on screen): "Show order 3.1"',
    });
  });

  test('an acknowledged change confirms the screen again after an acknowledgement timeout', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);
    const secondChange = harness.nextUiChange();
    harness.planner.respond(1, changeResponse(monthChart));
    harness.queue.acknowledge(
      applied((await secondChange).changeId, weekChart, [{ ok: true }]),
    );

    const [answer] = harness.queue.request(screenChange(3));
    harness.planner.respond(2, noScreenChange(weekChart));

    expect(await answer).toEqual({
      status: 'applied',
      summary: 'applied (already on screen): "Show order 3.1"',
    });
  });

  test('after an acknowledgement timeout a clarification that sends nothing keeps its question and omits onScreen', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    const [answer] = harness.queue.request(screenChange(2));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    harness.planner.outcome(1, {
      type: 'needs_clarification',
      question: 'Which order do you mean?',
    });

    expect(await answer).toEqual({
      status: 'needs_clarification',
      summary: 'needs clarification: "Show order 2.1"',
      question: 'Which order do you mean?',
    });
  });

  test('a Chart noted from inside the acknowledgement timeout error listener confirms the screen', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.events.subscribe((event) => {
      if (event.type === 'error' && event.code === 'ui_ack_timeout')
        harness.queue.noteChart(weekChart);
    });
    harness.queue.request(screenChange(1));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    const [answer] = harness.queue.request(screenChange(2));
    harness.planner.respond(1, noScreenChange(weekChart));

    expect(await answer).toEqual({
      status: 'applied',
      summary: 'applied (already on screen): "Show order 2.1"',
    });
  });

  test('a change whose emitted observer closes the queue answers cancelled without a change id and never reaches the wire', async () => {
    let close = () => {};
    const harness = createHarness({
      onRunDiagnostic: (kind) => {
        if (kind === 'engine.agent.ui_change.emitted') close();
      },
    });
    close = () => harness.queue.close();
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));

    harness.planner.respond(0, changeResponse(monthChart));

    expect(await answer).toEqual({
      status: 'cancelled',
      summary: 'cancelled: "Show order 1.1"',
    });
    expect(uiChangesIn(harness.received)).toEqual([]);
    expect(harness.time.pending()).toBe(0);
  });

  test('a change whose emitted observer drops its run answers cancelled, never reaches the wire and lets the next Screen Change plan', async () => {
    let drop = () => {};
    const harness = createHarness({
      onRunDiagnostic: (kind) => {
        if (kind === 'engine.agent.ui_change.emitted') drop();
      },
    });
    drop = () => harness.queue.dropRun(screenChange(1).runId);
    harness.queue.noteChart(monthChart);
    const [answer] = harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));

    harness.planner.respond(0, changeResponse(monthChart));

    expect(await answer).toEqual({
      status: 'cancelled',
      summary: 'cancelled: "Show order 1.1"',
    });
    expect(uiChangesIn(harness.received)).toEqual([]);
    expect(harness.notes).toEqual([]);
    expect(harness.planner.calls).toHaveLength(2);
  });

  test('a settled observer that closes the queue stops the late note of a stopped run', async () => {
    let close = () => {};
    const harness = createHarness({
      onRunDiagnostic: (kind) => {
        if (kind === 'engine.agent.screen_change.settled') close();
      },
    });
    close = () => harness.queue.close();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();
    harness.queue.dropRun(screenChange(1).runId);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    expect((await Promise.all(answers)).map((answer) => answer.status)).toEqual(
      ['applied', 'applied'],
    );
    expect(harness.notes).toEqual([]);
  });

  test('close resolves idle waiters and ignores a later dropRun', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
    const idle = trackSettled(harness.queue.whenIdle());
    const observedBeforeClose = harness.observed.length;

    harness.queue.close();
    harness.queue.dropRun(screenChange(1).runId);
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
    expect(
      await trackSettled(harness.queue.whenIdle()).promise,
    ).toBeUndefined();
    expect(harness.notes).toEqual([]);
    expect(harness.observed).toHaveLength(observedBeforeClose);
  });

  test('whenIdle resolves at once when nothing is queued, planning or awaiting acknowledgement', async () => {
    const harness = createHarness();

    const idle = trackSettled(harness.queue.whenIdle());
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
  });

  test('whenIdle waits through planning and acknowledgement of every queued Screen Change', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
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

    harness.planner.respond(1, noScreenChange(weekChart));
    await flushMicrotasks();
    expect(first.settled).toBe(true);
    expect(second.settled).toBe(true);
  });

  test('whenIdle resolves when the acknowledgement timeout ends the last Screen Change', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
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

  test('whenIdle resolves when a failed Screen Change ends the last Screen Change', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.time.advance(SCREEN_CHANGE_PLANNING_TIMEOUT_MS);
    await flushMicrotasks();

    expect(idle.settled).toBe(true);
  });

  test('dropRun aborts the run planning Screen Change and answers it and its queued Screen Changes cancelled with diagnostics and no note while other runs move on', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const planning = harness.queue.request(screenChange(1, 1));
    harness.queue.request(screenChange(2, 2));
    const queued = harness.queue.request(screenChange(3, 1));
    const { signal } = harness.planner.input(0);

    harness.queue.dropRun(screenChange(1, 1).runId);

    expect(signal.aborted).toBe(true);
    expect(await Promise.all([...planning, ...queued])).toEqual([
      { status: 'cancelled', summary: 'cancelled: "Show order 1.1"' },
      { status: 'cancelled', summary: 'cancelled: "Show order 3.1"' },
    ]);
    expect(harness.notes).toEqual([]);
    expect(
      harness.observed.filter(
        ({ kind }) => kind !== 'engine.agent.screen_change.requested',
      ),
    ).toEqual([
      {
        runId: screenChange(1, 1).runId,
        inputId: screenChange(1, 1).inputId,
        kind: 'engine.agent.screen_change.cancelled',
        metadata: {
          turnId: screenChange(1, 1).turnId,
          changeId: expect.any(String),
        },
        readContent: undefined,
      },
      {
        runId: screenChange(1, 1).runId,
        inputId: screenChange(1, 1).inputId,
        kind: 'engine.agent.screen_change.settled',
        metadata: {
          turnId: screenChange(1, 1).turnId,
          callId: 'call-1-1',
          reasonId: 'r1',
          status: 'cancelled',
        },
        readContent: undefined,
      },
      {
        runId: screenChange(3, 1).runId,
        inputId: screenChange(3, 1).inputId,
        kind: 'engine.agent.screen_change.cancelled',
        metadata: { turnId: screenChange(3, 1).turnId },
        readContent: undefined,
      },
      {
        runId: screenChange(3, 1).runId,
        inputId: screenChange(3, 1).inputId,
        kind: 'engine.agent.screen_change.settled',
        metadata: {
          turnId: screenChange(3, 1).turnId,
          callId: 'call-3-1',
          reasonId: 'r1',
          status: 'cancelled',
        },
        readContent: undefined,
      },
    ]);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).owner.runId).toBe(screenChange(2, 2).runId);
    expect(harness.time.pending()).toBe(1);

    harness.planner.respond(0, changeResponse(monthChart));
    harness.planner.respond(1, changeResponse(monthChart));
    const change = await harness.nextUiChange();

    expect(change.runId).toBe(screenChange(2, 2).runId);
    expect(harness.received).toEqual([change]);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.notes).toEqual([]);
  });

  test('observes failed, settled and cancelled outcomes under Screen Change kinds only', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
    harness.queue.request(screenChange(3));
    harness.queue.request(screenChange(4));

    harness.planner.throws(0, new Error('planner failed'));
    await harness.planner.nextCall();
    harness.planner.respond(1, noScreenChange(monthChart));
    await harness.planner.nextCall();
    harness.queue.dropRun(screenChange(3).runId);
    harness.queue.close();

    const kinds = harness.observed.map((entry) => entry.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'engine.agent.screen_change.requested',
        'engine.agent.screen_change.failed',
        'engine.agent.screen_change.settled',
        'engine.agent.screen_change.cancelled',
      ]),
    );
    expect(kinds).not.toContain('engine.agent.screen_change.skipped');
    expect(
      kinds.filter((kind) => kind.startsWith('engine.agent.show.')),
    ).toEqual([]);
  });

  test('dropRun keeps the run change already emitted awaiting its acknowledgement and records one late note per goal when it settles', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const sent = harness.queue.request(screenChange(1, 1, 2));
    const queued = harness.queue.request(screenChange(2, 1));
    harness.queue.request(screenChange(3, 3));
    harness.planner.respond(0, changeResponse(monthChart));
    const change = await harness.nextUiChange();
    const sentAnswers = sent.map((answer) => trackSettled(answer));

    harness.queue.dropRun(screenChange(1, 1).runId);

    expect((await queued[0])?.status).toBe('cancelled');
    expect(sentAnswers.map((answer) => answer.settled)).toEqual([false, false]);
    expect(harness.notes).toEqual([]);
    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.time.pending()).toBe(1);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    expect(harness.errors()).toEqual([]);
    expect((await Promise.all(sent)).map((answer) => answer.status)).toEqual([
      'applied',
      'applied',
    ]);
    expect(harness.notes).toEqual([
      {
        runId: screenChange(1, 1).runId,
        turnId: screenChange(1, 1).turnId,
        text: `${LATE_NOTE_PREFIX}applied: "Show order 1.1"`,
      },
      {
        runId: screenChange(1, 1).runId,
        turnId: screenChange(1, 1).turnId,
        text: `${LATE_NOTE_PREFIX}applied: "Show order 1.2"`,
      },
    ]);
    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).owner.runId).toBe(screenChange(3, 3).runId);
  });

  test('a sent change of a dropped run that times out records one late note with the unknown summary', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    harness.queue.dropRun(screenChange(1).runId);

    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(harness.notes).toEqual([
      {
        runId: screenChange(1).runId,
        turnId: screenChange(1).turnId,
        text: `${LATE_NOTE_PREFIX}unknown (the screen did not confirm): "Show order 1.1"`,
      },
    ]);
  });

  test('dropRun of a run without Screen Changes leaves the queue untouched', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));

    harness.queue.dropRun(RunId('another-run'));

    expect(harness.planner.input(0).signal.aborted).toBe(false);
    expect(harness.notes).toEqual([]);
    harness.planner.respond(0, changeResponse(monthChart));
    expect((await harness.nextUiChange()).runId).toBe(screenChange(1).runId);
  });

  test('close cancels the acknowledgement timer and ignores a later acknowledgement', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
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

  test('a Screen Change requested from inside the error listener of a failed Screen Change is planned and keeps whenIdle waiting', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    let requested: readonly Promise<ScreenChangeResult>[] = [];
    harness.events.subscribe((event) => {
      if (
        event.type === 'error' &&
        event.runId === screenChange(1).runId &&
        requested.length === 0
      )
        requested = harness.queue.request(screenChange(2));
    });
    const [first] = harness.queue.request(screenChange(1));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.planner.fail(0, providerError('provider detail', 'provider'));
    await flushMicrotasks();

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).owner.runId).toBe(screenChange(2).runId);
    expect(idle.settled).toBe(false);
    expect((await first)?.status).toBe('failed');

    const nextChange = harness.nextUiChange();
    harness.planner.respond(1, changeResponse(monthChart));
    const change = await nextChange;
    expect(change.runId).toBe(screenChange(2).runId);

    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );
    await flushMicrotasks();
    expect(idle.settled).toBe(true);
    expect((await requested[0])?.status).toBe('applied');
    expect(harness.notes).toEqual([]);
  });

  test('a Screen Change requested from inside the error listener of an acknowledgement timeout is planned and keeps whenIdle waiting', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    let requested = false;
    harness.events.subscribe((event) => {
      if (
        event.type === 'error' &&
        event.code === 'ui_ack_timeout' &&
        event.runId === screenChange(1).runId &&
        !requested
      ) {
        requested = true;
        harness.queue.request(screenChange(2));
      }
    });
    harness.queue.request(screenChange(1));
    harness.planner.respond(0, changeResponse(monthChart));
    await harness.nextUiChange();
    const idle = trackSettled(harness.queue.whenIdle());

    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);
    await flushMicrotasks();

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).owner.runId).toBe(screenChange(2).runId);
    expect(idle.settled).toBe(false);

    const nextChange = harness.nextUiChange();
    harness.planner.respond(1, changeResponse(monthChart));
    expect((await nextChange).runId).toBe(screenChange(2).runId);
  });

  test('dropRun from inside the error listener keeps the queued Screen Change of another run', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    let dropped = false;
    harness.events.subscribe((event) => {
      if (
        event.type === 'error' &&
        event.runId === screenChange(1).runId &&
        !dropped
      ) {
        dropped = true;
        harness.queue.dropRun(screenChange(1).runId);
      }
    });
    harness.queue.request(screenChange(1));
    harness.queue.request(screenChange(2));
    const idle = trackSettled(harness.queue.whenIdle());

    harness.planner.fail(0, providerError('provider detail', 'provider'));
    await flushMicrotasks();

    expect(harness.planner.calls).toHaveLength(2);
    expect(harness.planner.input(1).owner.runId).toBe(screenChange(2).runId);
    expect(idle.settled).toBe(false);

    const nextChange = harness.nextUiChange();
    harness.planner.respond(1, changeResponse(monthChart));
    expect((await nextChange).runId).toBe(screenChange(2).runId);
  });

  test.each([
    {
      failure: 'a failed Planner call',
      code: 'ProviderError',
      end: async (harness: Harness) => {
        harness.planner.fail(0, providerError('provider detail', 'provider'));
        await flushMicrotasks();
      },
    },
    {
      failure: 'an acknowledgement timeout',
      code: 'ui_ack_timeout',
      end: async (harness: Harness) => {
        harness.planner.respond(0, changeResponse(monthChart));
        await harness.nextUiChange();
        harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);
        await flushMicrotasks();
      },
    },
  ])(
    'close from inside the error listener of $failure answers cancelled and records and observes nothing more',
    async ({ code, end }) => {
      const harness = createHarness();
      harness.queue.noteChart(monthChart);
      harness.events.subscribe((event) => {
        if (event.type === 'error' && event.code === code)
          harness.queue.close();
      });
      const first = trackSettled(harness.queue.request(screenChange(1))[0]);
      const second = trackSettled(harness.queue.request(screenChange(2))[0]);

      await end(harness);
      await flushMicrotasks();

      expect(harness.errors()).toHaveLength(1);
      expect(harness.notes).toEqual([]);
      expect([first.settled, second.settled]).toEqual([true, true]);
      expect((await first.promise).status).toBe('cancelled');
      expect((await second.promise).status).toBe('cancelled');
      expect(
        harness.observed.filter(
          ({ kind }) =>
            kind !== 'engine.agent.ui_change.emitted' &&
            kind !== 'engine.agent.screen_change.requested',
        ),
      ).toEqual([]);
      expect(harness.planner.calls).toHaveLength(1);
    },
  );
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

describe('clarification changes and per-goal verdicts', () => {
  const widerLayout: MaelstromResponse['layout'] = {
    type: 'grid',
    positions: [
      {
        instanceId: InstanceId('calendar-main'),
        position: { row: 0, column: 0 },
        size: { width: 8, height: 4 },
      },
    ],
  };
  const question = 'Which order do you mean?';
  const options = ['The latest order', 'The order from last week'];

  test('a clarification with a partial layout sends it as a change and, once acknowledged, answers every goal with the question, options, change id and what the sent layout shows', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      options,
      layout: widerLayout,
    });
    const change = await harness.nextUiChange();
    expect(change.response.layout).toEqual(widerLayout);
    expect(change.response.executionPlan).toEqual([]);
    expect(change.response).not.toHaveProperty('userMessage');
    expect(change.response).not.toHaveProperty('verdicts');
    harness.queue.acknowledge(applied(change.changeId, weekChart, []));

    expect(await Promise.all(answers)).toEqual(
      [1, 2].map((goal) => ({
        status: 'needs_clarification',
        summary: `needs clarification: "Show order 1.${goal}"`,
        changeId: change.changeId,
        question,
        options,
        onScreen: ['calendar'],
      })),
    );
  });

  test('an acknowledgement timeout on a partial clarification without verdicts keeps the question, options and change id and omits onScreen', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      options,
      layout: widerLayout,
    });
    const change = await harness.nextUiChange();
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(await Promise.all(answers)).toEqual(
      [1, 2].map((goal) => ({
        status: 'needs_clarification',
        summary: `needs clarification: "Show order 1.${goal}"`,
        changeId: change.changeId,
        question,
        options,
      })),
    );
  });

  test('a clarification with only an execution plan runs it on the current layout', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    harness.queue.request(screenChange(1));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      executionPlan: changeResponse(monthChart).executionPlan,
    });
    const change = await harness.nextUiChange();

    expect(change.response.layout).toEqual(monthChart.layout);
    expect(change.response.executionPlan).toEqual(
      changeResponse(monthChart).executionPlan,
    );
  });

  test('verdicts give each goal its own result on a partial change: planned is applied and a clarification keeps its own question and the change id, with no onScreen', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      options,
      layout: widerLayout,
      verdicts: [
        { id: 'r1', status: 'planned' },
        {
          id: 'r2',
          status: 'needs_clarification',
          question: 'Which size?',
          options: ['Small', 'Large'],
        },
      ],
    });
    const change = await harness.nextUiChange();
    harness.queue.acknowledge(applied(change.changeId, weekChart, []));

    expect(await Promise.all(answers)).toEqual([
      {
        status: 'applied',
        summary: 'applied: "Show order 1.1"',
        changeId: change.changeId,
      },
      {
        status: 'needs_clarification',
        summary: 'needs clarification: "Show order 1.2"',
        changeId: change.changeId,
        question: 'Which size?',
        options: ['Small', 'Large'],
      },
    ]);
  });

  test('an acknowledgement timeout on a partial change answers planned goals unknown while clarification goals keep their question and the change id', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      layout: widerLayout,
      verdicts: [
        { id: 'r1', status: 'planned' },
        { id: 'r2', status: 'needs_clarification', question: 'Which size?' },
      ],
    });
    const change = await harness.nextUiChange();
    harness.time.advance(ACKNOWLEDGEMENT_TIMEOUT_MS);

    expect(await Promise.all(answers)).toEqual([
      {
        status: 'unknown',
        summary: 'unknown (the screen did not confirm): "Show order 1.1"',
        changeId: change.changeId,
      },
      {
        status: 'needs_clarification',
        summary: 'needs clarification: "Show order 1.2"',
        changeId: change.changeId,
        question: 'Which size?',
      },
    ]);
  });

  test('a plan response with verdicts answers planned goals applied and failed goals failed', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'response',
      response: changeResponse(monthChart),
      verdicts: [
        { id: 'r1', status: 'planned' },
        { id: 'r2', status: 'failed' },
      ],
    });
    const change = await harness.nextUiChange();
    harness.queue.acknowledge(
      applied(change.changeId, weekChart, [{ ok: true }]),
    );

    const [first, second] = await Promise.all(answers);
    expect(first).toEqual({
      status: 'applied',
      summary: 'applied: "Show order 1.1"',
      changeId: change.changeId,
    });
    expect(second?.status).toBe('failed');
    expect(second?.summary).toBe('failed: "Show order 1.2"');
  });

  test('a goal without a verdict takes the top-level outcome, and a clarification with verdicts adds no onScreen', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      verdicts: [{ id: 'r1', status: 'failed' }],
    });

    expect(await Promise.all(answers)).toEqual([
      { status: 'failed', summary: 'failed: "Show order 1.1"' },
      {
        status: 'needs_clarification',
        summary: 'needs clarification: "Show order 1.2"',
        question,
      },
    ]);
    expect(harness.received).toEqual([]);
  });

  test('a planned verdict on a change whose Action failed answers failed with some steps not run', async () => {
    const harness = createHarness();
    harness.queue.noteChart(monthChart);
    const answers = harness.queue.request(screenChange(1, 1, 2));

    harness.planner.outcome(0, {
      type: 'needs_clarification',
      question,
      executionPlan: changeResponse(monthChart).executionPlan,
      verdicts: [{ id: 'r1', status: 'planned' }],
    });
    const change = await harness.nextUiChange();
    harness.queue.acknowledge(
      applied(change.changeId, monthChart, [{ ok: false, error: 'boom' }]),
    );

    const [first, second] = await Promise.all(answers);
    expect(first?.summary).toBe(
      'failed (some steps did not run): "Show order 1.1"',
    );
    expect(second?.status).toBe('needs_clarification');
    expect(second?.changeId).toBe(change.changeId);
  });
});

function createHarness({
  planningTimeoutMs,
  onRunDiagnostic,
}: {
  readonly planningTimeoutMs?: number;
  readonly onRunDiagnostic?: (kind: string) => void;
} = {}) {
  const time = createFakeAgentRunTime();
  const events = createOrderedEmitter<AgentEvent>();
  const received: AgentEvent[] = [];
  const uiChangeWaiters: ((event: AgentUiChangeEvent) => void)[] = [];
  events.subscribe((event) => {
    received.push(event);
    if (event.type === 'ui_change') uiChangeWaiters.shift()?.(event);
  });
  const observed: Observation[] = [];
  const sessionObserved: {
    readonly kind: string;
    readonly metadata: DiagnosticMetadata;
  }[] = [];
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
  const queue = createScreenChangeQueue({
    planner: planner.plan,
    events,
    diagnostics: {
      run: (runId, inputId, kind, metadata, readContent) => {
        observed.push({ runId, inputId, kind, metadata, readContent });
        onRunDiagnostic?.(kind);
      },
      session: (kind, metadata) => sessionObserved.push({ kind, metadata }),
    },
    recordScreenNote: (runId, turnId, text) =>
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
    sessionObserved,
    notes,
    logs,
    observedOf: (kind: string) =>
      observed.filter((entry) => entry.kind === kind),
    observedFor: (runId: RunId) =>
      observed.filter((entry) => entry.runId === runId),
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
    readonly input: SessionPlanInput;
    readonly result: Deferred<Result<PlanOutcome, EngineError>>;
  }[] = [];
  const callWaiters: (() => void)[] = [];
  const call = (index: number) => {
    const entry = calls[index];
    if (entry === undefined) throw new Error(`No Planner call ${index}`);
    return entry;
  };
  const outcome = (index: number, value: PlanOutcome) =>
    call(index).result.resolve(ok(value));
  return {
    calls,
    plan: (input: SessionPlanInput) => {
      const result = defer<Result<PlanOutcome, EngineError>>();
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

function screenChange(index: number, run = index, goals = 1): ScreenChangeJob {
  return {
    runId: RunId(`run-${run}`),
    inputId: MessageId(`input-${run}`),
    turnId: `run-${run}:turn-${index}`,
    goals: Array.from({ length: goals }, (_, goal) => ({
      callId: `call-${index}-${goal + 1}`,
      reasonId: `r${goal + 1}`,
      goal: `Show order ${index}.${goal + 1}`,
    })),
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

function noScreenChange(request: ChartRequest): MaelstromResponse {
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

function uiChangesIn(events: readonly AgentEvent[]) {
  return events.filter((event) => event.type === 'ui_change');
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

function trackSettled<T>(promise: Promise<T> | undefined) {
  if (promise === undefined) throw new Error('No answer to track');
  const tracked = { settled: false, promise };
  void promise.then(() => {
    tracked.settled = true;
  });
  return tracked;
}
