import { describe, expect, it } from 'bun:test';

import {
  INITIAL_RESPONSE_LIFECYCLE_STATE,
  markResponseActive,
  markResponseInactive,
  requestResponseCreate,
} from './response-lifecycle.js';

describe('requestResponseCreate', () => {
  it('sends immediately when no response is active', () => {
    const { next, sendNow } = requestResponseCreate(INITIAL_RESPONSE_LIFECYCLE_STATE);
    expect(sendNow).toBe(true);
    expect(next).toEqual({ active: true, pending: false });
  });

  it('defers when a response is already active, without sending', () => {
    const active = { active: true, pending: false };
    const { next, sendNow } = requestResponseCreate(active);
    expect(sendNow).toBe(false);
    expect(next).toEqual({ active: true, pending: true });
  });

  it('collapses a second deferred request into the same single pending slot', () => {
    const alreadyPending = { active: true, pending: true };
    const { next, sendNow } = requestResponseCreate(alreadyPending);
    expect(sendNow).toBe(false);
    expect(next).toEqual({ active: true, pending: true });
  });
});

describe('markResponseActive', () => {
  it('marks active while preserving any pending flag', () => {
    expect(markResponseActive({ active: false, pending: false })).toEqual({
      active: true,
      pending: false,
    });
    expect(markResponseActive({ active: false, pending: true })).toEqual({
      active: true,
      pending: true,
    });
  });
});

describe('markResponseInactive', () => {
  it('goes idle with nothing to flush when no response.create was deferred', () => {
    const { next, flush } = markResponseInactive({ active: true, pending: false });
    expect(flush).toBe(false);
    expect(next).toEqual({ active: false, pending: false });
  });

  it('flushes exactly one deferred response.create, re-entering the active state', () => {
    const { next, flush } = markResponseInactive({ active: true, pending: true });
    expect(flush).toBe(true);
    expect(next).toEqual({ active: true, pending: false });
  });
});
