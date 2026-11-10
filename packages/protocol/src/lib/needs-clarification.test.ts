import { describe, expect, test } from 'bun:test';

import {
  GridNeedsClarificationSchema,
  NeedsClarificationSchema,
  TilingNeedsClarificationSchema,
} from './needs-clarification.js';

const question = 'Which Alphabet share class do you mean?';

const gridLayout = {
  positions: [
    {
      instanceId: 'stock-aapl',
      position: { row: 0, column: 0 },
      size: { width: 4, height: 3 },
    },
  ],
};

const tilingLayout = {
  tree: ['ID:stock-aapl'],
  instances: [
    { instanceId: 'stock-aapl', vesselId: 'stock', variant: 'compact' },
  ],
};

const executionPlan = [
  { instanceId: 'stock-aapl', action: 'setSymbol', paramsJson: '{"s":"AAPL"}' },
];

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

  test.each(['', '   ', '\n\t'])(
    'rejects the blank question %p',
    (question) => {
      expect(
        NeedsClarificationSchema.safeParse({
          type: 'needs_clarification',
          question,
        }).success,
      ).toBe(false);
    },
  );

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

describe('NeedsClarification with partial changes', () => {
  test('the grid schema accepts a grid layout and an execution plan', () => {
    const result = GridNeedsClarificationSchema.safeParse({
      type: 'needs_clarification',
      question,
      options: ['Class A (GOOGL)', 'Class C (GOOG)'],
      layout: gridLayout,
      executionPlan,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.layout?.positions).toHaveLength(1);
      expect(result.data.executionPlan).toHaveLength(1);
    }
  });

  test('the tiling schema accepts a tiling layout and an execution plan', () => {
    const result = TilingNeedsClarificationSchema.safeParse({
      type: 'needs_clarification',
      question,
      layout: tilingLayout,
      executionPlan,
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.layout?.tree).toEqual(['ID:stock-aapl']);
  });

  test('either change may come without the other', () => {
    expect(
      GridNeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question,
        layout: gridLayout,
      }).success,
    ).toBe(true);
    expect(
      TilingNeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question,
        executionPlan,
      }).success,
    ).toBe(true);
  });

  test.each([
    ['GridNeedsClarificationSchema', GridNeedsClarificationSchema],
    ['TilingNeedsClarificationSchema', TilingNeedsClarificationSchema],
  ] as const)(
    '%s still accepts a clarification on its own',
    (_name, schema) => {
      const value = { type: 'needs_clarification', question };
      const result = schema.safeParse(value);
      expect(result.success).toBe(true);
      if (result.success) expect<unknown>(result.data).toEqual(value);
    },
  );

  test('a layout must match the schema mode', () => {
    expect(
      GridNeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question,
        layout: tilingLayout,
      }).success,
    ).toBe(false);
    expect(
      TilingNeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question,
        layout: gridLayout,
      }).success,
    ).toBe(false);
  });

  test('the mode-agnostic schema accepts either layout', () => {
    for (const layout of [gridLayout, tilingLayout]) {
      expect(
        NeedsClarificationSchema.safeParse({
          type: 'needs_clarification',
          question,
          layout,
          executionPlan,
        }).success,
      ).toBe(true);
    }
  });

  test.each([
    ['GridNeedsClarificationSchema', GridNeedsClarificationSchema, gridLayout],
    [
      'TilingNeedsClarificationSchema',
      TilingNeedsClarificationSchema,
      tilingLayout,
    ],
  ] as const)(
    '%s rejects a blank question alongside changes',
    (_name, schema, layout) => {
      expect(
        schema.safeParse({
          type: 'needs_clarification',
          question: '  ',
          layout,
          executionPlan,
        }).success,
      ).toBe(false);
    },
  );

  test('an execution plan keeps the plan result limit', () => {
    const action = { instanceId: 'stock-aapl', action: 'refresh' };
    const withPlan = (length: number) => ({
      type: 'needs_clarification',
      question,
      executionPlan: Array.from({ length }, () => action),
    });
    expect(GridNeedsClarificationSchema.safeParse(withPlan(64)).success).toBe(
      true,
    );
    expect(GridNeedsClarificationSchema.safeParse(withPlan(65)).success).toBe(
      false,
    );
  });

  test('an execution plan entry must be well formed', () => {
    expect(
      GridNeedsClarificationSchema.safeParse({
        type: 'needs_clarification',
        question,
        executionPlan: [{ action: 'refresh' }],
      }).success,
    ).toBe(false);
  });
});
