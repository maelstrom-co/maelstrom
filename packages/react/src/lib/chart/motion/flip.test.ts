import { describe, expect, it } from 'bun:test';
import {
  computeFlipDelta,
  enterKeyframes,
  exitKeyframes,
  flipKeyframes,
  staggerOrder,
} from './flip.js';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('computeFlipDelta', () => {
  it('returns the inverse translation and scale from prev to next', () => {
    const delta = computeFlipDelta(rect(0, 0, 100, 100), rect(50, 20, 200, 100));
    expect(delta).toEqual({ dx: -50, dy: -20, sx: 0.5, sy: 1 });
  });

  it('returns null when rects match within epsilon', () => {
    expect(computeFlipDelta(rect(10, 10, 100, 50), rect(10.4, 10, 100.3, 50))).toBeNull();
  });

  it('guards against zero-size next rects instead of producing Infinity', () => {
    expect(computeFlipDelta(rect(0, 0, 100, 100), rect(0, 0, 0, 100))).toBeNull();
  });
});

describe('flipKeyframes', () => {
  it('animates from the inverted transform to identity', () => {
    const frames = flipKeyframes({ dx: -50, dy: -20, sx: 0.5, sy: 1 });
    expect(frames).toEqual([
      { transform: 'translate(-50px, -20px) scale(0.5, 1)', transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ]);
  });
});

describe('enterKeyframes / exitKeyframes', () => {
  it('enter fades and scales up to identity', () => {
    const frames = enterKeyframes();
    expect(frames[0]).toMatchObject({ opacity: 0 });
    expect(frames.at(-1)).toMatchObject({ opacity: 1, transform: 'none' });
  });

  it('exit is the reverse shape: identity down to faded', () => {
    const frames = exitKeyframes();
    expect(frames[0]).toMatchObject({ opacity: 1, transform: 'none' });
    expect((frames.at(-1) as { opacity: number }).opacity).toBe(0);
  });
});

describe('staggerOrder', () => {
  it('orders row-major: top-to-bottom, then left-to-right', () => {
    const order = staggerOrder([
      ['c', rect(0, 100, 10, 10)],
      ['b', rect(90, 0, 10, 10)],
      ['a', rect(0, 0, 10, 10)],
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('treats near-equal rows (within 8px) as the same row', () => {
    const order = staggerOrder([
      ['right', rect(50, 4, 10, 10)],
      ['left', rect(0, 0, 10, 10)],
    ]);
    expect(order).toEqual(['left', 'right']);
  });
});
