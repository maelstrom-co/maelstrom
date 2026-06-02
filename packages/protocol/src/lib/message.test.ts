import { describe, expect, test } from 'bun:test';

import { MessageId, MessageIdSchema } from './message.js';

describe('MessageId', () => {
  test('generates an id without requiring crypto.randomUUID', () => {
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });

    try {
      const id = MessageId();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(21);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  test('preserves the provided value when rehydrating', () => {
    expect(MessageId('msg-42')).toBe('msg-42' as MessageId);
  });

  test('produces different ids across calls without arguments', () => {
    const a = MessageId();
    const b = MessageId();
    expect(a).not.toBe(b);
  });

  test('throws on an empty string', () => {
    expect(() => MessageId('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => MessageId('   ')).toThrow(/non-empty/i);
    expect(() => MessageId('\t')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const id = MessageId('abc');
    expect(MessageId(id)).toBe(id);
  });
});

describe('MessageIdSchema', () => {
  test('parses a non-empty string and brands it', () => {
    const result = MessageIdSchema.safeParse('msg-1');
    expect(result.success).toBe(true);
    if (result.success) {
      const id: MessageId = result.data;
      expect(id).toBe('msg-1' as MessageId);
    }
  });

  test('rejects empty string', () => {
    expect(MessageIdSchema.safeParse('').success).toBe(false);
  });

  test('rejects whitespace-only string (spaces)', () => {
    expect(MessageIdSchema.safeParse('   ').success).toBe(false);
  });

  test('rejects whitespace-only string (tab)', () => {
    expect(MessageIdSchema.safeParse('\t').success).toBe(false);
  });

  test('rejects whitespace-only string (newline)', () => {
    expect(MessageIdSchema.safeParse('\n').success).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(MessageIdSchema.safeParse(0).success).toBe(false);
    expect(MessageIdSchema.safeParse(null).success).toBe(false);
    expect(MessageIdSchema.safeParse(undefined).success).toBe(false);
    expect(MessageIdSchema.safeParse({}).success).toBe(false);
  });
});
