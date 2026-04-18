import { describe, expect, test } from 'bun:test';

import { MessageId } from './message.js';

describe('MessageId', () => {
  test('generates a valid UUID when called with no arguments', () => {
    const id = MessageId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
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
