import { describe, expect, test } from 'bun:test';

import * as protocol from '@maelstrom-co/protocol';

import {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
  readCapabilitySnapshot,
} from './index.js';

describe('index barrel', () => {
  test('exports the capability-snapshot option-projection limit constants', () => {
    // `packages/client/package.json`'s `exports` map declares only "." and
    // "./package.json", so consumers and tests that want to reference these
    // limits instead of hardcoding numbers depend on the root barrel
    // re-exporting them.
    expect(typeof MAX_CAPABILITY_OPTION_COUNT).toBe('number');
    expect(typeof MAX_CAPABILITY_OPTIONS_TOTAL_CHARS).toBe('number');
  });

  test('re-exports the capability snapshot from protocol', () => {
    expect(readCapabilitySnapshot).toBe(protocol.readCapabilitySnapshot);
    expect(MAX_CAPABILITY_OPTION_COUNT).toBe(
      protocol.MAX_CAPABILITY_OPTION_COUNT,
    );
    expect(MAX_CAPABILITY_OPTIONS_TOTAL_CHARS).toBe(
      protocol.MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
    );
  });
});
