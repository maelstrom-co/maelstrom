import { describe, expect, test } from 'bun:test';

import { InstanceId, type TilingNode } from '@maelstrom-co/protocol';

import {
  arrangementRelation,
  arrangementTree,
  arrangementTreeAtMinimum,
  enumerateArrangements,
  equalArrangementTree,
  integerWeights,
  NOT_STATED,
  type PairAnswer,
  pickSizedTree,
  raiseToMinimum,
  rankArrangements,
  type SizedTreeCandidate,
  sizeShares,
  treeDirection,
  treeRelation,
} from './layout-composed-pairs-tree.js';

const [calendar, weather, tasks] = [
  InstanceId('calendar-main'),
  InstanceId('weather-main'),
  InstanceId('tasks-main'),
];
const THREE = [calendar, weather, tasks];

function certain(
  first: InstanceId,
  second: InstanceId,
  relation: string,
): PairAnswer {
  return { first, second, probabilities: { [relation]: 1 } };
}

/** A direction answer that states no top-level split. */
const NO_DIRECTION = { [NOT_STATED]: 1 };

describe('enumerateArrangements', () => {
  test.each([
    [2, 4],
    [3, 36],
    [5, 3360],
  ])('enumerates every distinct arrangement of %i Instances: %i', (n, count) => {
    const ids = Array.from({ length: n }, (_, index) =>
      InstanceId(`widget-${index}`),
    );
    const arrangements = enumerateArrangements(ids);
    expect(arrangements).toHaveLength(count);
    expect(
      new Set(arrangements.map((arrangement) => JSON.stringify(arrangement)))
        .size,
    ).toBe(count);
  });

  test('enumerates nothing for fewer than two Instances', () => {
    expect(enumerateArrangements([calendar])).toEqual([]);
  });
});

describe('relations', () => {
  const focus = {
    axis: 'V' as const,
    parts: [[calendar], [weather, tasks]],
  };

  test('reads the top axis across parts and the inner axis within a part', () => {
    expect(arrangementRelation(focus, calendar, weather)).toBe('left_of');
    expect(arrangementRelation(focus, tasks, calendar)).toBe('right_of');
    expect(arrangementRelation(focus, weather, tasks)).toBe('above');
    expect(arrangementRelation(focus, tasks, weather)).toBe('below');
  });

  test('reads any tree at the split where two leaves part', () => {
    const tree = [
      'H:1,2',
      'ID:map-main',
      'V',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ] as TilingNode[];
    expect(treeRelation(tree, 'map-main', 'tasks-main')).toBe('above');
    expect(treeRelation(tree, 'calendar-main', 'weather-main')).toBe('left_of');
    expect(treeRelation(tree, 'tasks-main', 'weather-main')).toBe('below');
    expect(treeRelation(tree, 'journal-main', 'weather-main')).toBeUndefined();
  });
});

