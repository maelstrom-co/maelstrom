import { describe, expect, test } from 'vitest';

import { formatHitRate } from './resize-replay-run';

describe('formatHitRate', () => {
  test('a clean run divides by every completed trial', () => {
    expect(formatHitRate({ hits: 3, completed: 10, errors: 0 })).toBe('30.0%');
  });

  test('errored trials leave the denominator', () => {
    expect(formatHitRate({ hits: 1, completed: 4, errors: 2 })).toBe('50.0%');
  });

  test('a run where every trial errored measured nothing', () => {
    expect(formatHitRate({ hits: 0, completed: 5, errors: 5 })).toBe('n/a');
  });

  test('a run with no completed trial measured nothing', () => {
    expect(formatHitRate({ hits: 0, completed: 0, errors: 0 })).toBe('n/a');
  });
});
