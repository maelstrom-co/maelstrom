import { describe, expect, test } from 'bun:test';

import { defer } from '../__test-helpers__/defer.js';
import { createServerToolQueue } from './server-tool-queue.js';

describe('createServerToolQueue', () => {
  test('runs reserved calls one at a time in reservation order, whatever order run is called in', async () => {
    const queue = createServerToolQueue(new AbortController().signal);
    const order: string[] = [];
    const firstGate = defer<void>();
    queue.reserve('call-1');
    queue.reserve('call-2');
    queue.reserve('call-3');

    const third = finishing(queue, 'call-3', async () => {
      order.push('call-3');
      return 3;
    });
    const second = finishing(queue, 'call-2', async () => {
      order.push('call-2');
      return 2;
    });
    const first = finishing(queue, 'call-1', async () => {
      order.push('call-1 started');
      await firstGate.promise;
      order.push('call-1 finished');
      return 1;
    });
    await flushMicrotasks();

    expect(order).toEqual(['call-1 started']);

    firstGate.resolve();

    expect(await Promise.all([first, second, third])).toEqual([
      { type: 'ran', value: 1 },
      { type: 'ran', value: 2 },
      { type: 'ran', value: 3 },
    ]);
    expect(order).toEqual([
      'call-1 started',
      'call-1 finished',
      'call-2',
      'call-3',
    ]);
  });

  test('holds the slot after execute resolves until finish frees it', async () => {
    const queue = createServerToolQueue(new AbortController().signal);
    let secondExecuted = false;
    queue.reserve('call-1');
    queue.reserve('call-2');

    expect(await queue.run('call-1', async () => 'first')).toEqual({
      type: 'ran',
      value: 'first',
    });
    const second = queue.run('call-2', async () => {
      secondExecuted = true;
    });
    await flushMicrotasks();

    expect(secondExecuted).toBe(false);

    queue.finish('call-1');
    await second;

    expect(secondExecuted).toBe(true);
  });

  test('a call that throws frees its slot for the next one', async () => {
    const queue = createServerToolQueue(new AbortController().signal);
    queue.reserve('call-1');
    queue.reserve('call-2');

    const first = queue.run('call-1', () => Promise.reject(new Error('boom')));
    const second = queue.run('call-2', async () => 'second');

    const [firstOutcome, secondOutcome] = await Promise.allSettled([
      first,
      second,
    ]);

    expect(firstOutcome).toMatchObject({ status: 'rejected' });
    expect(secondOutcome).toEqual({
      status: 'fulfilled',
      value: { type: 'ran', value: 'second' },
    });
  });

  test('a call run without a reservation takes the next slot', async () => {
    const queue = createServerToolQueue(new AbortController().signal);
    const gate = defer<void>();
    const order: string[] = [];
    queue.reserve('call-1');

    const first = finishing(queue, 'call-1', async () => {
      await gate.promise;
      order.push('call-1');
    });
    const unreserved = finishing(queue, 'call-2', async () => {
      order.push('call-2');
    });
    gate.resolve();
    await Promise.all([first, unreserved]);

    expect(order).toEqual(['call-1', 'call-2']);
  });

  test('reserving a call twice keeps its first slot', async () => {
    const queue = createServerToolQueue(new AbortController().signal);
    const order: string[] = [];
    queue.reserve('call-1');
    queue.reserve('call-1');
    queue.reserve('call-2');
    const idle = queue.whenIdle();

    const second = queue.run('call-2', async () => {
      order.push('call-2');
    });
    const first = queue.run('call-1', async () => {
      order.push('call-1');
    });
    await first;
    queue.finish('call-1');
    await second;

    expect(order).toEqual(['call-1', 'call-2']);
    expect(await settledWithin(idle)).toBe(false);

    queue.finish('call-2');

    expect(await settledWithin(idle)).toBe(true);
  });

  test('finish ignores a call with no slot', async () => {
    const queue = createServerToolQueue(new AbortController().signal);

    queue.finish('unknown');

    expect(await settledWithin(queue.whenIdle())).toBe(true);
  });

  test('an abort releases waiting calls without executing them and releases every slot', async () => {
    const controller = new AbortController();
    const queue = createServerToolQueue(controller.signal);
    const gate = defer<void>();
    let secondExecuted = false;
    queue.reserve('call-1');
    queue.reserve('call-2');
    queue.reserve('call-3');

    const first = queue.run('call-1', async () => {
      await gate.promise;
      return 'first';
    });
    const second = queue.run('call-2', async () => {
      secondExecuted = true;
    });
    await flushMicrotasks();
    controller.abort();

    expect(await second).toEqual({ type: 'released' });
    expect(secondExecuted).toBe(false);
    expect(await queue.run('call-3', async () => 'late')).toEqual({
      type: 'released',
    });
    expect(await settledWithin(queue.whenIdle())).toBe(true);
    gate.resolve();
    expect(await first).toEqual({ type: 'ran', value: 'first' });
  });

  test('a call run after the signal already aborted is released', async () => {
    const controller = new AbortController();
    controller.abort();
    const queue = createServerToolQueue(controller.signal);
    let executed = false;
    queue.reserve('call-1');

    expect(
      await queue.run('call-1', async () => {
        executed = true;
      }),
    ).toEqual({ type: 'released' });
    expect(executed).toBe(false);
  });

  describe('whenIdle', () => {
    test('resolves at once with no slots', async () => {
      const queue = createServerToolQueue(new AbortController().signal);

      expect(await settledWithin(queue.whenIdle())).toBe(true);
    });

    test('waits while slots are reserved, running or unfinished, then resolves once every slot is freed', async () => {
      const queue = createServerToolQueue(new AbortController().signal);
      const gate = defer<void>();
      queue.reserve('call-1');
      queue.reserve('call-2');
      const idle = queue.whenIdle();

      expect(await settledWithin(idle)).toBe(false);

      const first = queue.run('call-1', () => gate.promise);
      gate.resolve();
      await first;

      expect(await settledWithin(idle)).toBe(false);

      queue.finish('call-1');
      await queue.run('call-2', async () => undefined);

      expect(await settledWithin(idle)).toBe(false);

      queue.finish('call-2');

      expect(await settledWithin(idle)).toBe(true);
    });

    test('resolves once an abort releases slots that never ran', async () => {
      const controller = new AbortController();
      const queue = createServerToolQueue(controller.signal);
      queue.reserve('call-1');
      queue.reserve('call-2');
      const idle = queue.whenIdle();

      expect(await settledWithin(idle)).toBe(false);

      controller.abort();

      expect(await settledWithin(idle)).toBe(true);
    });
  });
});

async function finishing<T>(
  queue: ReturnType<typeof createServerToolQueue>,
  callId: string,
  execute: () => Promise<T>,
) {
  try {
    return await queue.run(callId, execute);
  } finally {
    queue.finish(callId);
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function settledWithin(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await flushMicrotasks();
  return settled;
}
