import { describe, expect, it } from 'bun:test';
import {
  getCurrentKeyframe,
  getCurrentKeyframeIndex,
  lerp,
} from './keyframe-utils';

describe('lerp', () => {
  it('returns start value at t=0', () => {
    expect(lerp(0, 10, 0)).toBe(0);
  });
  it('returns end value at t=1', () => {
    expect(lerp(0, 10, 1)).toBe(10);
  });
  it('interpolates at midpoint', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
  it('handles negative ranges', () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

describe('getCurrentKeyframe', () => {
  const keyframes = [
    { at: 0, state: 'idle' },
    { at: 0.3, state: 'active' },
    { at: 0.7, state: 'done' },
  ];

  it('returns first keyframe at progress 0', () => {
    expect(getCurrentKeyframe(keyframes, 0)).toEqual({ at: 0, state: 'idle' });
  });
  it('returns first keyframe before any threshold', () => {
    expect(getCurrentKeyframe(keyframes, 0.1)).toEqual({
      at: 0,
      state: 'idle',
    });
  });
  it('returns matching keyframe at exact threshold', () => {
    expect(getCurrentKeyframe(keyframes, 0.3)).toEqual({
      at: 0.3,
      state: 'active',
    });
  });
  it('returns last passed keyframe between thresholds', () => {
    expect(getCurrentKeyframe(keyframes, 0.5)).toEqual({
      at: 0.3,
      state: 'active',
    });
  });
  it('returns last keyframe past all thresholds', () => {
    expect(getCurrentKeyframe(keyframes, 1.0)).toEqual({
      at: 0.7,
      state: 'done',
    });
  });
});

describe('getCurrentKeyframeIndex', () => {
  const keyframes = [
    { at: 0, state: 'idle' },
    { at: 0.3, state: 'active' },
    { at: 0.7, state: 'done' },
  ];

  it('returns 0 at progress 0', () => {
    expect(getCurrentKeyframeIndex(keyframes, 0)).toBe(0);
  });
  it('returns correct index at exact threshold', () => {
    expect(getCurrentKeyframeIndex(keyframes, 0.3)).toBe(1);
  });
  it('returns last passed index between thresholds', () => {
    expect(getCurrentKeyframeIndex(keyframes, 0.5)).toBe(1);
  });
  it('returns last index past all thresholds', () => {
    expect(getCurrentKeyframeIndex(keyframes, 1.0)).toBe(2);
  });
});
