import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';
import {
  assertValidSplitWeights,
  findDuplicateTilingLeaves,
  formatTilingSplitToken,
  type GridLayout,
  getVisibleInstanceIds,
  isInstanceIdNode,
  isTilingSplit,
  parseTilingSplitToken,
  type TilingLayout,
  type TilingNode,
  type TilingSplitRepairReason,
} from './response.js';
import { VariantName } from './variant-name.js';
import { VesselId } from './vessel-id.js';

describe('isInstanceIdNode', () => {
  test('true for a branded instance id', () => {
    expect(isInstanceIdNode(InstanceId('widget-1'))).toBe(true);
  });

  test('false for the split operators', () => {
    expect(isInstanceIdNode('H')).toBe(false);
    expect(isInstanceIdNode('V')).toBe(false);
  });

  test('false for weighted split tokens, malformed suffixes included', () => {
    expect(isInstanceIdNode('V:1,1,1')).toBe(false);
    expect(isInstanceIdNode('H:2,1')).toBe(false);
    expect(isInstanceIdNode('V:')).toBe(false);
    expect(isInstanceIdNode('H:abc')).toBe(false);
  });

  test('true for an id that merely starts with an axis letter', () => {
    expect(isInstanceIdNode(InstanceId('Header'))).toBe(true);
    expect(isInstanceIdNode(InstanceId('Vessel-1'))).toBe(true);
  });

  test('false for null', () => {
    expect(isInstanceIdNode(null)).toBe(false);
  });

  test('narrows the node to InstanceId at the type level', () => {
    const tree = [InstanceId('widget-1'), 'H' as const, null];
    const leaves = tree.filter(isInstanceIdNode);
    // Compile-time: every element of `leaves` is InstanceId.
    // Runtime: only the first element survives the filter.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toBe(InstanceId('widget-1'));
  });
});

describe('isTilingSplit', () => {
  test('true for H and V', () => {
    expect(isTilingSplit('H')).toBe(true);
    expect(isTilingSplit('V')).toBe(true);
  });

  test('false for a branded instance id', () => {
    expect(isTilingSplit(InstanceId('widget-1'))).toBe(false);
  });

  test('false for null', () => {
    expect(isTilingSplit(null)).toBe(false);
  });

  test('true for weighted tokens on both axes', () => {
    expect(isTilingSplit('V:1,1,1')).toBe(true);
    expect(isTilingSplit('H:2,1')).toBe(true);
  });

  test('claims axis-prefixed tokens whose weights are malformed', () => {
    // A prefixed token read as a leaf surfaces as "not declared in
    // layout.instances", which points at the wrong thing entirely.
    expect(isTilingSplit('V:')).toBe(true);
    expect(isTilingSplit('H:abc')).toBe(true);
    expect(isTilingSplit('V:1,,2')).toBe(true);
  });

  test('false for an id that merely starts with an axis letter', () => {
    expect(isTilingSplit(InstanceId('Header'))).toBe(false);
    expect(isTilingSplit(InstanceId('HV'))).toBe(false);
  });
});

