import { expect, test } from 'bun:test';
import { finishTrialCleanup } from './trial-runtime';

const failure = (code: string) =>
  Object.assign(new Error(`synthetic ${code}`), { code });

test('a late denial is accepted only after the retained group becomes absent', async () => {
  const denial = failure('EPERM');
  const calls: [number, NodeJS.Signals | 0][] = [];
  let probes = 0;
  await finishTrialCleanup(-42, (target, signal) => {
    calls.push([target, signal]);
    if (signal === 'SIGKILL') throw denial;
    if (++probes === 1) throw denial;
    throw failure('ESRCH');
  });
  expect(calls).toEqual([
    [-42, 'SIGKILL'],
    [-42, 0],
    [-42, 0],
  ]);
});

test.each([
  'denied',
  'present',
])('an unproved %s group preserves the original cleanup failure', async (state) => {
  const denial = failure('EPERM');
  await expect(
    finishTrialCleanup(-42, (_target, signal) => {
      if (signal === 'SIGKILL' || state === 'denied') throw denial;
      return true;
    }),
  ).rejects.toBe(denial);
});

test('an unknown liveness probe never proves cleanup', async () => {
  const denial = failure('EPERM');
  await expect(
    finishTrialCleanup(-42, (_target, signal) => {
      throw signal === 'SIGKILL' ? denial : failure('EIO');
    }),
  ).rejects.toBe(denial);
});

test('an already absent target needs no further signals', async () => {
  let calls = 0;
  await finishTrialCleanup(42, () => {
    calls++;
    throw failure('ESRCH');
  });
  expect(calls).toBe(1);
});

test('other signal failures remain failures', async () => {
  const error = failure('EIO');
  await expect(
    finishTrialCleanup(-42, () => {
      throw error;
    }),
  ).rejects.toBe(error);
});

test.each([
  0,
  1,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
])('invalid target %d is rejected without sending a signal', async (target) => {
  let calls = 0;
  await expect(
    finishTrialCleanup(target, () => {
      calls++;
      return true;
    }),
  ).rejects.toBeInstanceOf(RangeError);
  expect(calls).toBe(0);
});
