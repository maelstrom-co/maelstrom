import { describe, expect, it } from 'bun:test';

import { scheduleGlobalTimeout } from './connection.js';

function recordingTimers() {
  const steps: { callback: () => void; ms: number; cleared: boolean }[] = [];
  return {
    steps,
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        const step = { callback, ms, cleared: false };
        steps.push(step);
        return step;
      },
      clearTimeout: (handle: { cleared: boolean }) => {
        handle.cleared = true;
      },
    },
  };
}

describe('scheduleGlobalTimeout', () => {
  it('waits the full delay when it exceeds the platform timer limit', () => {
    const { steps, timers } = recordingTimers();
    let calls = 0;
    scheduleGlobalTimeout(() => calls++, 3_000_000_000, timers);
    expect(steps.map((s) => s.ms)).toEqual([2_147_483_647]);
    steps[0].callback();
    expect(calls).toBe(0);
    expect(steps.map((s) => s.ms)).toEqual([2_147_483_647, 852_516_353]);
    steps[1].callback();
    expect(calls).toBe(1);
    expect(steps).toHaveLength(2);
  });

  it('cancelling between steps prevents the callback', () => {
    const { steps, timers } = recordingTimers();
    let calls = 0;
    const cancel = scheduleGlobalTimeout(() => calls++, 3_000_000_000, timers);
    steps[0].callback();
    cancel();
    expect(steps[1].cleared).toBe(true);
    expect(calls).toBe(0);
  });

  it('a non-finite delay never schedules', () => {
    const { steps, timers } = recordingTimers();
    const cancel = scheduleGlobalTimeout(() => undefined, Infinity, timers);
    cancel();
    expect(steps).toHaveLength(0);
  });
});
