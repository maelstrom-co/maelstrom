import { describe, expect, test } from 'bun:test';

import { defer } from '../__test-helpers__/defer.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import {
  createScreenChangeBatch,
  SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS,
  type ScreenChangeBatchGoal,
} from './screen-change-batch.js';
import type { ScreenChangeResult } from './screen-change-result.js';

function harness(options: { serverToolsIdle?: Promise<void> } = {}) {
  const time = createFakeAgentRunTime();
  const submissions: ScreenChangeBatchGoal[][] = [];
  const answers: ReturnType<typeof defer<ScreenChangeResult>>[][] = [];
  const fillTimeouts: { admitted: number; registered: number }[] = [];
  const batch = createScreenChangeBatch({
    submit: (goals) => {
      submissions.push([...goals]);
      const deferreds = goals.map(() => defer<ScreenChangeResult>());
      answers.push(deferreds);
      return deferreds.map((answer) => answer.promise);
    },
    whenServerToolsIdle: () => options.serverToolsIdle ?? Promise.resolve(),
    scheduleTimeout: time.clock.scheduleTimeout,
    onFillTimeout: (counts) => fillTimeouts.push(counts),
  });
  return { batch, time, submissions, answers, fillTimeouts };
}

const applied: ScreenChangeResult = {
  status: 'applied',
  summary: 'applied: "g"',
};

async function flushMicrotasks() {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

describe('createScreenChangeBatch', () => {
  test('flushes once every admitted call registered, with reason ids in admission order', async () => {
    const { batch, submissions } = harness();
    batch.admit('call-a');
    batch.admit('call-b');
    void batch.register('call-b', 'second goal', undefined);
    await flushMicrotasks();
    expect(submissions).toEqual([]);
    void batch.register('call-a', 'first goal', { orderId: 'o-1' });
    await flushMicrotasks();
    expect(submissions).toEqual([
      [
        {
          callId: 'call-a',
          reasonId: 'r1',
          goal: 'first goal',
          referents: { orderId: 'o-1' },
        },
        { callId: 'call-b', reasonId: 'r2', goal: 'second goal' },
      ],
    ]);
  });

  test('waits for the Server Tools to go idle before it submits', async () => {
    const idle = defer<void>();
    const { batch, submissions } = harness({ serverToolsIdle: idle.promise });
    batch.admit('call-a');
    void batch.register('call-a', 'goal', undefined);
    await flushMicrotasks();
    expect(submissions).toEqual([]);
    idle.resolve();
    await flushMicrotasks();
    expect(submissions).toHaveLength(1);
  });

  test('resolves each registration with its own submitted answer', async () => {
    const { batch, answers } = harness();
    batch.admit('call-a');
    batch.admit('call-b');
    const first = batch.register('call-a', 'a', undefined);
    const second = batch.register('call-b', 'b', undefined);
    await flushMicrotasks();
    answers[0]?.[1]?.resolve({ ...applied, summary: 'second' });
    answers[0]?.[0]?.resolve({ ...applied, summary: 'first' });
    expect((await first).summary).toBe('first');
    expect((await second).summary).toBe('second');
  });

  test('the fill timeout flushes what registered and reports the counts, counted from the first registration', async () => {
    const { batch, time, submissions, fillTimeouts } = harness();
    batch.admit('call-a');
    batch.admit('call-b');
    time.advance(SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS * 3);
    await flushMicrotasks();
    expect(fillTimeouts).toEqual([]);
    void batch.register('call-a', 'a', undefined);
    time.advance(SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS - 1);
    await flushMicrotasks();
    expect(submissions).toEqual([]);
    time.advance(1);
    await flushMicrotasks();
    expect(SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS).toBe(1_000);
    expect(fillTimeouts).toEqual([{ admitted: 2, registered: 1 }]);
    expect(submissions).toEqual([
      [{ callId: 'call-a', reasonId: 'r1', goal: 'a' }],
    ]);
  });

  test('a fill timeout does not cover Server Tool time', async () => {
    const idle = defer<void>();
    const { batch, time, submissions, fillTimeouts } = harness({
      serverToolsIdle: idle.promise,
    });
    batch.admit('call-a');
    void batch.register('call-a', 'a', undefined);
    time.advance(SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS * 5);
    await flushMicrotasks();
    expect(fillTimeouts).toEqual([]);
    expect(submissions).toEqual([]);
    idle.resolve();
    await flushMicrotasks();
    expect(submissions).toHaveLength(1);
  });

  test('a registration after the flush starts a new submission', async () => {
    const { batch, time, submissions } = harness();
    batch.admit('call-a');
    batch.admit('call-b');
    void batch.register('call-a', 'a', undefined);
    time.advance(SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS);
    await flushMicrotasks();
    void batch.register('call-b', 'b', undefined);
    await flushMicrotasks();
    expect(submissions).toEqual([
      [{ callId: 'call-a', reasonId: 'r1', goal: 'a' }],
      [{ callId: 'call-b', reasonId: 'r2', goal: 'b' }],
    ]);
  });

  test('a call admitted but never registered resolves nothing and holds nothing once the rest flushed', async () => {
    const { batch, time, submissions } = harness();
    batch.admit('call-a');
    batch.admit('never');
    const registered = batch.register('call-a', 'a', undefined);
    time.advance(SCREEN_CHANGE_BATCH_FILL_TIMEOUT_MS);
    await flushMicrotasks();
    expect(submissions).toHaveLength(1);
    expect(time.pending()).toBe(0);
    expect(registered).toBeInstanceOf(Promise);
  });

  test('cancelUnsent answers unsent registrations cancelled and nothing is submitted afterwards', async () => {
    const idle = defer<void>();
    const { batch, submissions } = harness({ serverToolsIdle: idle.promise });
    batch.admit('call-a');
    const pending = batch.register('call-a', 'show order o-1', undefined);
    batch.cancelUnsent();
    expect(await pending).toEqual({
      status: 'cancelled',
      summary: 'cancelled: "show order o-1"',
    });
    idle.resolve();
    await flushMicrotasks();
    expect(submissions).toEqual([]);
    batch.admit('late');
    const late = batch.register('late', 'late goal', undefined);
    expect((await late).status).toBe('cancelled');
    expect(submissions).toEqual([]);
  });

  test('cancelUnsent leaves a submitted registration to its answer', async () => {
    const { batch, answers } = harness();
    batch.admit('call-a');
    const sent = batch.register('call-a', 'a', undefined);
    await flushMicrotasks();
    batch.cancelUnsent();
    answers[0]?.[0]?.resolve(applied);
    expect(await sent).toEqual(applied);
  });

  test('isSent tells a submitted registration from an unsent one', async () => {
    const idle = defer<void>();
    const { batch } = harness({ serverToolsIdle: idle.promise });
    batch.admit('call-a');
    void batch.register('call-a', 'a', undefined);
    expect(batch.isSent('call-a')).toBe(false);
    idle.resolve();
    await flushMicrotasks();
    expect(batch.isSent('call-a')).toBe(true);
  });
});
