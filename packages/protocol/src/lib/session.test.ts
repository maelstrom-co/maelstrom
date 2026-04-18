import { describe, expect, test } from 'bun:test';

import { SessionId } from './session.js';

describe('SessionId', () => {
  test('generates a unique id with session- prefix when called with no arguments', () => {
    const id = SessionId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('preserves the provided value when given a non-empty string', () => {
    expect(SessionId('my-session-id')).toBe('my-session-id' as SessionId);
  });

  test('produces different ids across calls without arguments', () => {
    const a = SessionId();
    const b = SessionId();
    expect(a).not.toBe(b);
  });

  test('throws on an empty string', () => {
    expect(() => SessionId('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => SessionId('   ')).toThrow(/non-empty/i);
    expect(() => SessionId('\t')).toThrow(/non-empty/i);
    expect(() => SessionId('\n')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const id = SessionId('my-session');
    expect(SessionId(id)).toBe(id);
  });
});
