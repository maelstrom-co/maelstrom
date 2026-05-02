import { describe, expect, test } from 'bun:test';
import type {
  ChartRequest,
  TilingNode,
  TilingResponse,
} from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';

import { makeTilingRequest } from '../../__test-helpers__/fixtures.js';
import { healTilingLayout } from './tiling-layout.js';

/**
 * Author-shape overrides for `TilingResponse` test fixtures. Accepts raw
 * strings for branded slots — brands erase at runtime, so the cast at the
 * boundary is sound for trusted fixture inputs.
 */
type TilingResponseAuthor = {
  readonly userMessage?: string;
  readonly rationale?: string;
  readonly executionPlan?: TilingResponse['executionPlan'];
  readonly layout?: {
    readonly tree: ReadonlyArray<'H' | 'V' | string | null>;
    readonly instances: ReadonlyArray<{
      readonly instanceId: string;
      readonly vesselId: string;
      readonly variant: string;
    }>;
  };
};

function makeTilingResponse(
  overrides: TilingResponseAuthor = {},
): TilingResponse {
  const base: TilingResponseAuthor = {
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
  };
  return { ...base, ...overrides } as TilingResponse;
}

function requestWithVessels(): ChartRequest {
  return makeTilingRequest();
}

/**
 * Brands raw strings as `InstanceId` for assertions against the healed
 * `readonly TilingNode[]` shape. Brands are erased at runtime, so this is
 * a type-only convenience for the test fixtures.
 */
function tree(...nodes: Array<'H' | 'V' | string | null>): TilingNode[] {
  return nodes.map((n) =>
    n === null || n === 'H' || n === 'V' ? n : InstanceId(n),
  );
}

