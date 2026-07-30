import { describe, expect, test } from 'bun:test';

import { MAX_OPTION_COUNT, MAX_OPTIONS_TOTAL_CHARS } from './index.js';

describe('index barrel', () => {
  test('exports the capability-snapshot option-projection limit constants', () => {
    // `packages/client/package.json`'s `exports` map declares only "." and
    // "./package.json" — a deep import of capability-snapshot.js is not a
    // workaround, so consumers and tests that want to reference these limits
    // instead of hardcoding numbers depend on the root barrel re-exporting
    // them.
    expect(typeof MAX_OPTION_COUNT).toBe('number');
    expect(typeof MAX_OPTIONS_TOTAL_CHARS).toBe('number');
  });
});
