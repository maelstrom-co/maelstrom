import { describe, expect, test } from 'bun:test';

import { ChartDimensionsSchema } from './chart.js';

describe('ChartDimensionsSchema', () => {
  test('parses a valid dimensions object', () => {
    const result = ChartDimensionsSchema.safeParse({ rows: 12, columns: 16 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ rows: 12, columns: 16 });
    }
  });

  test('rejects zero rows or columns', () => {
    expect(
      ChartDimensionsSchema.safeParse({ rows: 0, columns: 16 }).success,
    ).toBe(false);
    expect(
      ChartDimensionsSchema.safeParse({ rows: 12, columns: 0 }).success,
    ).toBe(false);
  });

  test('rejects negative values', () => {
    expect(
      ChartDimensionsSchema.safeParse({ rows: -1, columns: 16 }).success,
    ).toBe(false);
  });

  test('rejects non-integer values', () => {
    expect(
      ChartDimensionsSchema.safeParse({ rows: 1.5, columns: 16 }).success,
    ).toBe(false);
  });

  test('rejects missing fields', () => {
    expect(ChartDimensionsSchema.safeParse({ rows: 12 }).success).toBe(false);
    expect(ChartDimensionsSchema.safeParse({ columns: 16 }).success).toBe(
      false,
    );
    expect(ChartDimensionsSchema.safeParse({}).success).toBe(false);
  });

  test('strips extra fields (default Zod object behavior)', () => {
    const result = ChartDimensionsSchema.safeParse({
      rows: 12,
      columns: 16,
      extra: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ rows: 12, columns: 16 });
      expect('extra' in result.data).toBe(false);
    }
  });
});