describe('parseTilingSplitToken', () => {
  test('bare H and V parse as an even two-way split', () => {
    expect(parseTilingSplitToken('H')).toEqual({
      axis: 'H',
      weights: [1, 1],
      repaired: false,
      repairReason: null,
      discardedChildCount: 0,
    });
    expect(parseTilingSplitToken('V')).toEqual({
      axis: 'V',
      weights: [1, 1],
      repaired: false,
      repairReason: null,
      discardedChildCount: 0,
    });
  });

  test('null for nodes that are not split tokens', () => {
    expect(parseTilingSplitToken(null)).toBeNull();
    expect(parseTilingSplitToken(InstanceId('widget-1'))).toBeNull();
    expect(parseTilingSplitToken(InstanceId('Header'))).toBeNull();
  });

  test('weight count is the arity', () => {
    expect(parseTilingSplitToken('V:1,1,1')).toEqual({
      axis: 'V',
      weights: [1, 1, 1],
      repaired: false,
      repairReason: null,
      discardedChildCount: 0,
    });
    expect(parseTilingSplitToken('H:1,1,1,1,1,1')?.weights).toHaveLength(6);
  });

  test('uneven weights are preserved verbatim', () => {
    expect(parseTilingSplitToken('V:2,1')).toEqual({
      axis: 'V',
      weights: [2, 1],
      repaired: false,
      repairReason: null,
      discardedChildCount: 0,
    });
    expect(parseTilingSplitToken('H:3,1,4')?.weights).toEqual([3, 1, 4]);
  });

  const repairCases: readonly {
    readonly token: `${'H' | 'V'}:${string}`;
    readonly weights: readonly [number, number, ...number[]];
    readonly reason: TilingSplitRepairReason;
    readonly why: string;
  }[] = [
    { token: 'V:', weights: [1, 1], reason: 'unreadable', why: 'empty suffix' },
    {
      token: 'V:abc',
      weights: [1, 1],
      reason: 'unreadable',
      why: 'non-numeric single field',
    },
    {
      token: 'V:1',
      weights: [1, 1],
      reason: 'padded',
      why: 'single field pads to two',
    },
    {
      token: 'V:1,0,2',
      weights: [1, 1, 2],
      reason: 'unreadable',
      why: 'zero clamps to one',
    },
    {
      token: 'V:1,-4',
      weights: [1, 1],
      reason: 'unreadable',
      why: 'negative clamps to one',
    },
    {
      token: 'V:1,5000',
      weights: [1, 1000],
      reason: 'unreadable',
      why: 'above the weight cap',
    },
    {
      token: 'V:1,abc,2',
      weights: [1, 1, 2],
      reason: 'unreadable',
      why: 'non-numeric field',
    },
    {
      token: 'V:1.6,1',
      weights: [2, 1],
      reason: 'unreadable',
      why: 'fractional rounds',
    },
    {
      token: 'V:1,NaN',
      weights: [1, 1],
      reason: 'unreadable',
      why: 'literal NaN',
    },
    {
      token: 'V:1,Infinity',
      weights: [1, 1],
      reason: 'unreadable',
      why: 'non-finite',
    },
    // Spelling, not value: each of these coerces to a number the grammar
    // would accept, then re-serialises as a different string than the model
    // wrote. `repaired` is the only signal about model output quality, so a
    // silent rewrite here is exactly what it exists to catch.
    {
      token: 'V:0x0C,1',
      weights: [12, 1],
      reason: 'unreadable',
      why: 'hex literal',
    },
    {
      token: 'V:1e3,1',
      weights: [1000, 1],
      reason: 'unreadable',
      why: 'exponent notation',
    },
    {
      token: 'V:+2,1',
      weights: [2, 1],
      reason: 'unreadable',
      why: 'explicit sign',
    },
    {
      token: 'V:2.0,1',
      weights: [2, 1],
      reason: 'unreadable',
      why: 'trailing decimal point',
    },
    {
      token: 'V:01,1',
      weights: [1, 1],
      reason: 'unreadable',
      why: 'leading zero',
    },
    {
      token: 'V: 2 ,1',
      weights: [2, 1],
      reason: 'unreadable',
      why: 'surrounding whitespace',
    },
  ];

  for (const { token, weights, reason, why } of repairCases) {
    test(`repairs "${token}" to [${weights.join(',')}] (${why})`, () => {
      const parsed = parseTilingSplitToken(token);
      expect(parsed).toEqual({
        axis: 'V',
        weights,
        repaired: true,
        repairReason: reason,
        discardedChildCount: 0,
      });
    });
  }

  // An empty field declares nothing. Reading it as a child would raise the
  // token's arity, and arity is what advances the preorder cursor, so a stray
  // comma would make the split consume a subtree that belonged to an ancestor
  // — deleting an outer split from the layout rather than reproportioning it.
  const emptyFieldCases: readonly {
    readonly token: `${'H' | 'V'}:${string}`;
    readonly weights: readonly [number, number, ...number[]];
    readonly why: string;
  }[] = [
    { token: 'V:1,1,', weights: [1, 1], why: 'trailing comma' },
    { token: 'V:1,1,,', weights: [1, 1], why: 'two trailing commas' },
    { token: 'V:,1,1', weights: [1, 1], why: 'leading comma' },
    { token: 'V:1,,2', weights: [1, 2], why: 'interior empty field' },
    { token: 'V:,', weights: [1, 1], why: 'nothing but commas' },
    { token: 'V:1, ,2', weights: [1, 2], why: 'whitespace-only field' },
  ];

  for (const { token, weights, why } of emptyFieldCases) {
    test(`an empty field adds no child: "${token}" is arity ${weights.length} (${why})`, () => {
      const parsed = parseTilingSplitToken(token);
      expect(parsed).toEqual({
        axis: 'V',
        weights,
        repaired: true,
        repairReason: 'unreadable',
        discardedChildCount: 0,
      });
    });
  }

  test('truncates beyond the child cap and reports the discarded slots', () => {
    const parsed = parseTilingSplitToken(`V:${'1,'.repeat(19)}1`);
    expect(parsed?.weights).toHaveLength(12);
    expect(parsed?.repaired).toBe(true);
    // The subtrees the discarded slots would have consumed are re-parented,
    // not dropped, so the count is what lets a consumer treat truncation as a
    // reshape rather than a reproportion.
    expect(parsed?.discardedChildCount).toBe(8);
    expect(parsed?.repairReason).toBe('truncated');
  });

  test('truncation outranks a malformed field in the reported reason', () => {
    // Re-parenting the discarded slots' subtrees onto an ancestor reshapes the
    // tree; substituting a value for "abc" does not. A consumer wording one
    // message needs the consequential half.
    const parsed = parseTilingSplitToken(`V:abc,${'1,'.repeat(18)}1`);
    expect(parsed?.repairReason).toBe('truncated');
  });

  test('a well-formed token at the caps is not reported as repaired', () => {
    const parsed = parseTilingSplitToken(`H:${'1,'.repeat(11)}1000`);
    expect(parsed?.weights).toHaveLength(12);
    expect(parsed?.repaired).toBe(false);
    expect(parsed?.repairReason).toBeNull();
    expect(parsed?.discardedChildCount).toBe(0);
  });

  test('every parsed weight list is a usable arity', () => {
    for (const token of ['V', 'V:', 'V:abc', 'V:0', 'V:-1,-1'] as const) {
      const parsed = parseTilingSplitToken(token);
      expect(parsed).not.toBeNull();
      expect(parsed?.weights.length).toBeGreaterThanOrEqual(2);
      expect(parsed?.weights.every((w) => Number.isInteger(w) && w >= 1)).toBe(
        true,
      );
    }
  });
});

