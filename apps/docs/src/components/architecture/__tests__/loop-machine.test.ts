import { describe, expect, it } from 'bun:test';
import {
  APPLY_ORDER,
  initialLoopState,
  type LoopState,
  loopReducer,
  STEPS,
  stepCaption,
} from '../loop-machine';

describe('apply order (load-bearing invariant)', () => {
  it('APPLY_ORDER is layout before actions', () => {
    expect(APPLY_ORDER).toEqual(['layout', 'actions']);
  });

  it('STEPS applies layout before actions', () => {
    const layoutIdx = STEPS.indexOf('layout');
    const actionsIdx = STEPS.indexOf('actions');
    expect(layoutIdx).toBeGreaterThanOrEqual(0);
    expect(actionsIdx).toBeGreaterThan(layoutIdx);
  });

  it('the round-trip starts at intent and ends by closing the loop', () => {
    expect(STEPS[0]).toBe('intent');
    expect(STEPS[STEPS.length - 1]).toBe('loop');
  });
});

describe('loopReducer', () => {
  it('next advances and clamps at the final step', () => {
    let s: LoopState = { index: STEPS.length - 1, playing: false };
    s = loopReducer(s, { type: 'next' });
    expect(s.index).toBe(STEPS.length - 1);
  });

  it('prev rewinds and clamps at 0', () => {
    let s: LoopState = { index: 0, playing: true };
    s = loopReducer(s, { type: 'prev' });
    expect(s.index).toBe(0);
  });

  it('restart returns to the initial state', () => {
    const s = loopReducer({ index: 4, playing: true }, { type: 'restart' });
    expect(s).toEqual(initialLoopState);
  });

  it('play sets playing true, pause sets it false', () => {
    expect(loopReducer(initialLoopState, { type: 'play' }).playing).toBe(true);
    expect(
      loopReducer({ index: 2, playing: true }, { type: 'pause' }).playing,
    ).toBe(false);
  });

  it('play from the final step restarts at the top', () => {
    expect(
      loopReducer(
        { index: STEPS.length - 1, playing: false },
        { type: 'play' },
      ),
    ).toEqual({ index: 0, playing: true });
  });

  it('tick advances while playing and stops (pauses) at the end', () => {
    let s: LoopState = { index: STEPS.length - 2, playing: true };
    s = loopReducer(s, { type: 'tick' });
    expect(s.index).toBe(STEPS.length - 1);
    expect(s.playing).toBe(true);
    s = loopReducer(s, { type: 'tick' });
    expect(s).toEqual({ index: STEPS.length - 1, playing: false });
  });
});

describe('stepCaption', () => {
  it('returns a non-empty human caption for every step', () => {
    for (const step of STEPS) {
      expect(stepCaption(step).length).toBeGreaterThan(0);
    }
  });
});
