import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BargeInPlaybackEvent } from './barge-in-observer.ts';
import {
  sampleTaskBargeInGate,
  taskBargeInMinimumActiveMs,
} from './task-barge-in-gate.ts';

const started = (
  frame: number,
  responseId: string | null,
): BargeInPlaybackEvent => ({
  type: 'output_audio_buffer.started',
  frame,
  responseId,
  status: null,
});
const args = { primerFrame: 100, minimumActiveMs: 50, maximumQuietMs: 30 };

async function fixture(
  check: (state: {
    events: BargeInPlaybackEvent[];
    activities: { activeMs: number; silentTailMs: number }[];
    frames: number[];
    marked: number;
    afterMark?: () => void;
  }) => Promise<void>,
) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const state = {
    events: [started(80, 'greeting'), started(150, 'task')],
    activities: [
      { activeMs: 50, silentTailMs: 0 },
      { activeMs: 60, silentTailMs: 0 },
    ],
    frames: [] as number[],
    marked: 0,
    afterMark: undefined as (() => void) | undefined,
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __voiceBargeInObserver: {
        snapshot: () => ({ events: [...state.events], dropped: 0 }),
      },
      __voiceAudioTimeline: {
        assistantMonitor: async (frame: number) => {
          state.frames.push(frame);
          return {
            ...(state.activities.shift() ?? { activeMs: 60, silentTailMs: 0 }),
            currentFrame: 210,
            lastActiveFrame: 210,
          };
        },
        mark: async () => {
          state.marked++;
          state.afterMark?.();
          return 200;
        },
      },
    },
  });
  try {
    await check(state);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('targets only an identified response after the primer and rechecks it after marking', async () => {
  await fixture(async (state) => {
    state.events.push({
      type: 'response.done',
      frame: 180,
      responseId: 'task',
      status: 'completed',
    });
    const sample = await sampleTaskBargeInGate(args);
    assert.equal(sample?.responseId, 'task');
    assert.equal(sample?.playbackMarkerFrame, 200);
    assert.equal(sample?.observedFrame, 210);
    assert.deepEqual(state.frames, [150, 150]);
    assert.equal(state.marked, 1);
  });
});

test('an old greeting, unidentified new output, or stopped output cannot qualify injection', async () => {
  for (const events of [
    [started(80, 'old')],
    [started(150, 'task'), started(170, null)],
    [
      started(150, 'task'),
      {
        type: 'output_audio_buffer.stopped' as const,
        frame: 180,
        responseId: 'task',
        status: null,
      },
    ],
  ])
    await fixture(async (state) => {
      state.events = events;
      assert.equal(await sampleTaskBargeInGate(args), null);
      assert.equal(state.marked, 0);
    });
});

test('stale speech or a changed response after the marker returns to waiting without launching', async () => {
  await fixture(async (state) => {
    state.activities[1] = { activeMs: 60, silentTailMs: 80 };
    assert.equal(await sampleTaskBargeInGate(args), null);
    assert.equal(state.marked, 1);
  });
  await fixture(async (state) => {
    state.afterMark = () => state.events.push(started(190, 'replacement'));
    assert.equal(await sampleTaskBargeInGate(args), null);
  });
});

test('task readiness accepts 100ms on both checks and rejects less activity', async () => {
  const taskArgs = {
    ...args,
    minimumActiveMs: taskBargeInMinimumActiveMs,
  };
  await fixture(async (state) => {
    state.activities[0] = { activeMs: 100, silentTailMs: 30 };
    state.activities[1] = { activeMs: 100, silentTailMs: 0 };
    assert.equal((await sampleTaskBargeInGate(taskArgs))?.responseId, 'task');
    assert.equal(state.marked, 1);
  });
  for (const activityIndex of [0, 1])
    await fixture(async (state) => {
      if (activityIndex === 1)
        state.activities[0] = { activeMs: 100, silentTailMs: 0 };
      state.activities[activityIndex] = {
        activeMs: 99.999,
        silentTailMs: 0,
      };
      assert.equal(await sampleTaskBargeInGate(taskArgs), null);
      assert.equal(state.marked, activityIndex === 0 ? 0 : 1);
    });
});

test('insufficient speech and invalid quiet-tail observations never qualify', async () => {
  for (const activity of [
    { activeMs: 40, silentTailMs: 0 },
    { activeMs: 50, silentTailMs: -1 },
    { activeMs: Number.NaN, silentTailMs: 0 },
  ])
    await fixture(async (state) => {
      state.activities[0] = activity;
      assert.equal(await sampleTaskBargeInGate(args), null);
      assert.equal(state.marked, 0);
    });
});
