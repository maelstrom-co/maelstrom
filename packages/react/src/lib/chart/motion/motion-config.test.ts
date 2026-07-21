import { describe, expect, it } from 'bun:test';
import { DEFAULT_MOTION, motionSuppressed, resolveMotionConfig } from './motion-config.js';

describe('resolveMotionConfig', () => {
  it('returns defaults for undefined input', () => {
    expect(resolveMotionConfig(undefined)).toEqual(DEFAULT_MOTION);
  });

  it('merges partial overrides onto defaults', () => {
    expect(resolveMotionConfig({ durationMs: 200 })).toEqual({ ...DEFAULT_MOTION, durationMs: 200 });
  });

  it('throws a clear error for a negative durationMs', () => {
    expect(() => resolveMotionConfig({ durationMs: -1 })).toThrow(/durationMs/);
  });

  it('throws for a non-finite durationMs instead of letting NaN reach node.animate', () => {
    // `NaN < 0` is false, so a bare `< 0` guard would pass NaN through to
    // `node.animate({ duration: NaN })`, which throws an opaque runtime error.
    expect(() => resolveMotionConfig({ durationMs: Number.NaN })).toThrow(/durationMs/);
    expect(() => resolveMotionConfig({ durationMs: Number.POSITIVE_INFINITY })).toThrow(/durationMs/);
  });

  it('throws for an invalid staggerMs', () => {
    expect(() => resolveMotionConfig({ staggerMs: -1 })).toThrow(/staggerMs/);
    expect(() => resolveMotionConfig({ staggerMs: Number.NaN })).toThrow(/staggerMs/);
  });

  it('still resolves a valid config after adding the guards', () => {
    expect(resolveMotionConfig({ durationMs: 0, staggerMs: 0 })).toEqual({
      ...DEFAULT_MOTION,
      durationMs: 0,
      staggerMs: 0,
    });
  });
});

describe('motionSuppressed', () => {
  it('is true when disabled by config', () => {
    expect(motionSuppressed({ ...DEFAULT_MOTION, disabled: true })).toBe(true);
  });

  it('is true when the OS prefers reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce') })) as never;
    try {
      expect(motionSuppressed(DEFAULT_MOTION)).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it('is false with defaults and no reduced-motion preference', () => {
    const original = window.matchMedia;
    window.matchMedia = (() => ({ matches: false })) as never;
    try {
      expect(motionSuppressed(DEFAULT_MOTION)).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('treats a missing matchMedia as not reduced', () => {
    const original = window.matchMedia;
    // @ts-expect-error simulating an environment without matchMedia
    window.matchMedia = undefined;
    try {
      expect(motionSuppressed(DEFAULT_MOTION)).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});
