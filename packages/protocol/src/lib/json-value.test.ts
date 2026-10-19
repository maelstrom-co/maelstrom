import { describe, expect, test } from 'bun:test';

import type { JsonValue } from './json-value.js';
import { JsonValueSchema } from './json-value.js';

describe('JsonValueSchema', () => {
  test.each<[string, JsonValue]>([
    ['a string', 'A123'],
    ['a number', 42],
    ['a boolean', false],
    ['null', null],
    ['an array of mixed values', ['B456', 1, true, null]],
    ['a nested object', { order: { sku: 'A123', items: [{ qty: 2 }] } }],
    ['an empty object', {}],
    ['an empty array', []],
  ])('accepts %s', (_label, value) => {
    const result = JsonValueSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) expect<unknown>(result.data).toEqual(value);
  });

  test.each<[string, unknown]>([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an object holding undefined', { sku: undefined }],
    ['an object holding a function', { run: () => 1 }],
    ['an array holding undefined', [1, undefined]],
    ['a deeply nested function', { a: [{ b: { c: () => 1 } }] }],
  ])('rejects %s', (_label, value) => {
    expect(JsonValueSchema.safeParse(value).success).toBe(false);
  });

  test('survives a JSON round trip unchanged', () => {
    const value: JsonValue = {
      latestOrderSku: 'A123',
      similarSkus: ['B456', 'C789'],
      inStock: true,
      count: 3,
      note: null,
    };
    const decoded = JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
    expect<unknown>(decoded).toEqual(value);
  });
});