describe('formatTilingSplitToken', () => {
  test('even two-way splits render bare, so unweighted trees round-trip', () => {
    expect(formatTilingSplitToken('H', [1, 1])).toBe('H');
    expect(formatTilingSplitToken('V', [1, 1])).toBe('V');
  });

  test('anything else keeps its weights', () => {
    expect(formatTilingSplitToken('V', [1, 1, 1])).toBe('V:1,1,1');
    expect(formatTilingSplitToken('H', [2, 1])).toBe('H:2,1');
  });

  test('round-trips through the parser', () => {
    const cases: readonly (readonly [number, number, ...number[]])[] = [
      [1, 1],
      [2, 1],
      [1, 1, 1],
      [3, 1, 4, 1],
    ];
    for (const weights of cases) {
      const token = formatTilingSplitToken('V', weights);
      expect(parseTilingSplitToken(token)).toEqual({
        axis: 'V',
        weights: [...weights],
        repaired: false,
        repairReason: null,
        discardedChildCount: 0,
      });
    }
  });
});

describe('assertValidSplitWeights', () => {
  test('accepts every weight list the parser can produce', () => {
    for (const token of ['V', 'V:', 'V:abc', 'V:2,1', 'V:1,1000'] as const) {
      const parsed = parseTilingSplitToken(token);
      expect(parsed).not.toBeNull();
      if (parsed === null) throw new Error('expected a split');
      expect(() => assertValidSplitWeights(parsed.weights)).not.toThrow();
    }
  });

  test('rejects weights that are not usable extents', () => {
    expect(() => assertValidSplitWeights([0, 1])).toThrow(/out of range/);
    expect(() => assertValidSplitWeights([-5, 1])).toThrow(/out of range/);
    expect(() => assertValidSplitWeights([1.5, 1])).toThrow(/out of range/);
    expect(() => assertValidSplitWeights([1, 1001])).toThrow(/out of range/);
    expect(() => assertValidSplitWeights([Number.NaN, 1])).toThrow(
      /out of range/,
    );
  });

  test('rejects a list that is not a usable arity', () => {
    expect(() => assertValidSplitWeights([])).toThrow(/2 to 12 weights/);
    expect(() => assertValidSplitWeights([1])).toThrow(/2 to 12 weights/);
    expect(() => assertValidSplitWeights(Array(13).fill(1))).toThrow(
      /2 to 12 weights/,
    );
  });

  test('formatTilingSplitToken refuses to render an invalid weight', () => {
    expect(() => formatTilingSplitToken('V', [0, 1])).toThrow(/out of range/);
  });
});

