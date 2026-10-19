import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGreetingBargeInReady } from './greeting-barge-in-gate.ts';

test('greeting readiness starts at 100ms accumulated activity with a 0–30ms quiet tail', () => {
  for (const activeMs of [100, 100.001, 300])
    for (const silentTailMs of [0, 17, 30])
      assert.equal(isGreetingBargeInReady({ activeMs, silentTailMs }), true);
  for (const activeMs of [0, 99, 99.999])
    assert.equal(isGreetingBargeInReady({ activeMs, silentTailMs: 0 }), false);
});

test('stale, negative and nonfinite activity cannot qualify a greeting interruption', () => {
  for (const silentTailMs of [30.001, 31, 195, -1, NaN, Infinity, -Infinity])
    assert.equal(
      isGreetingBargeInReady({ activeMs: 100, silentTailMs }),
      false,
    );
  for (const activeMs of [-1, NaN, Infinity, -Infinity])
    assert.equal(isGreetingBargeInReady({ activeMs, silentTailMs: 0 }), false);
});
