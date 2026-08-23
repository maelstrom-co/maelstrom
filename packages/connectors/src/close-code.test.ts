import { describe, expect, test } from 'bun:test';

import { classifyCloseCode } from './close-code.js';

describe('classifyCloseCode', () => {
  test('classifies 1000 as a clean, retryable close', () => {
    // Clean means "no auto-reconnect"; retryable stays true because 1000 is
    // an orderly end, not a refusal — a fresh connect() is legitimate.
    expect(classifyCloseCode(1000)).toEqual({
      clean: true,
      retryable: true,
    });
  });

  test('classifies 1008 (policy violation) as unclean and non-retryable', () => {
    // The one code where retrying is pointless by definition: the server is
    // deliberately rejecting this client. This mapping is the wire contract
    // ConnectionManager's circuit breaker relies on.
    expect(classifyCloseCode(1008)).toEqual({
      clean: false,
      retryable: false,
    });
  });

  test('classifies every other code as unclean but retryable', () => {
    for (const code of [1001, 1002, 1005, 1006, 1011, 3000, 4999]) {
      expect(classifyCloseCode(code)).toEqual({
        clean: false,
        retryable: true,
      });
    }
  });
});