describe('findDuplicateTilingLeaves', () => {
  test('empty when every leaf is distinct', () => {
    expect(
      findDuplicateTilingLeaves([
        'V:1,1,1',
        InstanceId('a'),
        InstanceId('b'),
        InstanceId('c'),
      ]),
    ).toEqual([]);
  });

  test('empty for an empty tree and for null-only leaves', () => {
    expect(findDuplicateTilingLeaves([])).toEqual([]);
    expect(findDuplicateTilingLeaves(['H', null, null])).toEqual([]);
  });

  test('reports the repeat, not the first occurrence', () => {
    expect(
      findDuplicateTilingLeaves(['V', InstanceId('a'), InstanceId('a')]),
    ).toEqual([{ instanceId: InstanceId('a'), atTokenIndex: 2 }]);
  });

  test('reports every repeat in ascending token order', () => {
    expect(
      findDuplicateTilingLeaves([
        'H',
        'V',
        InstanceId('a'),
        InstanceId('b'),
        'V',
        InstanceId('b'),
        InstanceId('a'),
      ]),
    ).toEqual([
      { instanceId: InstanceId('b'), atTokenIndex: 5 },
      { instanceId: InstanceId('a'), atTokenIndex: 6 },
    ]);
  });

  test('a leaf used three times yields two repeats', () => {
    expect(
      findDuplicateTilingLeaves([
        'V:1,1,1',
        InstanceId('a'),
        InstanceId('a'),
        InstanceId('a'),
      ]),
    ).toEqual([
      { instanceId: InstanceId('a'), atTokenIndex: 2 },
      { instanceId: InstanceId('a'), atTokenIndex: 3 },
    ]);
  });

  test('split tokens repeating is not duplication', () => {
    expect(
      findDuplicateTilingLeaves([
        'H',
        'V',
        InstanceId('a'),
        InstanceId('b'),
        'V',
        InstanceId('c'),
        InstanceId('d'),
      ]),
    ).toEqual([]);
  });
});

