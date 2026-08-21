import { describe, expect, test } from 'bun:test';
import type {
  ChartRequest,
  TilingNode,
  TilingResponse,
  TilingSplitToken,
} from '@maelstrom-co/protocol';
import { InstanceId } from '@maelstrom-co/protocol';

import {
  brandTilingResponse,
  makeTilingRequest,
  type TilingResponseAuthor,
} from '../../__test-helpers__/fixtures.js';
import { healTilingLayout } from './tiling-layout.js';

function makeTilingResponse(
  overrides: Partial<TilingResponseAuthor> = {},
): TilingResponse {
  return brandTilingResponse({
    userMessage: overrides.userMessage ?? 'ok',
    rationale: overrides.rationale ?? 'splitting work area',
    executionPlan: overrides.executionPlan ?? [],
    layout: overrides.layout ?? {
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
  });
}

function requestWithVessels(): ChartRequest {
  return makeTilingRequest();
}

/**
 * Brands raw strings as `InstanceId` for assertions against the healed
 * `readonly TilingNode[]` shape. Split tokens, bare or weighted, pass
 * through. Brands are erased at runtime, so this is a type-only convenience
 * for the test fixtures.
 */
function tree(...nodes: Array<string | null>): TilingNode[] {
  return nodes.map((n) => {
    if (n === null) return n;
    return /^[HV](:|$)/.test(n) ? (n as TilingSplitToken) : InstanceId(n);
  });
}

describe('healTilingLayout', () => {
  test('healthy response heals to itself, no drops, no warnings', () => {
    const healed = healTilingLayout(makeTilingResponse(), requestWithVessels());
    expect(healed.layout.tree).toEqual(
      tree('V', 'calendar-main', 'tasks-main'),
    );
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
    expect(healed.layout.tree).toEqual(
      tree('V', 'calendar-main', 'tasks-main'),
    );
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
    expect(healed.layout.tree).toEqual(tree('H', 'V', 'a', 'b', 'H', 'c', 'd'));
    expect(healed.droppedEntries).toEqual([]);
  });

  test('same leaf id referenced twice in the tree is dropped to one', () => {
    // Pins the opposite of what this test used to assert. The shipped
    // renderer merges duplicate tiles into their bounding box, which is only
    // the right rectangle when the duplicates happen to form one — reorder
    // them or mix axes and the box swallows a sibling, silently. Weighted
    // splits remove the only sanctioned reason to repeat a leaf: claiming
    // more space now has a spelling that says so.
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
    // Removing the repeat leaves the split one child short, which collapses
    // it to its survivor.
    expect(healed.layout.tree).toEqual(tree('calendar-main'));
    expect(healed.droppedEntries).toEqual([
      {
        reason: 'tree_duplicate_leaf',
        atTokenIndex: 2,
        instanceId: InstanceId('calendar-main'),
      },
      { reason: 'tree_missing_child', atTokenIndex: 0 },
    ]);
  });

  test('first preorder occurrence of a duplicated leaf wins', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['V:1,1,1', 'a', 'b', 'a'],
          instances: [
            { instanceId: 'a', vesselId: 'calendar', variant: 'month' },
            { instanceId: 'b', vesselId: 'calendar', variant: 'month' },
          ],
        },
      }),
      requestWithVessels(),
    );
    expect(healed.layout.tree).toEqual(tree('V', 'a', 'b'));
    expect(healed.droppedEntries).toContainEqual({
      reason: 'tree_duplicate_leaf',
      atTokenIndex: 3,
      instanceId: InstanceId('a'),
    });
  });

  test('dropping a duplicate reshapes the tree around it', () => {
    const healed = healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: ['H', 'V', 'a', 'a', 'V', 'b', 'c'],
          instances: [
            { instanceId: 'a', vesselId: 'calendar', variant: 'month' },
            { instanceId: 'b', vesselId: 'calendar', variant: 'month' },
            { instanceId: 'c', vesselId: 'calendar', variant: 'month' },
          ],
        },
      }),
      requestWithVessels(),
    );
    // Removing a token from a preorder array re-parents everything after it:
    // the inner `V` slides into the slot the duplicate vacated, the outer `H`
    // is left one child short, and collapses to its survivor.
    expect(healed.layout.tree).toEqual(tree('V', 'a', 'V', 'b', 'c'));
    expect(healed.droppedEntries).toContainEqual({
      reason: 'tree_duplicate_leaf',
      atTokenIndex: 3,
      instanceId: InstanceId('a'),
    });
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

