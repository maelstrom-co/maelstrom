import { describe, expect, test } from 'vitest';

import { TRIAL_MAX_RETRIES } from './resize-replay-run';

describe('TRIAL_MAX_RETRIES', () => {
  test('a trial spends exactly one model call', () => {
    // The harness reads the last attempt's plan and the newest "Response
    // healed" line, so a second attempt that comes back clean erases a first
    // attempt's refused replay and the trial scores nothing.
    expect(TRIAL_MAX_RETRIES).toBe(0);
  });
});