describe('getVisibleInstanceIds', () => {
  const weatherId = InstanceId('weather-1');
  const calendarId = InstanceId('calendar-1');
  const tasksId = InstanceId('tasks-1');

  test('returns only tiling tree leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['H', weatherId, 'V', null, calendarId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('handles a depth-5000 right spine without overflowing the call stack', () => {
    const depth = 5000;
    const tree: TilingNode[] = [];
    const expected: InstanceId[] = [];

    for (let index = 0; index < depth; index += 1) {
      const instanceId = InstanceId(`instance-${index}`);
      tree.push('H', instanceId);
      expected.push(instanceId);
    }

    const finalInstanceId = InstanceId(`instance-${depth}`);
    tree.push(finalInstanceId);
    expected.push(finalInstanceId);

    const layout: TilingLayout = { type: 'tiling', tree, instances: [] };

    expect([...getVisibleInstanceIds(layout)]).toEqual(expected);
  });

  test('handles a 10k all-splits malformed tree without visible leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: new Array<TilingNode>(10_000).fill('H'),
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([]);
  });

  test.each([
    {
      name: 'a split with both children missing',
      tree: ['H'] satisfies readonly TilingNode[],
      expected: [],
    },
    {
      name: 'a split with its right child missing',
      tree: ['H', weatherId] satisfies readonly TilingNode[],
      expected: [weatherId],
    },
    {
      name: 'a nested split with its final child missing',
      tree: ['H', weatherId, 'V', calendarId] satisfies readonly TilingNode[],
      expected: [weatherId, calendarId],
    },
  ])('collects encountered leaves from $name', ({ tree, expected }) => {
    const layout: TilingLayout = { type: 'tiling', tree, instances: [] };

    expect([...getVisibleInstanceIds(layout)]).toEqual([...expected]);
  });

  test('a weighted split consumes as many children as it declares', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['V:1,1,1', weatherId, calendarId, tasksId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([
      weatherId,
      calendarId,
      tasksId,
    ]);
  });

  test('tokens trailing a weighted root are not visible', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['V:1,1', weatherId, calendarId, tasksId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('a malformed weight suffix still consumes two children', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['V:abc', weatherId, calendarId, tasksId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('deduplicates repeated tiling leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['H', weatherId, weatherId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId]);
  });

  test('returns grid position instance IDs', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        {
          instanceId: weatherId,
          position: { row: 0, column: 0 },
          size: { width: 1, height: 1 },
        },
        {
          instanceId: calendarId,
          position: { row: 0, column: 1 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('deduplicates repeated grid positions', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        {
          instanceId: tasksId,
          position: { row: 0, column: 0 },
          size: { width: 1, height: 1 },
        },
        {
          instanceId: tasksId,
          position: { row: 1, column: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([tasksId]);
  });

  test('returns no visible Instances for a null layout', () => {
    expect([...getVisibleInstanceIds(null)]).toEqual([]);
  });

  test('ignores trailing tiling tokens after the first complete tree', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: [weatherId, calendarId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId]);
  });

  test('does not treat tiling declarations omitted from the tree as visible', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: [weatherId],
      instances: [
        {
          instanceId: weatherId,
          vesselId: VesselId('weather'),
          variant: VariantName('default'),
        },
        {
          instanceId: calendarId,
          vesselId: VesselId('calendar'),
          variant: VariantName('default'),
        },
      ],
    };

    expect(getVisibleInstanceIds(layout).has(weatherId)).toBe(true);
    expect(getVisibleInstanceIds(layout).has(calendarId)).toBe(false);
  });
});

describe('isInstanceIdNode + isTilingSplit partition TilingNode', () => {
  test('every non-null node is classified by exactly one predicate', () => {
    const nodes: TilingNode[] = [
      InstanceId('widget-1'),
      InstanceId('calendar-main'),
      InstanceId('Header'),
      'H',
      'V',
      'V:1,1,1',
      'H:2,1',
      'V:',
      'H:abc',
    ];
    for (const node of nodes) {
      expect(isInstanceIdNode(node) !== isTilingSplit(node)).toBe(true);
    }
  });

  test('null is classified by neither', () => {
    expect(isInstanceIdNode(null)).toBe(false);
    expect(isTilingSplit(null)).toBe(false);
  });
});

describe('isTilingSplit and parseTilingSplitToken agree', () => {
  test('a node is a split token exactly when it parses', () => {
    const nodes: TilingNode[] = [
      null,
      InstanceId('widget-1'),
      InstanceId('Header'),
      'H',
      'V',
      'V:1,1,1',
      'V:',
      'H:abc',
    ];
    for (const node of nodes) {
      expect(parseTilingSplitToken(node) !== null).toBe(isTilingSplit(node));
    }
  });
});
