import { describe, expect, spyOn, test } from 'bun:test';

import { InstanceId } from './instance.js';
import {
  assertValidSplitWeights,
  describeDuplicateTilingLeaf,
  findDuplicateTilingLeaves,
  findFirstDuplicateTilingLeaf,
  formatTilingSplitToken,
  type GridLayout,
  getVisibleInstanceIds,
  isInstanceIdNode,
  isTilingLeafTokenString,
  isTilingSplit,
  parseTilingSplitToken,
  type TilingLayout,
  type TilingNode,
  type TilingSplitRepairReason,
  tilingLeafInstanceId,
  tilingLeafToken,
} from './response.js';
import { VariantName } from './variant-name.js';
import { VesselId } from './vessel-id.js';

describe('isInstanceIdNode', () => {
  test('true for a prefixed leaf token', () => {
    expect(isInstanceIdNode('ID:widget-1')).toBe(true);
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
    expect(isInstanceIdNode('ID:Header')).toBe(true);
    expect(isInstanceIdNode('ID:Vessel-1')).toBe(true);
  });

  test('true for an id spelled exactly like a split token', () => {
    expect(isInstanceIdNode(tilingLeafToken(InstanceId('H')))).toBe(true);
    expect(isInstanceIdNode(tilingLeafToken(InstanceId('H:hero')))).toBe(true);
  });

  test('false for null', () => {
    expect(isInstanceIdNode(null)).toBe(false);
  });

  test('false for the bare prefix, which names no instance', () => {
    expect(isInstanceIdNode('ID:')).toBe(false);
  });

  test('narrows the node to a leaf token at the type level', () => {
    const tree: TilingNode[] = ['ID:widget-1', 'H', null];
    const leaves = tree.filter(isInstanceIdNode);
    // Compile-time: every element of `leaves` is TilingLeafToken.
    // Runtime: only the first element survives the filter.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toBe('ID:widget-1');
  });
});

describe('isTilingLeafTokenString', () => {
  test('true for the prefix followed by an instance id', () => {
    expect(isTilingLeafTokenString('ID:widget-1')).toBe(true);
  });

  test('false for an unprefixed token', () => {
    expect(isTilingLeafTokenString('widget-1')).toBe(false);
    expect(isTilingLeafTokenString('id:widget-1')).toBe(false);
    expect(isTilingLeafTokenString('')).toBe(false);
  });

  test('false for the bare prefix', () => {
    expect(isTilingLeafTokenString('ID:')).toBe(false);
  });
});

describe('tilingLeafToken and tilingLeafInstanceId', () => {
  test('a leaf token round trips through its instance id', () => {
    for (const id of ['a', 'calendar-main', 'H', 'V:1,1', 'ID:nested']) {
      const instanceId = InstanceId(id);
      expect(tilingLeafInstanceId(tilingLeafToken(instanceId))).toBe(
        instanceId,
      );
    }
  });

  test('renders the prefix followed by the id verbatim', () => {
    expect(tilingLeafToken(InstanceId('calendar-main'))).toBe(
      'ID:calendar-main',
    );
  });

  test('null for every node that is not a leaf', () => {
    expect(tilingLeafInstanceId(null)).toBeNull();
    expect(tilingLeafInstanceId('H')).toBeNull();
    expect(tilingLeafInstanceId('V:1,1,1')).toBeNull();
    expect(tilingLeafInstanceId('ID:')).toBeNull();
  });
});

