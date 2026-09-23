import { describe, expect, test } from 'bun:test';

import { InstanceId, type TilingNode } from '@maelstrom-co/protocol';

import {
  arrangementRelation,
  arrangementTree,
  enumerateArrangements,
  NOT_STATED,
  type PairAnswer,
  rankArrangements,
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
