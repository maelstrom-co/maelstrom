import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { formatValidationIssues } from './format-validation-issues.js';

function failure(schema: z.ZodType, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected the value to fail');
  return result.error;
}

describe('formatValidationIssues', () => {
  test('joins issues with their dotted path and code', () => {
    const error = failure(
      z.object({ a: z.object({ b: z.string() }), c: z.number() }),
      { a: { b: 1 }, c: 'x' },
    );

    const formatted = formatValidationIssues(error);

    expect(formatted.split('; ')).toHaveLength(2);
    expect(formatted).toMatch(/^a\.b \[invalid_type\]: /);
    expect(formatted).toMatch(/; c \[invalid_type\]: /);
  });

  test('names an empty path (root)', () => {
    expect(formatValidationIssues(failure(z.string(), 1))).toMatch(
      /^\(root\) \[invalid_type\]: /,
    );
  });

  test('appends the failed union branches', () => {
    const formatted = formatValidationIssues(
      failure(z.union([z.string(), z.number()]), true),
    );

    expect(formatted).toMatch(
      /^\(root\) \[invalid_union\]: .*\(\(root\) \[invalid_type\]: .* \| \(root\) \[invalid_type\]: .*\)$/,
    );
  });
});
