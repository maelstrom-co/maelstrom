import { describe, expect, test } from 'bun:test';

import { VariantName } from './variant-name.js';

describe('VariantName', () => {
  test('preserves the provided value when given a non-empty string', () => {
    expect(VariantName('detail')).toBe('detail' as VariantName);
  });

  test('throws on an empty string', () => {
    expect(() => VariantName('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => VariantName('   ')).toThrow(/non-empty/i);
    expect(() => VariantName('\t')).toThrow(/non-empty/i);
    expect(() => VariantName('\n')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const name = VariantName('compact');
    expect(VariantName(name)).toBe(name);
  });
});
