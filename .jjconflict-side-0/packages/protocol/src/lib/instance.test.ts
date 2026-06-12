import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';

describe('InstanceId', () => {
  test('preserves the provided value when given a non-empty string', () => {
    expect(InstanceId('vessel-1')).toBe('vessel-1' as InstanceId);
  });

  test('throws on an empty string', () => {
    expect(() => InstanceId('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => InstanceId('   ')).toThrow(/non-empty/i);
    expect(() => InstanceId('\t')).toThrow(/non-empty/i);
    expect(() => InstanceId('\n')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const id = InstanceId('vessel-42');
    expect(InstanceId(id)).toBe(id);
  });
});
