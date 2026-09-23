import { describe, expect, test } from 'bun:test';

import { InstanceId, type TilingNode } from '@maelstrom-co/protocol';

import {
  arrangementRelation,
  arrangementTree,
  arrangementTreeAtMinimum,
  enumerateArrangements,
  equalArrangementTree,
  NOT_STATED,
  type PairAnswer,
  raiseToMinimum,
  rankArrangements,
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
    const [plain] = rankArrangements(THREE, pairs, []);
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

  test('without the redirect, not stated keeps one pair side by side in the best stacked tree', () => {
    const [best] = rankArrangements(THREE, pairs, sideBySide, stacked);
    expect(best?.arrangement.axis).toBe('H');
    expect(best?.arrangement.parts.some((part) => part.length > 1)).toBe(true);
  });

  test('a stacked direction sends not stated to above or below in the current order', () => {
    const [best] = rankArrangements(THREE, pairs, sideBySide, stacked, {
      redirectNotStated: true,
    });
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
      { redirectNotStated: true },
    );
    expect(best?.arrangement).toEqual({
      axis: 'V',
      parts: [[tasks], [weather], [calendar]],
    });
  });

  test('a not stated direction leaves not stated voting for the current relation', () => {
    const direction = { side_by_side: 0.1, stacked: 0.3, not_stated: 0.6 };
    const redirected = rankArrangements(THREE, pairs, sideBySide, direction, {
      redirectNotStated: true,
    });
    const plain = rankArrangements(THREE, pairs, sideBySide, direction);
    expect(redirected).toEqual(plain);
  });
});

describe('part sizing', () => {
  const focus = { axis: 'V' as const, parts: [[calendar], [weather, tasks]] };
  const shares = { [calendar]: 0.5, [weather]: 0.5, [tasks]: 0.5 };

  test('weights a part by the largest share of its members', () => {
    expect(arrangementTree(focus, shares, { partWeight: 'max' })).toEqual([
      'V',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(arrangementTree(focus, shares)[0]).toBe('V:1,2');
  });

  test('splits inside a part by the shares within the part', () => {
    expect(
      arrangementTree(focus, shares, {
        innerShareById: { [calendar]: 0.5, [weather]: 1, [tasks]: 0.5 },
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
