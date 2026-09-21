import { describe, expect, test } from 'bun:test';

import { makeStageContext } from '../__test-helpers__/stage-context.js';
import { providerError } from '../errors.js';
import {
  deferred,
  enumSnapshotFor,
  isDeferred,
  unhandledDeferralError,
} from './stage.js';

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

describe('enumSnapshotFor', () => {
  test('returns the context snapshot for the exact catalog it was built from', () => {
    const ctx = makeStageContext();

    const snapshot = enumSnapshotFor(ctx, ctx.origin.request.vessels);

    expect(snapshot).toBeDefined();
    expect(snapshot).toBe(ctx.enumSnapshot);
  });

  test('returns undefined for a structurally equal but different catalog', () => {
    const ctx = makeStageContext();

    expect(
      enumSnapshotFor(ctx, [...ctx.origin.request.vessels]),
    ).toBeUndefined();
  });

  test('returns undefined for a context without a snapshot', () => {
    const ctx = makeStageContext({ enumSnapshot: undefined });

    expect(enumSnapshotFor(ctx, ctx.origin.request.vessels)).toBeUndefined();
  });
});
