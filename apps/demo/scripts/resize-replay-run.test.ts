import { describe, expect, test } from 'vitest';

import { formatHitRate, TRIAL_MAX_RETRIES } from './resize-replay-run';

describe('TRIAL_MAX_RETRIES', () => {
  test('a trial spends exactly one model call', () => {
    // The harness reads the last attempt's plan and the newest "Response
    // healed" line, so a second attempt that comes back clean erases a first
    // attempt's refused replay and the trial scores nothing.
    expect(TRIAL_MAX_RETRIES).toBe(0);
  });
});

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
