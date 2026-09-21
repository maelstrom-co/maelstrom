import { describe, expect, test } from 'bun:test';

import { providerError } from '../errors.js';
import { deferred, isDeferred, unhandledDeferralError } from './stage.js';

describe('Deferred', () => {
  test('deferred builds a tagged value and isDeferred recognises only it', () => {
    const value = deferred('scope unsupported');

    expect(value).toEqual({ _tag: 'Deferred', reason: 'scope unsupported' });
    expect(isDeferred(value)).toBe(true);
    expect(isDeferred(providerError('upstream', new Error('x')))).toBe(false);
  });

  test('an unhandled deferral maps to ValidationError on field "planner"', () => {
    expect(unhandledDeferralError(deferred('no match'))).toMatchObject({
      _tag: 'ValidationError',
      field: 'planner',
      message: 'planner deferred: no match',
    });
  });
});
