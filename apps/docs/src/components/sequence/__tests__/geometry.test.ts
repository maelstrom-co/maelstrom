import { describe, expect, it } from 'bun:test';
import {
  LANE_PADDING,
  LANE_WIDTH,
  labelPoint,
  laneX,
  SELF_LOOP_HEIGHT,
  SELF_LOOP_LABEL_REACH,
  SELF_LOOP_WIDTH,
  STEP_GAP,
  stageFor,
  stepNumbers,
  stepPath,
  stepY,
} from '../geometry';
import { LIVEKIT_BARGE_IN } from '../livekit-barge-in';
import type { SequenceModel } from '../types';

const MODELS: readonly (readonly [string, SequenceModel])[] = [
  ['LiveKit barge-in', LIVEKIT_BARGE_IN],
] as const;

describe('stepNumbers', () => {
  it('gives concurrent steps the same number', () => {
    // Three things happen at one instant during a barge-in. Numbering them
    // 3, 4, 5 would tell the reader to expect two delays that do not exist.
    const numbers = stepNumbers([
      { id: 'a', from: 'x', to: 'y', kind: 'intent', label: 'a' },
      { id: 'b', from: 'x', to: 'y', kind: 'halt', label: 'b' },
      {
        id: 'c',
        from: 'x',
        to: 'y',
        kind: 'halt',
        label: 'c',
        withPrevious: true,
      },
      {
        id: 'd',
        from: 'x',
        to: 'y',
        kind: 'halt',
        label: 'd',
        withPrevious: true,
      },
      { id: 'e', from: 'x', to: 'y', kind: 'media', label: 'e' },
    ]);
    expect(numbers).toEqual([1, 2, 2, 2, 3]);
  });

  it('never lets a leading withPrevious produce a zero', () => {
    // Nothing precedes the first step, so it starts the count regardless.
    expect(
      stepNumbers([
        {
          id: 'a',
          from: 'x',
          to: 'y',
          kind: 'intent',
          label: 'a',
          withPrevious: true,
        },
      ]),
    ).toEqual([1]);
  });
});

describe('stepPath', () => {
  it('draws a participant acting on itself as a loop, not a point', () => {
    // A zero-length line renders as nothing, so the step would vanish from the
    // drawing while still being counted in the text alternative.
    const path = stepPath(100, 100, 50);
    expect(path.d).toContain('L174.0,50.0');
    expect(path.anchor).toBe('start');
    expect(path.labelX).toBeGreaterThan(100 + SELF_LOOP_WIDTH);
  });

  it('centres a label between two lifelines', () => {
    const path = stepPath(100, 300, 50);
    expect(path.labelX).toBe(200);
    expect(path.anchor).toBe('middle');
  });
});

