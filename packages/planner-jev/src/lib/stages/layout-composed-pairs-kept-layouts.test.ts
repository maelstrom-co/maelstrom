import { describe, expect, test } from 'bun:test';

import { InstanceId, type TilingNode } from '@maelstrom-co/protocol';

import {
  equalKeptLayoutTree,
  type KeptLayoutCandidate,
  type KeptLayoutSizing,
  keptLayoutCandidates,
  keptLayoutTree,
  keptLayoutTreeAtMinimum,
  type LayoutShape,
  shapeKey,
  shapeOfTree,
} from './layout-composed-pairs-kept-layouts.js';

const [calendar, tasks, map, weather, journal] = [
  InstanceId('cal'),
  InstanceId('tasks'),
  InstanceId('map'),
  InstanceId('weather'),
  InstanceId('journal'),
];
const FOUR = [calendar, tasks, map, weather];
const FIVE = [calendar, tasks, map, weather, journal];

/** `H:4,1 [V [H cal tasks] map] weather`: a calendar and tasks column beside the map, above a weather strip. */
const COLUMN_BESIDE_MAP_OVER_STRIP = [
  'H:4,1',
  'V',
  'H',
  'ID:cal',
  'ID:tasks',
  'ID:map',
  'ID:weather',
] as TilingNode[];

/** `H:3,1 [V:2,1 [H cal tasks] map] [V weather journal]`. */
const COLUMN_BESIDE_MAP_OVER_PAIR = [
  'H:3,1',
  'V:2,1',
  'H',
  'ID:cal',
  'ID:tasks',
  'ID:map',
  'V',
  'ID:weather',
  'ID:journal',
] as TilingNode[];

const EQUAL_SHARES: KeptLayoutSizing = {
  shareById: { cal: 0.25, tasks: 0.25, map: 0.25, weather: 0.25 },
  statedFractionOf: () => undefined,
};

/** The demo minimums (calendar day 4 x 4, tasks 3 x 3, map 4 x 4, weather 6 x 4) as fractions of a 36 x 16 Chart. */
const DEMO_MINIMUMS = {
  cal: { width: 4 / 36, height: 4 / 16 },
  tasks: { width: 3 / 36, height: 3 / 16 },
  map: { width: 4 / 36, height: 4 / 16 },
  weather: { width: 6 / 36, height: 4 / 16 },
};

describe('the current layout as a candidate', () => {
  test('keeps a three-level current tree, with its weights', () => {
    const [current] = keptLayoutCandidates(COLUMN_BESIDE_MAP_OVER_STRIP, FOUR);
    expect(current?.kind).toBe('current_layout');
    expect(current && shapeKey(current.shape)).toBe(
      'H(V(H(cal,tasks),map),weather)',
    );
    expect(current && weightsOf(current.shape)).toEqual([
      [4, 1],
      [1, 1],
      [1, 1],
    ]);
  });

  test('is no candidate when it is a two-level tree the enumeration already holds', () => {
    const candidates = keptLayoutCandidates(
      ['V:2,1', 'H', 'ID:cal', 'ID:tasks', 'ID:map'] as TilingNode[],
      [calendar, tasks, map],
    );
    expect(candidates).toEqual([]);
  });
});

describe('the current tree with hidden widgets removed', () => {
  test('removes a hidden leaf and collapses the split it leaves with one child', () => {
    const shape = shapeOfTree(COLUMN_BESIDE_MAP_OVER_PAIR, [
      calendar,
      tasks,
      map,
      weather,
    ]);
    expect(shape && shapeKey(shape)).toBe('H(V(H(cal,tasks),map),weather)');
    expect(shape && weightsOf(shape)).toEqual([
      [3, 1],
      [2, 1],
      [1, 1],
    ]);
  });

  test('flattens a split into a parent along the same axis, scaling its weights by its share', () => {
    const shape = shapeOfTree(
      [
        'V:3,1',
        'H',
        'ID:journal',
        'V:1,2',
        'ID:cal',
        'ID:tasks',
        'ID:map',
      ] as TilingNode[],
      [calendar, tasks, map],
    );
    expect(shape && shapeKey(shape)).toBe('V(cal,tasks,map)');
    expect(shape && weightsOf(shape)).toEqual([[1, 2, 1]]);
  });

  test('is undefined when no visible widget is in the tree', () => {
    expect(shapeOfTree([], FOUR)).toBeUndefined();
    expect(shapeOfTree(['ID:journal'] as TilingNode[], FOUR)).toBeUndefined();
  });
});

