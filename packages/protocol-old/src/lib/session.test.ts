import { describe, expect, it } from 'bun:test';

import { SessionId } from './session.js';

describe('SessionId', () => {
  it('generates a unique id when called with no arguments', () => {
    const id = SessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^session-/);
  });

  it('preserves the provided value when given a non-empty string', () => {
    const id = SessionId('my-session-id');
    expect(id).toBe('my-session-id' as ReturnType<typeof SessionId>);
  });

  it('produces different ids across calls without arguments', () => {
    const a = SessionId();
    const b = SessionId();
    expect(a).not.toBe(b);
  });

  it('throws on an empty string', () => {
    expect(() => SessionId('')).toThrow(/non-empty/i);
  });
});