describe('isTilingSplit', () => {
  test('true for H and V', () => {
    expect(isTilingSplit('H')).toBe(true);
    expect(isTilingSplit('V')).toBe(true);
  });

  test('false for a branded instance id', () => {
    expect(isTilingSplit('ID:widget-1')).toBe(false);
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
    expect(isTilingSplit('ID:Header')).toBe(false);
    expect(isTilingSplit('ID:HV')).toBe(false);
    expect(isTilingSplit(tilingLeafToken(InstanceId('H:hero')))).toBe(false);
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
    expect(parseTilingSplitToken('ID:widget-1')).toBeNull();
    expect(parseTilingSplitToken('ID:Header')).toBeNull();
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

  // The regex reads an all-digit field as a plain integer, but `Number`
  // overflows a long enough numeral to Infinity. The capping rule has to
  // survive a weight no double can hold.
  test('a numeral too large for a double caps rather than reading as one', () => {
    for (const digits of [400, 5000]) {
      expect(parseTilingSplitToken(`V:${'9'.repeat(digits)},1`)).toEqual({
        axis: 'V',
        weights: [1000, 1],
        repaired: true,
        repairReason: 'unreadable',
        discardedChildCount: 0,
      });
    }
  });

  // A token is model output, so nothing bounds how many fields it spells.
  // Reading one must not allocate in proportion to what the model wrote.
  test('an oversized token is counted without materialising its fields', () => {
    const hostile: `V:${string}` = `V:${'1,'.repeat(500_000)}1`;
    const split = spyOn(String.prototype, 'split');

    try {
      const parsed = parseTilingSplitToken(hostile);
      expect(split).not.toHaveBeenCalled();
      expect(parsed?.weights).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      expect(parsed?.discardedChildCount).toBe(499_989);
      expect(parsed?.repairReason).toBe('truncated');
    } finally {
      split.mockRestore();
    }
  });

  test('an oversized token still reads the weights it keeps', () => {
    const parsed = parseTilingSplitToken(`V:3,4${',1'.repeat(2000)}`);
    expect(parsed?.weights).toEqual([3, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(parsed?.discardedChildCount).toBe(1990);
    expect(parsed?.repairReason).toBe('truncated');
  });

  // Counting fields and splitting them apart are two spellings of one rule,
  // so a field that declares nothing has to disappear the same way in both.
  const oversizedEquivalents: readonly {
    readonly oversized: `${'H' | 'V'}:${string}`;
    readonly short: `${'H' | 'V'}:${string}`;
    readonly why: string;
  }[] = [
    {
      oversized: `V:1,${','.repeat(2000)}2`,
      short: 'V:1,,2',
      why: 'empty fields',
    },
    {
      oversized: `V:1,${' '.repeat(2000)},2`,
      short: 'V:1, ,2',
      why: 'a blank field',
    },
    {
      oversized: `V:2,1${','.repeat(2000)}`,
      short: 'V:2,1,',
      why: 'trailing commas',
    },
  ];

  for (const { oversized, short, why } of oversizedEquivalents) {
    test(`an oversized token drops ${why} as the short spelling does`, () => {
      expect(parseTilingSplitToken(oversized)).toEqual(
        parseTilingSplitToken(short),
      );
    });
  }

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
      findDuplicateTilingLeaves(['V:1,1,1', 'ID:a', 'ID:b', 'ID:c']),
    ).toEqual([]);
  });

  test('empty for an empty tree and for null-only leaves', () => {
    expect(findDuplicateTilingLeaves([])).toEqual([]);
    expect(findDuplicateTilingLeaves(['H', null, null])).toEqual([]);
  });

  test('reports the repeat, not the first occurrence', () => {
    expect(findDuplicateTilingLeaves(['V', 'ID:a', 'ID:a'])).toEqual([
      { instanceId: InstanceId('a'), atTokenIndex: 2 },
    ]);
  });

  test('reports every repeat in ascending token order', () => {
    expect(
      findDuplicateTilingLeaves([
        'H',
        'V',
        'ID:a',
        'ID:b',
        'V',
        'ID:b',
        'ID:a',
      ]),
    ).toEqual([
      { instanceId: InstanceId('b'), atTokenIndex: 5 },
      { instanceId: InstanceId('a'), atTokenIndex: 6 },
    ]);
  });

  test('a leaf used three times yields two repeats', () => {
    expect(
      findDuplicateTilingLeaves(['V:1,1,1', 'ID:a', 'ID:a', 'ID:a']),
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
        'ID:a',
        'ID:b',
        'V',
        'ID:c',
        'ID:d',
      ]),
    ).toEqual([]);
  });
});