describe('one widget moved', () => {
  test('places a new widget beside every node of the current tree, and never keeps the current tree without it', () => {
    const candidates = keptLayoutCandidates(
      ['V:2,1', 'H', 'ID:cal', 'ID:tasks', 'ID:map'] as TilingNode[],
      FOUR,
    );
    expect(candidates.map(({ kind }) => kind)).not.toContain('current_layout');
    expect(candidates.map(({ shape }) => shapeKey(shape))).toEqual([
      'H(weather,V(H(cal,tasks),map))',
      'H(V(H(cal,tasks),map),weather)',
      'V(H(V(weather,cal),tasks),map)',
      'V(H(V(cal,weather),tasks),map)',
      'V(H(cal,V(weather,tasks)),map)',
      'V(H(cal,V(tasks,weather)),map)',
    ]);
  });

  test('moves a widget beside a leaf across its parent split', () => {
    expect(
      keys(keptLayoutCandidates(COLUMN_BESIDE_MAP_OVER_PAIR, FIVE)),
    ).toContain('H(V(H(V(cal,journal),tasks),map),weather)');
  });

  test('moves a widget beside a subtree along its parent split', () => {
    const moved = byKey(
      keptLayoutCandidates(COLUMN_BESIDE_MAP_OVER_PAIR, FIVE),
      'H(V(H(cal,tasks),journal,map),weather)',
    );
    expect(moved?.kind).toBe('one_widget_moved');
  });

  test('moves a widget beside the whole tree, before and after, along both axes', () => {
    const all = keys(keptLayoutCandidates(COLUMN_BESIDE_MAP_OVER_PAIR, FIVE));
    for (const key of [
      'V(journal,H(V(H(cal,tasks),map),weather))',
      'V(H(V(H(cal,tasks),map),weather),journal)',
      'H(journal,V(H(cal,tasks),map),weather)',
      'H(V(H(cal,tasks),map),weather,journal)',
    ])
      expect(all).toContain(key);
  });

  test('gives a widget inserted into a split along the same axis an equal share of the leaves under it', () => {
    const candidates = keptLayoutCandidates(COLUMN_BESIDE_MAP_OVER_PAIR, FIVE);
    const besideColumn = byKey(
      candidates,
      'H(V(H(cal,tasks),journal,map),weather)',
    );
    expect(besideColumn && weightsOf(besideColumn.shape)[1]).toEqual([2, 1, 1]);
    const besideCalendar = byKey(
      candidates,
      'H(V(H(cal,journal,tasks),map),weather)',
    );
    expect(besideCalendar && weightsOf(besideCalendar.shape)[2]).toEqual([
      1, 1, 1,
    ]);
  });

  test('drops two-level shapes and repeated shapes', () => {
    const candidates = keptLayoutCandidates(COLUMN_BESIDE_MAP_OVER_PAIR, FIVE);
    const all = keys(candidates);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('H(cal,tasks,V(weather,journal),map)');
    expect(candidates.every(({ shape }) => !isTwoLevel(shape))).toBe(true);
  });
});