describe.each(MODELS)('the %s sequence', (_name, model) => {
  const ids = new Set(model.participants.map((p) => p.id));

  it('connects every step to participants that exist', () => {
    for (const step of model.steps) {
      expect(ids.has(step.from)).toBe(true);
      expect(ids.has(step.to)).toBe(true);
    }
  });

  it('gives every step and participant a distinct id', () => {
    expect(new Set(model.steps.map((s) => s.id)).size).toBe(model.steps.length);
    expect(ids.size).toBe(model.participants.length);
  });

  it('keeps every step inside the stage', () => {
    // An over-long sequence leaves the viewBox instead of failing: the SVG
    // scales to its container, so the tail is simply cropped and no reader can
    // tell the drawing is incomplete.
    const stage = stageFor(model);
    for (const [index] of model.steps.entries()) {
      expect(stepY(index)).toBeGreaterThan(0);
      expect(stepY(index) + SELF_LOOP_HEIGHT).toBeLessThanOrEqual(stage.h);
    }
    for (const [index] of model.participants.entries()) {
      expect(laneX(index)).toBeGreaterThan(0);
      expect(laneX(index)).toBeLessThan(stage.w);
    }
  });

  it('keeps a self-loop clear of the next lifeline', () => {
    // The loop reaches right from its own lifeline. If it reached past the next
    // one, the drawing would show a participant acting on its neighbour.
    for (const step of model.steps) {
      if (step.from !== step.to) continue;
      const lane = model.participants.findIndex((p) => p.id === step.from);
      expect(lane).toBeGreaterThanOrEqual(0);
      expect(SELF_LOOP_WIDTH).toBeLessThan(LANE_WIDTH / 2);
      if (lane < model.participants.length - 1) {
        expect(laneX(lane) + SELF_LOOP_WIDTH).toBeLessThan(laneX(lane + 1));
      }
    }
  });

  it('keeps a self-loop label clear of the label below it', () => {
    // A loop hangs its label beside itself, level with the middle of the loop,
    // while a straight run hangs its label above the line. Those two land far
    // closer together than the step gap suggests, and the first version of this
    // component overlapped them into an unreadable smudge that every geometry
    // assertion still passed.
    const LINE_HEIGHT = 14;
    for (const [index, step] of model.steps.entries()) {
      if (step.from !== step.to) continue;
      const next = model.steps[index + 1];
      if (!next) continue;
      const lane = model.participants.findIndex((p) => p.id === step.from);
      const loop = labelPoint(stepPath(laneX(lane), laneX(lane), stepY(index)));
      const nextLane = model.participants.findIndex((p) => p.id === next.from);
      const nextTo = model.participants.findIndex((p) => p.id === next.to);
      const below = labelPoint(
        stepPath(laneX(nextLane), laneX(nextTo), stepY(index + 1)),
      );
      expect(below.y - loop.y).toBeGreaterThanOrEqual(LINE_HEIGHT * 2);
    }
  });

  it('leaves room for a self-loop to finish before the next step', () => {
    // The loop drops SELF_LOOP_HEIGHT below its own row. A drop at or past the
    // next row would overlap the step after it.
    expect(SELF_LOOP_HEIGHT).toBeLessThan(STEP_GAP);
  });

  it('describes an interruption before it requests one', () => {
    // The claim the drawing exists to make: every local stop precedes the
    // message asking the worker to stop. If a future edit reorders these, the
    // picture would argue that the user waits on a round trip to be heard.
    const order = model.steps.map((s) => s.id);
    const localMute = order.indexOf('mute');
    const remoteCancel = order.indexOf('cancel');
    expect(localMute).toBeGreaterThanOrEqual(0);
    expect(remoteCancel).toBeGreaterThan(localMute);
  });
});

describe('stageFor', () => {
  it.each(
    MODELS,
  )('reserves room for every self-loop label in %s', (_name, model) => {
    // The label origin fitting is not the invariant. A label anchored `start`
    // grows rightwards from there, so the stage has to cover the whole reach —
    // origin plus text — or SVG clips the words and reports nothing.
    const stage = stageFor(model);
    for (const step of model.steps) {
      if (step.from !== step.to) continue;
      const lane = model.participants.findIndex(({ id }) => id === step.from);
      expect(laneX(lane) + SELF_LOOP_LABEL_REACH).toBeLessThanOrEqual(stage.w);
    }
  });

  it('widens the stage for a self-loop on the last participant', () => {
    const lastLane: SequenceModel = {
      summary: 'self-loop on the final participant',
      participants: [
        { id: 'a', label: 'A', tone: 'yours' },
        { id: 'b', label: 'B', tone: 'yours' },
      ],
      steps: [{ id: 's', from: 'b', to: 'b', kind: 'halt', label: 'holds' }],
    };
    const laneGridOnly = LANE_PADDING * 2 + LANE_WIDTH * 2;

    const stage = stageFor(lastLane);

    expect(laneX(1) + SELF_LOOP_LABEL_REACH).toBeLessThanOrEqual(stage.w);
    // Sizing from lane count alone returns `laneGridOnly`, which is narrower
    // than the reach above — so this case genuinely needed the widening.
    expect(stage.w).toBeGreaterThan(laneGridOnly);
    expect(laneX(1) + SELF_LOOP_LABEL_REACH).toBeGreaterThan(laneGridOnly);
  });
});
