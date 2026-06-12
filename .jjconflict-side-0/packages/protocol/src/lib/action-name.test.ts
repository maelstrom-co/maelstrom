import { describe, expect, test } from 'bun:test';

import { ActionName } from './action-name.js';

describe('ActionName', () => {
  test('preserves the provided value when given a non-empty string', () => {
    expect(ActionName('expand')).toBe('expand' as ActionName);
  });

  test('throws on an empty string', () => {
    expect(() => ActionName('')).toThrow(/non-empty/i);
  });

  test('throws on whitespace-only strings', () => {
    expect(() => ActionName('   ')).toThrow(/non-empty/i);
    expect(() => ActionName('\t')).toThrow(/non-empty/i);
    expect(() => ActionName('\n')).toThrow(/non-empty/i);
  });

  test('is idempotent — branding an already-branded value is a no-op', () => {
    const name = ActionName('collapse');
    expect(ActionName(name)).toBe(name);
  });
});