describe('kept layout sizing', () => {
  const current = () => {
    const [candidate] = keptLayoutCandidates(
      COLUMN_BESIDE_MAP_OVER_STRIP,
      FOUR,
    );
    if (candidate === undefined) throw new Error('no current layout');
    return candidate.shape;
  };

  test('a split copied from the current tree keeps its weights', () => {
    expect(
      keptLayoutTree(current(), {
        shareById: { cal: 0.1, tasks: 0.5, map: 0.3, weather: 0.1 },
        statedFractionOf: () => undefined,
      }),
    ).toEqual(COLUMN_BESIDE_MAP_OVER_STRIP);
  });

  test('a stated fraction of a leaf applies inside the copied split that holds it', () => {
    const [candidate] = keptLayoutCandidates(
      [
        'H:4,1',
        'V:3,1',
        'H:3,1',
        'ID:cal',
        'ID:tasks',
        'ID:map',
        'ID:weather',
      ] as TilingNode[],
      FOUR,
    );
    expect(
      candidate &&
        keptLayoutTree(candidate.shape, {
          ...EQUAL_SHARES,
          statedFractionOf: (id) => (id === tasks ? 0.5 : undefined),
        }),
    ).toEqual([
      'H:4,1',
      'V:3,1',
      'H',
      'ID:cal',
      'ID:tasks',
      'ID:map',
      'ID:weather',
    ]);
  });

  test('a new split weights its children by the summed shares of the leaves under them', () => {
    const [strip] = keptLayoutCandidates(
      ['V:2,1', 'H', 'ID:cal', 'ID:tasks', 'ID:map'] as TilingNode[],
      FOUR,
    ).filter(
      ({ shape }) => shapeKey(shape) === 'H(V(H(cal,tasks),map),weather)',
    );
    expect(strip && keptLayoutTree(strip.shape, EQUAL_SHARES)).toEqual([
      'H:3,1',
      'V:2,1',
      'H',
      'ID:cal',
      'ID:tasks',
      'ID:map',
      'ID:weather',
    ]);
  });

  test('a new split of leaves below the top splits by their whole-Chart shares', () => {
    const [beside] = keptLayoutCandidates(
      ['V:2,1', 'H', 'ID:cal', 'ID:tasks', 'ID:map'] as TilingNode[],
      FOUR,
    ).filter(
      ({ shape }) => shapeKey(shape) === 'V(H(V(weather,cal),tasks),map)',
    );
    expect(
      beside &&
        keptLayoutTree(beside.shape, {
          shareById: { cal: 0.3, tasks: 0.3, map: 0.3, weather: 0.1 },
          statedFractionOf: () => undefined,
        }),
    ).toEqual([
      'V:2,1',
      'H',
      'V:1,3',
      'ID:weather',
      'ID:cal',
      'ID:tasks',
      'ID:map',
    ]);
  });

  test('raises a thin strip three levels down to its minimum', () => {
    expect(keptLayoutTree(current(), EQUAL_SHARES)[0]).toBe('H:4,1');
    expect(
      keptLayoutTreeAtMinimum(current(), EQUAL_SHARES, DEMO_MINIMUMS),
    ).toEqual([
      'H:3,1',
      'V',
      'H',
      'ID:cal',
      'ID:tasks',
      'ID:map',
      'ID:weather',
    ]);
  });

  test('gives up when the minimums along one split cannot fit together', () => {
    expect(
      keptLayoutTreeAtMinimum(current(), EQUAL_SHARES, {
        ...DEMO_MINIMUMS,
        weather: { width: 6 / 36, height: 10 / 16 },
      }),
    ).toBeUndefined();
  });

  test('writes every split with equal weights', () => {
    expect(equalKeptLayoutTree(current())).toEqual([
      'H',
      'V',
      'H',
      'ID:cal',
      'ID:tasks',
      'ID:map',
      'ID:weather',
    ]);
  });
});

function keys(candidates: readonly KeptLayoutCandidate[]): string[] {
  return candidates.map(({ shape }) => shapeKey(shape));
}

function byKey(
  candidates: readonly KeptLayoutCandidate[],
  key: string,
): KeptLayoutCandidate | undefined {
  return candidates.find(({ shape }) => shapeKey(shape) === key);
}

function weightsOf(shape: LayoutShape): (readonly number[])[] {
  if (shape.kind === 'leaf') return [];
  return [shape.weights, ...shape.children.flatMap(weightsOf)];
}

function isTwoLevel(shape: LayoutShape): boolean {
  return (
    shape.kind === 'split' &&
    shape.children.length <= 4 &&
    shape.children.every(
      (child) =>
        child.kind === 'leaf' ||
        child.children.every((member) => member.kind === 'leaf'),
    )
  );
}
