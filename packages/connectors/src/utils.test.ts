import { describe, expect, test } from 'bun:test';

import { isCorrelatableId } from '@maelstrom-co/connectors';
import type { MessageId } from '@maelstrom-co/protocol';

describe('isCorrelatableId', () => {
  test('rejects null and undefined', () => {
    expect(isCorrelatableId(null)).toBe(false);
    expect(isCorrelatableId(undefined)).toBe(false);
  });

  test('rejects booleans', () => {
    expect(isCorrelatableId(true)).toBe(false);
    expect(isCorrelatableId(false)).toBe(false);
  });

  test('rejects numbers including 0', () => {
    expect(isCorrelatableId(0)).toBe(false);
    expect(isCorrelatableId(42)).toBe(false);
    expect(isCorrelatableId(NaN)).toBe(false);
    expect(isCorrelatableId(Infinity)).toBe(false);
  });

  test('rejects objects and arrays', () => {
    expect(isCorrelatableId({})).toBe(false);
    expect(isCorrelatableId({ id: 'x' })).toBe(false);
    expect(isCorrelatableId([])).toBe(false);
    expect(isCorrelatableId(['x'])).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isCorrelatableId('')).toBe(false);
  });

  test('rejects whitespace-only strings (parity with requireNonEmptyBrand)', () => {
    // Locks the doc claim that the runtime check matches `trim() === ''`.
    expect(isCorrelatableId('   ')).toBe(false);
    expect(isCorrelatableId('\t')).toBe(false);
    expect(isCorrelatableId('\n')).toBe(false);
    expect(isCorrelatableId('\t  \n  ')).toBe(false);
  });

  test('accepts non-empty strings', () => {
    expect(isCorrelatableId('abc')).toBe(true);
    expect(isCorrelatableId('a')).toBe(true);
    expect(isCorrelatableId('  abc  ')).toBe(true); // whitespace-padded but non-empty after trim
    expect(isCorrelatableId('req-1234')).toBe(true);
  });

  test('narrows to MessageId for the type checker', () => {
    const value: unknown = 'req-x';
    if (isCorrelatableId(value)) {
      const branded: MessageId = value;
      expect(branded as string).toBe('req-x');
    }
  });
});
