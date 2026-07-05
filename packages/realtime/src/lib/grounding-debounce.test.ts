import { describe, expect, it } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { groundedDebounce } from './grounding-debounce.js';

describe('groundedDebounce', () => {
  it('fires once with the latest value after the window', () => {
    const clock = FakeTimers.install();
    const seen: number[] = [];
    const d = groundedDebounce((n: number) => seen.push(n), 1000);
    d(1);
    d(2);
    d(3);
    clock.tick(999);
    expect(seen).toEqual([]);
    clock.tick(1);
    expect(seen).toEqual([3]);
    clock.uninstall();
  });

  it('fires again for a call after the window has elapsed', () => {
    const clock = FakeTimers.install();
    const seen: number[] = [];
    const d = groundedDebounce((n: number) => seen.push(n), 1000);
    d(1);
    clock.tick(1000);
    expect(seen).toEqual([1]);
    d(2);
    clock.tick(1000);
    expect(seen).toEqual([1, 2]);
    clock.uninstall();
  });
});
