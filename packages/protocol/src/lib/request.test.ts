import { describe, expect, test } from 'bun:test';

import { GridResponseSchema, TilingResponseSchema } from './request.js';

const gridPayload = (layout: unknown) => ({
  userMessage: 'ok',
  rationale: 'r',
  executionPlan: [],
  layout,
});

const tilingPayload = (layout: unknown) => ({
  userMessage: 'ok',
  rationale: 'r',
  executionPlan: [],
  layout,
});

describe('GridResponseSchema', () => {
  test('accepts a minimal valid payload', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({ positions: [] }),
    );
    expect(result.success).toBe(true);
  });

  test('accepts positions with instanceId, position, and size', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 6, height: 4 },
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test('rejects missing top-level fields', () => {
    const result = GridResponseSchema.safeParse({
      userMessage: 'ok',
      layout: { positions: [] },
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative row/column', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({
        positions: [
          {
            instanceId: 'x',
            position: { row: -1, column: 0 },
            size: { width: 1, height: 1 },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  test('rejects zero width/height (minSize is 1)', () => {
    const result = GridResponseSchema.safeParse(
      gridPayload({
        positions: [
          {
            instanceId: 'x',
            position: { row: 0, column: 0 },
            size: { width: 0, height: 1 },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe('TilingResponseSchema', () => {
  test('accepts a minimal valid payload', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({ tree: [], instances: [] }),
    );
    expect(result.success).toBe(true);
  });

  test('accepts a tree with splits, instance ids, and null', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({
        tree: ['V', 'calendar-main', 'H', 'tasks-main', null],
        instances: [
          { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
          { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test('rejects non-array tree', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({ tree: 'not-an-array', instances: [] }),
    );
    expect(result.success).toBe(false);
  });

  test('rejects instance entries missing required fields', () => {
    const result = TilingResponseSchema.safeParse(
      tilingPayload({ tree: [], instances: [{ instanceId: 'x' }] }),
    );
    expect(result.success).toBe(false);
  });
});

describe('execution plan', () => {
  test('GridResponseSchema accepts optional paramsJson', () => {
    const result = GridResponseSchema.safeParse({
      ...gridPayload({ positions: [] }),
      executionPlan: [
        { instanceId: 'x', action: 'select', paramsJson: '{"id":"1"}' },
        { instanceId: 'y', action: 'close' },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('rejects executionPlan items missing instanceId', () => {
    const result = GridResponseSchema.safeParse({
      ...gridPayload({ positions: [] }),
      executionPlan: [{ action: 'select' }],
    });
    expect(result.success).toBe(false);
  });
});
