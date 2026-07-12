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
    expect(next).toEqual({ status: 'active' });
  });

  it('defers when a response is already active, without sending', () => {
    const active = { status: 'active' as const };
    const { next, sendNow } = requestResponseCreate(active);
    expect(sendNow).toBe(false);
    expect(next).toEqual({ status: 'active-pending' });
  });

  it('collapses a second deferred request into the same single pending slot', () => {
    const alreadyPending = { status: 'active-pending' as const };
    const { next, sendNow } = requestResponseCreate(alreadyPending);
    expect(sendNow).toBe(false);
    expect(next).toEqual({ status: 'active-pending' });
  });
});

describe('markResponseActive', () => {
  it('marks idle as active', () => {
    expect(markResponseActive({ status: 'idle' })).toEqual({ status: 'active' });
  });

  it('leaves an already-active-pending response as active-pending', () => {
    expect(markResponseActive({ status: 'active-pending' })).toEqual({
      status: 'active-pending',
    });
  });
});

describe('markResponseInactive', () => {
  it('goes idle with nothing to flush when no response.create was deferred', () => {
    const { next, flush } = markResponseInactive({ status: 'active' });
    expect(flush).toBe(false);
    expect(next).toEqual({ status: 'idle' });
  });

  it('flushes exactly one deferred response.create, re-entering the active state', () => {
    const { next, flush } = markResponseInactive({ status: 'active-pending' });
    expect(flush).toBe(true);
    expect(next).toEqual({ status: 'active' });
  });
});
