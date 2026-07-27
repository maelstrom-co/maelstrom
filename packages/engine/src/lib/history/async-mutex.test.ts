import { describe, expect, test } from 'bun:test';
import { defer } from '../__test-helpers__/defer.js';
import { createAsyncMutex } from './async-mutex.js';

describe('createAsyncMutex', () => {
  test('returns the value produced by the critical section', async () => {
    const mutex = createAsyncMutex();
    const result = await mutex.run(async () => 42);
    expect(result).toBe(42);
  });

  test('serializes concurrent critical sections', async () => {
    const mutex = createAsyncMutex();
    const order: string[] = [];
    const firstGate = defer<void>();
    const secondGate = defer<void>();

    const firstDone = mutex.run(async () => {
      order.push('first:enter');
      await firstGate.promise;
      order.push('first:exit');
    });
    const secondDone = mutex.run(async () => {
      order.push('second:enter');
      await secondGate.promise;
      order.push('second:exit');
    });

    // Yield once so both callers have started queueing.
    await Promise.resolve();

    // The second critical section must not have run yet — serialized behind the first.
    expect(order).toEqual(['first:enter']);

    firstGate.resolve();
    await firstDone;
    expect(order).toEqual(['first:enter', 'first:exit', 'second:enter']);

    secondGate.resolve();
    await secondDone;
    expect(order).toEqual([
      'first:enter',
      'first:exit',
      'second:enter',
      'second:exit',
    ]);
  });

  test('releases the lock when the critical section throws', async () => {
    const mutex = createAsyncMutex();
    const first = mutex.run(async () => {
      throw new Error('boom');
    });
    await expect(first).rejects.toThrow('boom');

    // Subsequent run must still execute — lock not stuck.
    const result = await mutex.run(async () => 'after-throw');
    expect(result).toBe('after-throw');
  });

  test('preserves FIFO order across many pending runs', async () => {
    const mutex = createAsyncMutex();
    const observed: number[] = [];
    const promises = Array.from({ length: 10 }, (_, i) =>
      mutex.run(async () => {
        observed.push(i);
      }),
    );
    await Promise.all(promises);
    expect(observed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
