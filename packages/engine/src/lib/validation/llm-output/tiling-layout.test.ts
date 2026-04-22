import { describe, expect, test } from 'bun:test';
import type { ChartRequest, TilingResponse } from '@maelstrom-co/protocol';
import { isErr, isOk } from '@maelstrom-co/protocol';

import { makeTilingRequest } from '../../__test-helpers__/fixtures.js';
import { validateTilingLayout } from './tiling-layout.js';

function makeTilingResponse(
  overrides: Partial<TilingResponse> = {},
): TilingResponse {
  return {
    userMessage: 'ok',
    rationale: 'splitting work area',
    executionPlan: [],
    layout: {
      tree: ['V', 'calendar-main', 'tasks-main'],
      instances: [
        {
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: 'month',
        },
        {
          instanceId: 'tasks-main',
          vesselId: 'calendar',
          variant: 'month',
        },
      ],
    },
    ...overrides,
  };
}

function requestWithVessels(): ChartRequest {
  return makeTilingRequest();
}

describe('validateTilingLayout', () => {
  test('accepts a well-formed tiling response', () => {
    expect(
      isOk(validateTilingLayout(makeTilingResponse(), requestWithVessels())),
    ).toBe(true);
  });

  test('accepts a single-leaf tree', () => {
    expect(
      isOk(
        validateTilingLayout(
          makeTilingResponse({
            layout: {
              tree: ['calendar-main'],
              instances: [
                {
                  instanceId: 'calendar-main',
                  vesselId: 'calendar',
                  variant: 'month',
                },
              ],
            },
          }),
          requestWithVessels(),
        ),
      ),
    ).toBe(true);
  });

  test('accepts nested splits with null (empty) leaves', () => {
    expect(
      isOk(
        validateTilingLayout(
          makeTilingResponse({
            layout: {
              tree: ['H', 'V', 'calendar-main', null, 'tasks-main'],
              instances: [
                {
                  instanceId: 'calendar-main',
                  vesselId: 'calendar',
                  variant: 'month',
                },
                {
                  instanceId: 'tasks-main',
                  vesselId: 'calendar',
                  variant: 'month',
                },
              ],
            },
          }),
          requestWithVessels(),
        ),
      ),
    ).toBe(true);
  });

  test('accepts an empty tree', () => {
    expect(
      isOk(
        validateTilingLayout(
          makeTilingResponse({
            layout: { tree: [], instances: [] },
          }),
          requestWithVessels(),
        ),
      ),
    ).toBe(true);
  });

  test('accepts all-null splits (no instances declared or referenced)', () => {
    expect(
      isOk(
        validateTilingLayout(
          makeTilingResponse({
            layout: { tree: ['H', null, null], instances: [] },
          }),
          requestWithVessels(),
        ),
      ),
    ).toBe(true);
  });

  test('accepts a 3-level nested tree', () => {
    expect(
      isOk(
        validateTilingLayout(
          makeTilingResponse({
            layout: {
              tree: ['H', 'V', 'a', 'b', 'H', 'c', 'd'],
              instances: [
                { instanceId: 'a', vesselId: 'calendar', variant: 'month' },
                { instanceId: 'b', vesselId: 'calendar', variant: 'month' },
                { instanceId: 'c', vesselId: 'calendar', variant: 'month' },
                { instanceId: 'd', vesselId: 'calendar', variant: 'month' },
              ],
            },
          }),
          requestWithVessels(),
        ),
      ),
    ).toBe(true);
  });

  test('accepts the same leaf id referenced twice in the tree (not currently flagged)', () => {
    expect(
      isOk(
        validateTilingLayout(
          makeTilingResponse({
            layout: {
              tree: ['V', 'calendar-main', 'calendar-main'],
              instances: [
                {
                  instanceId: 'calendar-main',
                  vesselId: 'calendar',
                  variant: 'month',
                },
              ],
            },
          }),
          requestWithVessels(),
        ),
      ),
    ).toBe(true);
  });

  test('fails with missing_rationale when rationale is empty', () => {
    const result = validateTilingLayout(
      makeTilingResponse({ rationale: '' }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({ kind: 'missing_rationale' });
  });

  test('fails with duplicate_instance_id when instances share an id', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'calendar-main', 'tasks-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
            {
              instanceId: 'tasks-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'duplicate_instance_id',
      instanceId: 'calendar-main',
    });
  });

  test('fails with unknown_vessel when instance references a vessel not in request', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['ghost-main'],
          instances: [
            {
              instanceId: 'ghost-main',
              vesselId: 'ghost-vessel',
              variant: 'any',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'unknown_vessel',
      instanceId: 'ghost-main',
      vesselId: 'ghost-vessel',
    });
  });

  test('fails with unknown_variant when instance variant is not on the vessel', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['calendar-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'nonexistent',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'unknown_variant',
      instanceId: 'calendar-main',
      variant: 'nonexistent',
    });
  });

  test('fails with tree_missing_child when a split is missing a child', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'calendar-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'tree_missing_child',
      atTokenIndex: 0,
    });
  });

  test('distinct split sites produce distinct tree_missing_child failures', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['H', 'V'],
          instances: [],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    const indices = result.error.failures
      .filter((f) => f.kind === 'tree_missing_child')
      .map((f) => (f as { atTokenIndex: number }).atTokenIndex)
      .sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]);
  });

  test('deduplicates tree_missing_child within the same split', () => {
    // A single 'V' with zero children should surface as one failure, not two.
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: { tree: ['V'], instances: [] },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    const missingChildren = result.error.failures.filter(
      (f) => f.kind === 'tree_missing_child',
    );
    expect(missingChildren).toHaveLength(1);
    expect(missingChildren[0]).toEqual({
      kind: 'tree_missing_child',
      atTokenIndex: 0,
    });
  });

  test('fails with tree_extra_tokens when tree has extra trailing tokens', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['calendar-main', 'tasks-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
            {
              instanceId: 'tasks-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'tree_extra_tokens',
      unconsumedCount: 1,
    });
  });

  test('fails with orphan_tree_reference when tree names an instance not declared', () => {
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'calendar-main', 'ghost'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.failures).toContainEqual({
      kind: 'orphan_tree_reference',
      instanceId: 'ghost',
    });
  });

  test('parses an adversarially deep all-splits tree without overflowing (iterative)', () => {
    // 10_000 split tokens in a row. The recursive parser would have blown
    // the JS call stack on this input.
    const deepTree: ('H' | 'V')[] = new Array(10_000).fill('H');
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: { tree: deepTree, instances: [] },
      }),
      requestWithVessels(),
    );
    // Malformed (all splits, no leaves) — we only care that we got back a
    // structured error, not a RangeError from stack overflow.
    expect(isErr(result)).toBe(true);
  });

  test('skips orphan-reference check when tree structure is invalid', () => {
    // A malformed tree cannot be reliably walked; orphan check should be
    // suppressed to avoid cascading false-positive failures.
    const result = validateTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'ghost'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    const kinds = result.error.failures.map((f) => f.kind);
    expect(kinds).toContain('tree_missing_child');
    expect(kinds).not.toContain('orphan_tree_reference');
  });
});
