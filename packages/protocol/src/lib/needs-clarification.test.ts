import { describe, expect, test } from 'bun:test';

import { NeedsClarificationSchema } from './needs-clarification.js';

describe('NeedsClarificationSchema', () => {
  test('accepts a question on its own', () => {
    const value = {
      type: 'needs_clarification',
      question: 'Which order do you mean?',
    };
    const result = NeedsClarificationSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) expect<unknown>(result.data).toEqual(value);
  });

  test('accepts a question with options', () => {
    const value = {
      type: 'needs_clarification',
      question: 'Which order do you mean?',
      options: ['The latest order', 'The order from last week'],
    };
    const result = NeedsClarificationSchema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) expect<unknown>(result.data).toEqual(value);
  });

  test.each([
    '',
    '   ',
    '\n\t',
  ])('rejects the blank question %p', (question) => {
    expect(
      NeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question,
      }).success,
    ).toBe(false);
  });

  test('rejects a missing question', () => {
    expect(
      NeedsClarificationSchema.safeParse({ type: 'needs_clarification' })
        .success,
    ).toBe(false);
  });

  test.each<[string, unknown]>([
    ['a number', [1]],
    ['null', [null]],
    ['an object', [{ label: 'Latest' }]],
    ['a blank string', ['Latest', '  ']],
    ['a non-array', 'Latest'],
  ])('rejects options holding %s', (_label, options) => {
    expect(
      NeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question: 'Which order do you mean?',
        options,
      }).success,
    ).toBe(false);
  });

  test('rejects a different discriminant', () => {
    expect(
      NeedsClarificationSchema.safeParse({
        type: 'clarification',
        question: 'Which order do you mean?',
      }).success,
    ).toBe(false);
  });
});
