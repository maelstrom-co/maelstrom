import { describe, expect, test } from 'bun:test';

import { ToolCallId, ToolCallIdSchema } from './tool-call-id.js';

describe('ToolCallId', () => {
  test('preserves the provided value when given a non-empty string', () => {
    expect(ToolCallId('call_1')).toBe('call_1' as ToolCallId);
  });

  test('throws on an empty string', () => {
    expect(() => ToolCallId('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => ToolCallId('   ')).toThrow(/non-empty/i);
    expect(() => ToolCallId('\t')).toThrow(/non-empty/i);
    expect(() => ToolCallId('\n')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const id = ToolCallId('call_1');
    expect(ToolCallId(id)).toBe(id);
  });
});

describe('ToolCallIdSchema', () => {
  test('parses a non-empty string and brands it', () => {
    const result = ToolCallIdSchema.safeParse('call_1');
    expect(result.success).toBe(true);
    if (result.success) {
      // Compile-time check: the parsed value is assignable to ToolCallId
      const id: ToolCallId = result.data;
      expect(id).toBe('call_1' as ToolCallId);
    }
  });

  test('rejects empty string', () => {
    const result = ToolCallIdSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(ToolCallIdSchema.safeParse(123).success).toBe(false);
    expect(ToolCallIdSchema.safeParse(null).success).toBe(false);
    expect(ToolCallIdSchema.safeParse(undefined).success).toBe(false);
    expect(ToolCallIdSchema.safeParse({}).success).toBe(false);
  });

  test('rejects whitespace-only string (spaces)', () => {
    expect(ToolCallIdSchema.safeParse('   ').success).toBe(false);
  });

  test('rejects whitespace-only string (tab)', () => {
    expect(ToolCallIdSchema.safeParse('\t').success).toBe(false);
  });

  test('rejects whitespace-only string (newline)', () => {
    expect(ToolCallIdSchema.safeParse('\n').success).toBe(false);
  });
});