describe('healTilingLayout', () => {
  test('healthy response heals to itself, no drops, no warnings', () => {
    const healed = healTilingLayout(makeTilingResponse(), requestWithVessels());
    expect(healed.layout.tree).toEqual(tree('V', 'calendar-main', 'tasks-main'));
    expect(healed.layout.instances).toHaveLength(2);
    expect(healed.droppedEntries).toEqual([]);
    expect(healed.warnings).toEqual([]);
  });

  test('orphan leaf: prune from tree, keep valid sibling', () => {
    const healed = healTilingLayout(
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

    // Split collapses to its surviving (valid) child.
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    expect(healed.droppedEntries).toContainEqual({
      reason: 'tree_orphan_reference',
      atTokenIndex: 2,
      instanceId: InstanceId('ghost'),
    });
  });

  test('unknown_vessel: instance dropped from list AND its leaf pruned from tree', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'calendar-main', 'bad'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
            {
              instanceId: 'bad',
              vesselId: 'no-such-vessel',
              variant: 'any',
            },
          ],
        },
      }),
      requestWithVessels(),
    );

    expect(healed.layout.instances.map((i) => i.instanceId)).toEqual([
      InstanceId('calendar-main'),
    ]);
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    const reasons = healed.droppedEntries.map((d) => d.reason);
    expect(reasons).toContain('unknown_vessel');
    expect(reasons).toContain('tree_orphan_reference'); // the leaf for 'bad'
  });

  test('extra trailing tokens: tree truncated to first complete subtree', () => {
    const healed = healTilingLayout(
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

    // First leaf is the root; 'tasks-main' is extra.
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    expect(healed.droppedEntries).toContainEqual({
      reason: 'tree_extra_tokens',
      fromTokenIndex: 1,
      count: 1,
    });
  });

  test('missing right child: split collapses to left subtree', () => {
    const healed = healTilingLayout(
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

    // Split is missing its right; collapse to the surviving left leaf.
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    expect(healed.droppedEntries).toContainEqual({
      reason: 'tree_missing_child',
      atTokenIndex: 0,
    });
  });

  test('null leaves are preserved (empty cells)', () => {
    const healed = healTilingLayout(
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
    );

    expect(healed.layout.tree).toEqual(
      tree('H', 'V', 'calendar-main', null, 'tasks-main'),
    );
    expect(healed.droppedEntries).toEqual([]);
  });

  test('all instances unknown_vessel: tree fully prunes, layout unrecoverable in spirit', () => {
    // Per the healer contract, this still returns a healed layout — just
    // with empty tree and instances. The retryHint (computed in Phase 4)
    // will mark this as recommend-retry. For now we just verify the shape.
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'a', 'b'],
          instances: [
            { instanceId: 'a', vesselId: 'no-such', variant: 'x' },
            { instanceId: 'b', vesselId: 'no-such', variant: 'x' },
          ],
        },
      }),
      requestWithVessels(),
    );

    expect(healed.layout.tree).toEqual(tree());
    expect(healed.layout.instances).toEqual([]);
    const reasons = healed.droppedEntries.map((d) => d.reason);
    expect(reasons.filter((r) => r === 'unknown_vessel')).toHaveLength(2);
  });

  test('empty rationale produces a warning, layout intact', () => {
    const healed = healTilingLayout(
      makeTilingResponse({ rationale: '' }),
      requestWithVessels(),
    );
    expect(healed.warnings).toEqual([{ kind: 'missing_rationale' }]);
    expect(healed.layout.tree).toEqual(tree('V', 'calendar-main', 'tasks-main'));
  });

  test('unknown_variant: instance dropped from list AND its leaf pruned from tree', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V', 'calendar-main', 'mystery'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
            {
              instanceId: 'mystery',
              vesselId: 'calendar',
              variant: 'no-such-variant',
            },
          ],
        },
      }),
      requestWithVessels(),
    );

    expect(healed.layout.instances.map((i) => i.instanceId)).toEqual([
      InstanceId('calendar-main'),
    ]);
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    const reasons = healed.droppedEntries.map((d) => d.reason);
    expect(reasons).toContain('unknown_variant');
    expect(reasons).toContain('tree_orphan_reference');
  });

  test('duplicate_instance_id in instances: keep first, drop subsequent', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['calendar-main'],
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
          ],
        },
      }),
      requestWithVessels(),
    );

    expect(healed.layout.instances).toHaveLength(1);
    expect(healed.droppedEntries).toContainEqual({
      reason: 'duplicate_instance_id',
      instanceId: InstanceId('calendar-main'),
    });
  });

  test('deep right-spine tree heals without stack overflow (iterative prune)', () => {
    // Build ['H', 'a0', 'H', 'a1', 'H', 'a2', …, 'aN'] for N=5000.
    // The AST is fully nested to depth N. A recursive prune would blow
    // the JS call stack on this; the iterative prune handles it.
    const N = 5000;
    const tree: TilingNode[] = [];
    const instances = [];
    for (let i = 0; i < N; i += 1) {
      tree.push('H');
      tree.push(`a${i}` as TilingNode);
      instances.push({
        instanceId: `a${i}`,
        vesselId: 'calendar',
        variant: 'month',
      });
    }
    tree.push(`a${N}` as TilingNode);
    instances.push({
      instanceId: `a${N}`,
      vesselId: 'calendar',
      variant: 'month',
    });

    const healed = healTilingLayout(
      makeTilingResponse({
        layout: { tree, instances },
      }),
      requestWithVessels(),
    );
    // All instances are valid → no orphan drops, full tree preserved.
    expect(healed.droppedEntries).toEqual([]);
    expect(healed.layout.tree.length).toBe(tree.length);
  });

  test('adversarial 10k all-splits tree heals to empty without stack overflow', () => {
    const deepTree: ('H' | 'V')[] = new Array(10_000).fill('H');
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: { tree: deepTree, instances: [] },
      }),
      requestWithVessels(),
    );
    expect(healed.layout.tree).toEqual(tree());
    // 10k missing_child drops, deduped per parent split index.
    const missing = healed.droppedEntries.filter(
      (d) => d.reason === 'tree_missing_child',
    );
    expect(missing.length).toBeGreaterThan(0);
  });

  test('single-leaf tree heals to itself', () => {
    const healed = healTilingLayout(
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
    );
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    expect(healed.droppedEntries).toEqual([]);
  });

  test('empty tree with no instances is a clean response', () => {
    const healed = healTilingLayout(
      makeTilingResponse({ layout: { tree: [], instances: [] } }),
      requestWithVessels(),
    );
    expect(healed.layout.tree).toEqual(tree());
    expect(healed.droppedEntries).toEqual([]);
    expect(healed.warnings).toEqual([]);
  });

  test('all-null splits with no instances: tree preserved verbatim', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: { tree: ['H', null, null], instances: [] },
      }),
      requestWithVessels(),
    );
    expect(healed.layout.tree).toEqual(tree('H', null, null));
    expect(healed.droppedEntries).toEqual([]);
  });

  test('3-level nested tree with all valid leaves heals to itself', () => {
    const healed = healTilingLayout(
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
    );
    expect(healed.layout.tree).toEqual(
      tree('H', 'V', 'a', 'b', 'H', 'c', 'd'),
    );
    expect(healed.droppedEntries).toEqual([]);
  });

  test('same leaf id referenced twice in the tree is preserved (not flagged)', () => {
    // Pins the contract that the heal does not dedup tree references.
    // Multiple leaves pointing at the same instance ID are valid (a
    // renderer may show the same panel in multiple split positions).
    const healed = healTilingLayout(
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
    );
    expect(healed.layout.tree).toEqual(
      tree('V', 'calendar-main', 'calendar-main'),
    );
    expect(healed.droppedEntries).toEqual([]);
  });

  test('distinct split sites produce distinct tree_missing_child drops', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: { tree: ['H', 'V'], instances: [] },
      }),
      requestWithVessels(),
    );
    const indices = healed.droppedEntries
      .filter((d) => d.reason === 'tree_missing_child')
      .map((d) => (d as { atTokenIndex: number }).atTokenIndex)
      .sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]);
  });

  test('deduplicates tree_missing_child within the same split', () => {
    // A single 'V' with zero children → one drop, not two. Reflects the
    // "one conceptual failure per parent split" policy carried over from
    // the original parser.
    const healed = healTilingLayout(
      makeTilingResponse({ layout: { tree: ['V'], instances: [] } }),
      requestWithVessels(),
    );
    const missing = healed.droppedEntries.filter(
      (d) => d.reason === 'tree_missing_child',
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toEqual({
      reason: 'tree_missing_child',
      atTokenIndex: 0,
    });
  });

  test('reports both missing_child and orphan_reference for a malformed tree with an orphan leaf', () => {
    // The healer parses a partial AST even on malformed input: the
    // missing right child is attributed during the post-parse unwind, and
    // the orphan check then runs against the surviving leaf. Both
    // failures are real corrections the LLM should make — the heal does
    // NOT suppress one because the other is also present.
    const healed = healTilingLayout(
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
    const reasons = healed.droppedEntries.map((d) => d.reason);
    expect(reasons).toContain('tree_missing_child');
    expect(reasons).toContain('tree_orphan_reference');
  });
});
