import { describe, expect, test } from 'bun:test';

import { SessionId, SessionIdSchema } from './session.js';

describe('SessionId', () => {
  test('generates a unique id with session- prefix without requiring crypto.randomUUID', () => {
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });

    try {
      const id = SessionId();
      expect(typeof id).toBe('string');
      expect(id).toStartWith('session-');
      expect(id).toHaveLength('session-'.length + 21);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: originalRandomUUID,
      });
    }
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

describe('SessionIdSchema', () => {
  test('parses a non-empty string and brands it', () => {
    const result = SessionIdSchema.safeParse('my-session');
    expect(result.success).toBe(true);
    if (result.success) {
      // Compile-time check: the parsed value is assignable to SessionId
      const id: SessionId = result.data;
      expect(id).toBe('my-session' as SessionId);
    }
  });

  test('rejects empty string', () => {
    const result = SessionIdSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(SessionIdSchema.safeParse(123).success).toBe(false);
    expect(SessionIdSchema.safeParse(null).success).toBe(false);
    expect(SessionIdSchema.safeParse(undefined).success).toBe(false);
    expect(SessionIdSchema.safeParse({}).success).toBe(false);
  });

  test('rejects whitespace-only string (spaces)', () => {
    expect(SessionIdSchema.safeParse('   ').success).toBe(false);
  });

  test('rejects whitespace-only string (tab)', () => {
    expect(SessionIdSchema.safeParse('\t').success).toBe(false);
  });

  test('rejects whitespace-only string (newline)', () => {
    expect(SessionIdSchema.safeParse('\n').success).toBe(false);
  });
});