describe('rankArrangements', () => {
  test('ranks the focus arrangement first and weights it by the shares', () => {
    const [best] = rankArrangements(
      THREE,
      [
        certain(calendar, weather, 'left_of'),
        certain(calendar, tasks, 'left_of'),
        certain(weather, tasks, 'above'),
      ],
      [],
      NO_DIRECTION,
    );
    expect(best?.arrangement).toEqual({
      axis: 'V',
      parts: [[calendar], [weather, tasks]],
    });
    expect(
      arrangementTree(best?.arrangement ?? { axis: 'V', parts: [] }, {
        [calendar]: 2 / 3,
        [weather]: 1 / 6,
        [tasks]: 1 / 6,
      }),
    ).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('not stated votes for the relation the current tree has', () => {
    const current = [
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ] as TilingNode[];
    const [best] = rankArrangements(
      THREE,
      [
        certain(calendar, weather, NOT_STATED),
        certain(calendar, tasks, NOT_STATED),
        certain(weather, tasks, NOT_STATED),
      ],
      current,
      NO_DIRECTION,
    );
    expect(best?.arrangement).toEqual({
      axis: 'H',
      parts: [[calendar], [weather], [tasks]],
    });
    expect(best?.score).toBe(0);
  });

  test('not stated is ignored for a pair the current tree does not hold', () => {
    const current = [
      'V',
      'ID:calendar-main',
      'ID:weather-main',
    ] as TilingNode[];
    const ranked = rankArrangements(
      THREE,
      [
        certain(calendar, weather, NOT_STATED),
        certain(calendar, tasks, NOT_STATED),
        certain(weather, tasks, NOT_STATED),
      ],
      current,
      NO_DIRECTION,
    );
    const best = ranked[0];
    expect(
      best && arrangementRelation(best.arrangement, calendar, weather),
    ).toBe('left_of');
    expect(Number.isFinite(best?.score)).toBe(true);
  });
});

describe('top-level direction', () => {
  const sideBySide = [
    'V:1,1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ] as TilingNode[];
  const leaning = (first: InstanceId, second: InstanceId): PairAnswer => ({
    first,
    second,
    probabilities: {
      left_of: 0.04,
      above: 0.39,
      below: 0.01,
      not_stated: 0.56,
    },
  });
  const leaningPairs = [
    leaning(calendar, weather),
    leaning(calendar, tasks),
    leaning(weather, tasks),
  ];

  test('reads the top split of a tree', () => {
    expect(treeDirection(sideBySide)).toBe('V');
    expect(treeDirection(['H', 'ID:calendar-main', 'ID:weather-main'])).toBe(
      'H',
    );
    expect(treeDirection(['ID:calendar-main'])).toBeUndefined();
    expect(treeDirection([])).toBeUndefined();
  });

  test('a stacked answer turns the top split stacked over pairs that lean to the current tree', () => {
    const [withoutDirection] = rankArrangements(
      THREE,
      leaningPairs,
      sideBySide,
      NO_DIRECTION,
    );
    expect(withoutDirection?.arrangement.axis).toBe('V');
    const [best] = rankArrangements(THREE, leaningPairs, sideBySide, {
      side_by_side: 0.05,
      stacked: 0.85,
      not_stated: 0.1,
    });
    expect(best?.arrangement.axis).toBe('H');
    expect(best && arrangementRelation(best.arrangement, calendar, tasks)).toBe(
      'above',
    );
  });

  test('a not stated direction votes for the current top split', () => {
    const [best] = rankArrangements(THREE, leaningPairs, sideBySide, {
      side_by_side: 0.02,
      stacked: 0.08,
      not_stated: 0.9,
    });
    expect(best?.arrangement.axis).toBe('V');
  });

  test("adds the log probability of each tree's top direction to its score", () => {
    const pairs = [
      certain(calendar, weather, 'left_of'),
      certain(calendar, tasks, 'left_of'),
      certain(weather, tasks, 'left_of'),
    ];
    const [plain] = rankArrangements(THREE, pairs, [], { side_by_side: 1 });
    const [directed] = rankArrangements(THREE, pairs, [], {
      side_by_side: 0.5,
      stacked: 0.5,
    });
    expect(directed?.arrangement).toEqual(plain?.arrangement);
    expect(directed?.score).toBeCloseTo((plain?.score ?? 0) + Math.log(0.5));
  });
});

describe('not stated redirected by the direction answer', () => {
  const sideBySide = [
    'V:1,1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ] as TilingNode[];
  const column = (first: InstanceId, second: InstanceId): PairAnswer => ({
    first,
    second,
    probabilities: { left_of: 0.02, above: 0.4, below: 0.03, not_stated: 0.55 },
  });
  const pairs = [
    column(calendar, weather),
    column(calendar, tasks),
    column(weather, tasks),
  ];
  const stacked = { side_by_side: 0, stacked: 1, not_stated: 0 };

  test('a stacked direction sends not stated to above or below in the current order', () => {
    const [best] = rankArrangements(THREE, pairs, sideBySide, stacked);
    expect(best?.arrangement).toEqual({
      axis: 'H',
      parts: [[calendar], [weather], [tasks]],
    });
  });

  test('a side by side direction sends not stated to left or right in the current order', () => {
    const current = [
      'H:1,1,1',
      'ID:tasks-main',
      'ID:weather-main',
      'ID:calendar-main',
    ] as TilingNode[];
    const [best] = rankArrangements(
      THREE,
      [
        certain(calendar, weather, NOT_STATED),
        certain(calendar, tasks, NOT_STATED),
        certain(weather, tasks, NOT_STATED),
      ],
      current,
      { side_by_side: 0.7, stacked: 0.1, not_stated: 0.2 },
    );
    expect(best?.arrangement).toEqual({
      axis: 'V',
      parts: [[tasks], [weather], [calendar]],
    });
  });
});

describe('not stated redirected only when the direction changes', () => {
  const columnThenTasks = [
    'V:1,1',
    'H:1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ] as TilingNode[];
  const unstated = [
    certain(calendar, weather, NOT_STATED),
    certain(calendar, tasks, NOT_STATED),
    certain(weather, tasks, NOT_STATED),
  ];
  const sideBySide = { side_by_side: 0.8, stacked: 0.1, not_stated: 0.1 };

  test('a direction along the current top split keeps the pairs inside each part', () => {
    const [best] = rankArrangements(
      THREE,
      unstated,
      columnThenTasks,
      sideBySide,
    );
    expect(best?.arrangement).toEqual({
      axis: 'V',
      parts: [[calendar, weather], [tasks]],
    });
  });

  test('a direction across the current top split still redirects every pair', () => {
    const stacked = { side_by_side: 0.1, stacked: 0.8, not_stated: 0.1 };
    const [best] = rankArrangements(THREE, unstated, columnThenTasks, stacked);
    expect(best?.arrangement).toEqual({
      axis: 'H',
      parts: [[calendar], [weather], [tasks]],
    });
  });
});

describe('part sizing', () => {
  const focus = { axis: 'V' as const, parts: [[calendar], [weather, tasks]] };
  const shares = { [calendar]: 0.5, [weather]: 0.5, [tasks]: 0.5 };

  test('weights a part by the summed shares of its members', () => {
    expect(arrangementTree(focus, shares)[0]).toBe('V:1,2');
  });

  test('splits inside a part by the shares within the part', () => {
    expect(
      arrangementTree(focus, shares, {
        innerSharesOf: (members) =>
          members.map((id) => (id === weather ? 2 / 3 : 1 / 3)),
      }),
    ).toEqual([
      'V:1,2',
      'ID:calendar-main',
      'H:2,1',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });
});

describe('size fallback', () => {
  const strip = {
    axis: 'H' as const,
    parts: [[calendar, weather], [tasks]],
  };

  test('raises shares below their minimum and scales the rest down', () => {
    const raised = raiseToMinimum([4, 1], [0, 0.3]);
    expect(raised?.[0]).toBeCloseTo(0.7);
    expect(raised?.[1]).toBeCloseTo(0.3);
    expect(raiseToMinimum([1, 1], [0.1, 0.1])).toEqual([0.5, 0.5]);
    expect(raiseToMinimum([1, 1], [0.6, 0.6])).toBeUndefined();
  });

  test('keeps the structure and lifts a thin part to its minimum', () => {
    const tree = arrangementTreeAtMinimum(
      strip,
      { [calendar]: 0.5, [weather]: 0.5, [tasks]: 0.25 },
      {
        [calendar]: { width: 0.2, height: 0.2 },
        [weather]: { width: 0.2, height: 0.2 },
        [tasks]: { width: 0.5, height: 1 / 3 },
      },
    );
    expect(tree).toEqual([
      'H:2,1',
      'V',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('writes integer weights that keep every raised share at its minimum', () => {
    const tree = arrangementTreeAtMinimum(
      strip,
      { [calendar]: 0.4, [weather]: 0.4, [tasks]: 0.2 },
      {
        [calendar]: { width: 4 / 30, height: 4 / 18 },
        [weather]: { width: 4 / 30, height: 4 / 18 },
        [tasks]: { width: 6 / 30, height: 4 / 18 },
      },
    );
    expect(tree?.[0]).toBe('H:7,2');
  });

  test('gives up when the minimums along one split cannot fit together', () => {
    expect(
      arrangementTreeAtMinimum(
        strip,
        { [calendar]: 0.5, [weather]: 0.5, [tasks]: 0.25 },
        {
          [calendar]: { width: 0.6, height: 0.2 },
          [weather]: { width: 0.6, height: 0.2 },
          [tasks]: { width: 0.5, height: 0.3 },
        },
      ),
    ).toBeUndefined();
  });

  test('writes every split of the structure with equal weights', () => {
    expect(equalArrangementTree(strip)).toEqual([
      'H',
      'V',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });
});

describe('pickSizedTree', () => {
  function candidate(name: string, score: number): SizedTreeCandidate {
    return {
      score,
      asSized: [`ID:${name}-as-sized`] as TilingNode[],
      raised: [`ID:${name}-raised`] as TilingNode[],
      equal: [`ID:${name}-equal`] as TilingNode[],
    };
  }

  function fitting(...trees: (readonly TilingNode[] | undefined)[]) {
    const fits = new Set(trees);
    return (tree: readonly TilingNode[]) => fits.has(tree);
  }

  test('ships the best tree as sized when it fits', () => {
    const best = candidate('best', -1);
    const next = candidate('next', -1.5);
    expect(
      pickSizedTree([best, next], fitting(best.asSized, next.asSized)),
    ).toEqual({ tree: best.asSized, chosen: 0 });
  });

  test('ships a lower tree as sized when it is at most the margin behind', () => {
    const best = candidate('best', -1);
    const next = candidate('next', -3);
    expect(
      pickSizedTree([best, next], fitting(best.raised, next.asSized)),
    ).toEqual({ tree: next.asSized, chosen: 1 });
  });

  test('raises the best tree to its minimums when the fitting tree is further behind than the margin', () => {
    const best = candidate('best', -1);
    const next = candidate('next', -3.01);
    expect(
      pickSizedTree([best, next], fitting(best.raised, next.asSized)),
    ).toEqual({
      tree: best.raised,
      fallback: { kind: 'raised_to_minimum', candidate: 0 },
    });
  });

  test('gives the best tree equal weights when it fits neither as sized nor raised', () => {
    const best = candidate('best', -1);
    const next = candidate('next', -4);
    expect(
      pickSizedTree([best, next], fitting(best.equal, next.asSized)),
    ).toEqual({
      tree: best.equal,
      fallback: { kind: 'equal_weights', candidate: 0 },
    });
  });

  test('skips a best tree that has no raised form', () => {
    const best = { ...candidate('best', -1), raised: undefined };
    const next = candidate('next', -4);
    expect(pickSizedTree([best, next], fitting(undefined, best.equal))).toEqual(
      {
        tree: best.equal,
        fallback: { kind: 'equal_weights', candidate: 0 },
      },
    );
  });

  test('goes on to the next tree with the same rules when the best fits in no form', () => {
    const best = candidate('best', -1);
    const next = candidate('next', -4);
    const last = candidate('last', -5);
    expect(
      pickSizedTree([best, next, last], fitting(next.raised, last.asSized)),
    ).toEqual({
      tree: last.asSized,
      chosen: 2,
    });
    expect(
      pickSizedTree([best, next, last], fitting(next.raised, last.equal)),
    ).toEqual({
      tree: next.raised,
      fallback: { kind: 'raised_to_minimum', candidate: 1 },
    });
  });

  test('returns undefined when no tree fits in any form', () => {
    expect(
      pickSizedTree([candidate('best', -1), candidate('next', -2)], fitting()),
    ).toBeUndefined();
  });
});

describe('sizeShares', () => {
  test('normalises to shares summing to 1', () => {
    expect(sizeShares([0.25, 0.25, 0.5, 0.5, 1])).toEqual([
      0.1, 0.1, 0.2, 0.2, 0.4,
    ]);
  });

  test('raises a zero share to the floor and still sums to 1', () => {
    const shares = sizeShares([0, 1, 1]);
    expect(shares[0]).toBeGreaterThan(0);
    expect(shares[0]).toBeCloseTo(0.05 / 1.05);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });

  test('all sizes zero reads as equal shares', () => {
    expect(sizeShares([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('integerWeights', () => {
  test('writes shares as the smallest integer ratio', () => {
    expect(integerWeights([0.2, 0.8])).toEqual([1, 4]);
    expect(integerWeights([0.2, 0.2, 0.4])).toEqual([1, 1, 2]);
    expect(integerWeights([0.1, 0.1])).toEqual([1, 1]);
    expect(integerWeights([1 / 3, 2 / 3])).toEqual([1, 2]);
    expect(integerWeights([0.25, 0.75])).toEqual([1, 3]);
  });

  test('every weight is a positive integer', () => {
    const weights = integerWeights([0.01, 0.99]);
    expect(weights.every((w) => Number.isInteger(w) && w >= 1)).toBe(true);
  });
});