describe('healTilingLayout — weighted splits', () => {
  function healTree(
    tree: readonly (string | null)[],
    ids: readonly string[] = ['a', 'b', 'c', 'd', 'e', 'f'],
  ) {
    return healTilingLayout(
      makeTilingResponse({
        layout: {
          tree: [...tree],
          instances: ids.map((instanceId) => ({
            instanceId,
            vesselId: 'calendar',
            variant: 'month',
          })),
        },
      }),
      requestWithVessels(),
    );
  }

  test('bare H and V still heal to themselves', () => {
    const healed = healTree(['H', 'V', 'a', 'b', 'c']);
    expect(healed.layout.tree).toEqual(tree('H', 'V', 'a', 'b', 'c'));
    expect(healed.droppedEntries).toEqual([]);
    expect(healed.warnings).toEqual([]);
  });

  test('a three-way split consumes three subtrees', () => {
    const healed = healTree(['V:1,1,1', 'a', 'b', 'c']);
    expect(healed.layout.tree).toEqual(tree('V:1,1,1', 'a', 'b', 'c'));
    expect(healed.droppedEntries).toEqual([]);
    expect(healed.warnings).toEqual([]);
  });

  test('a 3x3 grid heals to itself', () => {
    const healed = healTree(
      [
        'H:1,1,1',
        'V:1,1,1',
        'a',
        'b',
        'c',
        'V:1,1,1',
        'd',
        'e',
        'f',
        'V:1,1,1',
        'g',
        'h',
        'i',
      ],
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    );
    expect(healed.layout.tree).toHaveLength(13);
    expect(healed.droppedEntries).toEqual([]);
  });

  test('uneven weights survive the round trip', () => {
    const healed = healTree(['V:2,1', 'a', 'b']);
    expect(healed.layout.tree).toEqual(tree('V:2,1', 'a', 'b'));
  });

  test('an even two-way weighted token normalizes to the bare spelling', () => {
    // Same geometry, and it keeps unweighted output byte-identical to what
    // the renderer has always received.
    const healed = healTree(['V:1,1', 'a', 'b']);
    expect(healed.layout.tree).toEqual(tree('V', 'a', 'b'));
  });

  test('a twelve-way split consumes twelve subtrees', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `w${i}`);
    const healed = healTree([`V:${ids.map(() => 1).join(',')}`, ...ids], ids);
    expect(healed.layout.tree).toHaveLength(13);
    expect(healed.droppedEntries).toEqual([]);
  });

  test('a pruned child takes its weight with it', () => {
    // 'orphan' is not in layout.instances, so it prunes; the surviving two
    // keep the ratio they were given.
    const healed = healTree(['V:3,1,2', 'a', 'orphan', 'b'], ['a', 'b']);
    expect(healed.layout.tree).toEqual(tree('V:3,2', 'a', 'b'));
    expect(healed.droppedEntries).toContainEqual({
      reason: 'tree_orphan_reference',
      atTokenIndex: 2,
      instanceId: InstanceId('orphan'),
    });
  });

  test('a split down to one survivor collapses to that survivor', () => {
    const healed = healTree(['V:1,1,1', 'x', 'a', 'y'], ['a']);
    expect(healed.layout.tree).toEqual(tree('a'));
  });

  test('a split with no survivors collapses to nothing', () => {
    const healed = healTree(['V:1,1,1', 'x', 'y', 'z'], ['a']);
    expect(healed.layout.tree).toEqual(tree());
  });

  test('fewer subtrees than declared reports a missing child on the prefix', () => {
    const healed = healTree(['V:1,1,1', 'a', 'b']);
    expect(healed.layout.tree).toEqual(tree('V', 'a', 'b'));
    expect(healed.droppedEntries).toEqual([
      { reason: 'tree_missing_child', atTokenIndex: 0 },
    ]);
  });

  test('more subtrees than declared leaves the extras unconsumed', () => {
    const healed = healTree(['V:1,1,1', 'a', 'b', 'c', 'd', 'e']);
    expect(healed.layout.tree).toEqual(tree('V:1,1,1', 'a', 'b', 'c'));
    expect(healed.droppedEntries).toEqual([
      { reason: 'tree_extra_tokens', fromTokenIndex: 4, count: 2 },
    ]);
  });

  test('an over-declared arity starves the ancestor, and that is detectable', () => {
    // The inner token claims three subtrees, so it swallows 'd', which the
    // outer split was going to use. The weight count is a checksum against
    // the subtree count: the shortfall surfaces as a missing child at the
    // ancestor rather than as silently uneven geometry.
    const healed = healTree(['H', 'V:1,1,1', 'a', 'b', 'd']);
    expect(healed.layout.tree).toEqual(tree('V:1,1,1', 'a', 'b', 'd'));
    expect(healed.droppedEntries).toEqual([
      { reason: 'tree_missing_child', atTokenIndex: 0 },
    ]);
  });

  const repairCases: readonly {
    readonly token: string;
    readonly weights: readonly number[];
    readonly healedTo: TilingSplitToken;
  }[] = [
    { token: 'V:', weights: [1, 1], healedTo: 'V' },
    { token: 'V:abc', weights: [1, 1], healedTo: 'V' },
    { token: 'V:1,0,2', weights: [1, 1, 2], healedTo: 'V:1,1,2' },
    { token: 'V:1,5000', weights: [1, 1000], healedTo: 'V:1,1000' },
  ];

  for (const { token, weights, healedTo } of repairCases) {
    test(`repairs "${token}" to [${weights.join(',')}] as a warning, not a drop`, () => {
      const healed = healTree([token, 'a', 'b', 'c']);
      expect(healed.warnings).toContainEqual({
        kind: 'split_weights_repaired',
        atTokenIndex: 0,
        token,
        weights,
      });
      expect(healed.droppedEntries).not.toContainEqual(
        expect.objectContaining({ reason: 'tree_duplicate_leaf' }),
      );
      expect(healed.layout.tree[0]).toBe(healedTo);
    });
  }

  test('a well-formed weighted token warns about nothing', () => {
    const healed = healTree(['V:2,1', 'a', 'b']);
    expect(healed.warnings).toEqual([]);
  });

  test('a token declaring twelve children with three following does not overflow', () => {
    const healed = healTree([
      `V:${Array(12).fill(1).join(',')}`,
      'a',
      'b',
      'c',
    ]);
    expect(healed.layout.tree).toEqual(tree('V:1,1,1', 'a', 'b', 'c'));
    expect(healed.droppedEntries).toEqual([
      { reason: 'tree_missing_child', atTokenIndex: 0 },
    ]);
  });

  test('a 10k weighted spine heals without stack overflow', () => {
    const spine: (string | null)[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      spine.push('V:1,1,1', `s${i}`, null);
      ids.push(`s${i}`);
    }
    spine.push(null);

    const healed = healTree(spine, ids);
    expect(healed.layout.tree.length).toBeGreaterThan(0);
    expect(healed.droppedEntries).toEqual([]);
  });

  test('a 10k all-weighted-splits tree heals to empty without stack overflow', () => {
    const healed = healTree(new Array(10_000).fill('V:1,1,1'), []);
    expect(healed.layout.tree).toEqual(tree());
    expect(healed.droppedEntries).toHaveLength(10_000);
  });
});
