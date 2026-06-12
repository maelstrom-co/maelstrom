import { describe, expect, test } from 'bun:test';

import { toError } from './to-error.js';

describe('toError', () => {
  test('returns the original Error instance unchanged', () => {
    const original = new Error('boom');
    expect(toError(original)).toBe(original);
  });

  test('preserves Error subclasses', () => {
    class CustomError extends Error {
      readonly code = 'CUSTOM';
    }
    const original = new CustomError('subclass');
    const result = toError(original);
    expect(result).toBe(original);
    expect(result).toBeInstanceOf(CustomError);
  });

  test('wraps a non-Error string in a new Error', () => {
    const result = toError('plain string');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('plain string');
  });

  test('wraps a non-Error number in a new Error', () => {
    const result = toError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('42');
  });

  test('wraps null in a new Error', () => {
    const result = toError(null);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('null');
  });

  test('wraps undefined in a new Error', () => {
    const result = toError(undefined);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('undefined');
  });

  test('wraps a plain object in a new Error', () => {
    const result = toError({ kind: 'bad' });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('[object Object]');
  });
});