describe('findFirstDuplicateTilingLeaf', () => {
  test('undefined when every leaf is distinct', () => {
    expect(
      findFirstDuplicateTilingLeaf(['V:1,1,1', 'ID:a', 'ID:b', 'ID:c']),
    ).toBeUndefined();
  });

  test('finds a duplicate early in a long tree without scanning the rest', () => {
    const tree: TilingNode[] = [
      'V',
      'ID:a',
      'ID:a',
      ...Array.from({ length: 500 }, (_, i) =>
        tilingLeafToken(InstanceId(`filler-${i}`)),
      ),
    ];

    expect(findFirstDuplicateTilingLeaf(tree)).toEqual({
      instanceId: InstanceId('a'),
      atTokenIndex: 2,
    });
  });

  test('returns the same first entry findDuplicateTilingLeaves(...).at(0) would', () => {
    const tree: TilingNode[] = ['H', 'V', 'ID:a', 'ID:b', 'V', 'ID:b', 'ID:a'];

    expect(findFirstDuplicateTilingLeaf(tree)).toEqual(
      findDuplicateTilingLeaves(tree).at(0),
    );
  });
});

describe('describeDuplicateTilingLeaf', () => {
  test('names the repeat, its token index and the remedy', () => {
    expect(
      describeDuplicateTilingLeaf({
        instanceId: InstanceId('calendar-side'),
        atTokenIndex: 5,
      }),
    ).toBe(
      'names instance "calendar-side" more than once (tree index 5). An instance renders as exactly one tile — weight the split token instead of repeating the leaf.',
    );
  });

  test('reads as the predicate of a caller-supplied subject', () => {
    const duplicates = findDuplicateTilingLeaves([
      'V',
      tilingLeafToken(InstanceId('a')),
      tilingLeafToken(InstanceId('a')),
    ]);

    expect(
      duplicates.map(
        (duplicate) =>
          `initialLayout.tree ${describeDuplicateTilingLeaf(duplicate)}`,
      ),
    ).toEqual([
      'initialLayout.tree names instance "a" more than once (tree index 2). An instance renders as exactly one tile — weight the split token instead of repeating the leaf.',
    ]);
  });
});

describe('getVisibleInstanceIds', () => {
  const weatherId = InstanceId('weather-1');
  const calendarId = InstanceId('calendar-1');
  const tasksId = InstanceId('tasks-1');
  const weatherLeaf = 'ID:weather-1' satisfies TilingNode;
  const calendarLeaf = 'ID:calendar-1' satisfies TilingNode;
  const tasksLeaf = 'ID:tasks-1' satisfies TilingNode;

  test('returns only tiling tree leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['H', weatherLeaf, 'V', null, calendarLeaf],
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
      tree.push('H', `ID:instance-${index}`);
      expected.push(instanceId);
    }

    tree.push(`ID:instance-${depth}`);
    expected.push(InstanceId(`instance-${depth}`));

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
      tree: ['H', weatherLeaf] satisfies readonly TilingNode[],
      expected: [weatherId],
    },
    {
      name: 'a nested split with its final child missing',
      tree: [
        'H',
        weatherLeaf,
        'V',
        calendarLeaf,
      ] satisfies readonly TilingNode[],
      expected: [weatherId, calendarId],
    },
  ])('collects encountered leaves from $name', ({ tree, expected }) => {
    const layout: TilingLayout = { type: 'tiling', tree, instances: [] };

    expect([...getVisibleInstanceIds(layout)]).toEqual([...expected]);
  });

  test('a weighted split consumes as many children as it declares', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['V:1,1,1', weatherLeaf, calendarLeaf, tasksLeaf],
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
      tree: ['V:1,1', weatherLeaf, calendarLeaf, tasksLeaf],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('a malformed weight suffix still consumes two children', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['V:abc', weatherLeaf, calendarLeaf, tasksLeaf],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('deduplicates repeated tiling leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['H', weatherLeaf, weatherLeaf],
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
      tree: [weatherLeaf, calendarLeaf],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId]);
  });

  test('does not treat tiling declarations omitted from the tree as visible', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: [weatherLeaf],
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
      'ID:widget-1',
      'ID:calendar-main',
      'ID:Header',
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
      'ID:widget-1',
      'ID:Header',
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
