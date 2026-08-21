import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  getVisibleInstanceIds,
  InstanceId,
  type TilingLayout,
  type TilingNode,
} from '@maelstrom-co/protocol';
import { computeTilingLayout, parseTilingTree, type Rect } from './tiling.js';

let warnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('parseTilingTree', () => {
  it('returns null for empty nodes array', () => {
    expect(parseTilingTree([])).toBeNull();
  });

  it('parses a single leaf node', () => {
    const result = parseTilingTree([InstanceId('inst-1')]);
    expect(result).toEqual({ type: 'leaf', instanceId: InstanceId('inst-1') });
  });

  it('parses a null leaf node', () => {
    const result = parseTilingTree([null]);
    expect(result).toEqual({ type: 'leaf', instanceId: null });
  });

  it('parses a horizontal split with two leaves', () => {
    const result = parseTilingTree([
      'H',
      InstanceId('inst-1'),
      InstanceId('inst-2'),
    ]);
    expect(result).toEqual({
      type: 'split',
      direction: 'H',
      weights: [1, 1],
      children: [
        { type: 'leaf', instanceId: InstanceId('inst-1') },
        { type: 'leaf', instanceId: InstanceId('inst-2') },
      ],
    });
  });

  it('parses a vertical split with two leaves', () => {
    const result = parseTilingTree([
      'V',
      InstanceId('inst-1'),
      InstanceId('inst-2'),
    ]);
    expect(result).toEqual({
      type: 'split',
      direction: 'V',
      weights: [1, 1],
      children: [
        { type: 'leaf', instanceId: InstanceId('inst-1') },
        { type: 'leaf', instanceId: InstanceId('inst-2') },
      ],
    });
  });

  it('parses a weighted split, arity from the weight count', () => {
    const result = parseTilingTree([
      'V:1,1,1',
      InstanceId('a'),
      InstanceId('b'),
      InstanceId('c'),
    ]);
    expect(result).toEqual({
      type: 'split',
      direction: 'V',
      weights: [1, 1, 1],
      children: [
        { type: 'leaf', instanceId: InstanceId('a') },
        { type: 'leaf', instanceId: InstanceId('b') },
        { type: 'leaf', instanceId: InstanceId('c') },
      ],
    });
  });

  it('parses uneven weights verbatim', () => {
    const result = parseTilingTree(['H:2,1', InstanceId('a'), InstanceId('b')]);
    expect(result).toMatchObject({ direction: 'H', weights: [2, 1] });
  });

  it('falls back to an even two-way split for a malformed weight suffix', () => {
    const result = parseTilingTree(['V:abc', InstanceId('a'), InstanceId('b')]);
    expect(result).toMatchObject({ direction: 'V', weights: [1, 1] });
  });

  it('leaves an unfilled child slot undefined', () => {
    const result = parseTilingTree([
      'V:1,1,1',
      InstanceId('a'),
      InstanceId('b'),
    ]);
    expect(result).toMatchObject({
      weights: [1, 1, 1],
      children: [
        { type: 'leaf', instanceId: InstanceId('a') },
        { type: 'leaf', instanceId: InstanceId('b') },
        undefined,
      ],
    });
  });

  it('parses nested splits', () => {
    // H splits into inst-1 and (V splits inst-2 and inst-3)
    const result = parseTilingTree([
      'H',
      InstanceId('inst-1'),
      'V',
      InstanceId('inst-2'),
      InstanceId('inst-3'),
    ]);
    expect(result).toEqual({
      type: 'split',
      direction: 'H',
      weights: [1, 1],
      children: [
        { type: 'leaf', instanceId: InstanceId('inst-1') },
        {
          type: 'split',
          direction: 'V',
          weights: [1, 1],
          children: [
            { type: 'leaf', instanceId: InstanceId('inst-2') },
            { type: 'leaf', instanceId: InstanceId('inst-3') },
          ],
        },
      ],
    });
  });

  it('warns when trailing tokens remain unconsumed', () => {
    parseTilingTree([InstanceId('inst-1'), InstanceId('inst-2')]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unconsumed'));
  });

  it('warns when split node has missing children', () => {
    parseTilingTree(['H', InstanceId('inst-1')]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing'));
  });
});

describe('computeTilingLayout', () => {
  const containerRect: Rect = { x: 0, y: 0, width: 800, height: 600 };
  const weatherId = InstanceId('weather-1');
  const calendarId = InstanceId('calendar-1');

  const visibilityCases: readonly {
    readonly name: string;
    readonly tree: readonly TilingNode[];
    readonly expectedVisibleIds: readonly InstanceId[];
  }[] = [
    {
      name: 'trailing tokens',
      tree: [weatherId, calendarId],
      expectedVisibleIds: [weatherId],
    },
    {
      name: 'incomplete split',
      tree: ['H', weatherId],
      expectedVisibleIds: [weatherId],
    },
    {
      name: 'duplicate leaves',
      tree: ['H', weatherId, weatherId],
      expectedVisibleIds: [weatherId],
    },
    { name: 'null leaf', tree: [null], expectedVisibleIds: [] },
  ];

  for (const { name, tree, expectedVisibleIds } of visibilityCases) {
    it(`matches protocol visibility for ${name}`, () => {
      const layout: TilingLayout = { type: 'tiling', tree, instances: [] };
      const parsedTree = parseTilingTree(layout.tree);
      const computedTiles = computeTilingLayout(parsedTree, containerRect, 0);
      const expectedIds = new Set(expectedVisibleIds);
      const protocolIds = new Set(getVisibleInstanceIds(layout));
      const chartIds = new Set(
        computedTiles.map(({ instanceId }) => instanceId),
      );

      expect(protocolIds).toEqual(expectedIds);
      expect(chartIds).toEqual(expectedIds);
      expect(protocolIds).toEqual(chartIds);
    });
  }

  it('returns empty array for null tree', () => {
    expect(computeTilingLayout(null, containerRect, 0)).toEqual([]);
  });

  it('returns one tile for a single leaf', () => {
    const tree = parseTilingTree([InstanceId('inst-1')]);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 0);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].instanceId).toBe(InstanceId('inst-1'));
    expect(tiles[0].rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('skips null leaf nodes', () => {
    const tree = parseTilingTree([null]);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 0);
    expect(tiles).toHaveLength(0);
  });

  it('applies padding to tile rects', () => {
    const tree = parseTilingTree([InstanceId('inst-1')]);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 8);
    expect(tiles[0].rect).toEqual({ x: 4, y: 4, width: 792, height: 592 });
  });

  it('horizontal split divides container top/bottom equally', () => {
    const tree = parseTilingTree([
      'H',
      InstanceId('top'),
      InstanceId('bottom'),
    ]);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 0);
    const top = tiles.find((t) => t.instanceId === 'top');
    const bottom = tiles.find((t) => t.instanceId === 'bottom');
    if (!top || !bottom) throw new Error('expected top and bottom tiles');
    expect(top.rect.y).toBe(0);
    expect(top.rect.height).toBe(300);
    expect(bottom.rect.y).toBe(300);
    expect(bottom.rect.height).toBe(300);
  });

  it('vertical split divides container left/right equally', () => {
    const tree = parseTilingTree([
      'V',
      InstanceId('left'),
      InstanceId('right'),
    ]);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 0);
    const left = tiles.find((t) => t.instanceId === 'left');
    const right = tiles.find((t) => t.instanceId === 'right');
    if (!left || !right) throw new Error('expected left and right tiles');
    expect(left.rect.x).toBe(0);
    expect(left.rect.width).toBe(400);
    expect(right.rect.x).toBe(400);
    expect(right.rect.width).toBe(400);
  });

  it('merges duplicate instanceIds into bounding box', () => {
    // Tree: V split with same instanceId on both sides
    const tree = parseTilingTree([
      'V',
      InstanceId('inst-1'),
      InstanceId('inst-1'),
    ]);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 0);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].instanceId).toBe(InstanceId('inst-1'));
    // Bounding box should span the full container
    expect(tiles[0].rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

describe('computeTilingLayout — weighted splits', () => {
  const containerRect: Rect = { x: 0, y: 0, width: 900, height: 600 };

  function tilesOf(
    tree: readonly TilingNode[],
    rect: Rect = containerRect,
  ): Map<string, Rect> {
    const parsed = parseTilingTree(tree);
    if (!parsed) throw new Error('expected parsed tree');
    return new Map(
      computeTilingLayout(parsed, rect, 0).map(({ instanceId, rect: r }) => [
        instanceId as string,
        r,
      ]),
    );
  }

  function expectTilesRegion(tiles: Map<string, Rect>, region: Rect): void {
    const rects = [...tiles.values()];
    const area = rects.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(area).toBeCloseTo(region.width * region.height, 6);

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) throw new Error('expected rects');
        const overlapX =
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1e-9);
      }
    }
  }

  it('splits into exact thirds', () => {
    const tiles = tilesOf([
      'V:1,1,1',
      InstanceId('a'),
      InstanceId('b'),
      InstanceId('c'),
    ]);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 300, height: 600 });
    expect(tiles.get('b')).toEqual({ x: 300, y: 0, width: 300, height: 600 });
    expect(tiles.get('c')).toEqual({ x: 600, y: 0, width: 300, height: 600 });
  });

  it('honours uneven weights', () => {
    const tiles = tilesOf(['V:2,1', InstanceId('a'), InstanceId('b')]);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 600, height: 600 });
    expect(tiles.get('b')).toEqual({ x: 600, y: 0, width: 300, height: 600 });
  });

  it('lays out an exact 3x3', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const tree: TilingNode[] = ['H:1,1,1'];
    for (let row = 0; row < 3; row++) {
      tree.push('V:1,1,1');
      for (let col = 0; col < 3; col++) {
        tree.push(InstanceId(ids[row * 3 + col] ?? ''));
      }
    }

    const tiles = tilesOf(tree);
    expect(tiles.size).toBe(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        expect(tiles.get(`${ids[row * 3 + col]}`)).toEqual({
          x: col * 300,
          y: row * 200,
          width: 300,
          height: 200,
        });
      }
    }
    expectTilesRegion(tiles, containerRect);
  });

  it('lays out an exact 2x6', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const tree: TilingNode[] = ['H:1,1'];
    for (let row = 0; row < 2; row++) {
      tree.push('V:1,1,1,1,1,1');
      for (let col = 0; col < 6; col++) {
        tree.push(InstanceId(ids[row * 6 + col] ?? ''));
      }
    }

    const tiles = tilesOf(tree);
    expect(tiles.size).toBe(12);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 6; col++) {
        expect(tiles.get(`${ids[row * 6 + col]}`)).toEqual({
          x: col * 150,
          y: row * 300,
          width: 150,
          height: 300,
        });
      }
    }
    expectTilesRegion(tiles, containerRect);
  });

  it('tiles a container that does not divide evenly, with no gap or overlap', () => {
    const awkward: Rect = { x: 7, y: 11, width: 800, height: 505 };
    const tiles = tilesOf(
      [
        'H:1,1,1',
        'V:1,1,1',
        InstanceId('a'),
        InstanceId('b'),
        InstanceId('c'),
        'V:2,1',
        InstanceId('d'),
        InstanceId('e'),
        'V:1,1,1,1,1,1',
        ...Array.from({ length: 6 }, (_, i) => InstanceId(`f${i}`)),
      ],
      awkward,
    );

    expect(tiles.size).toBe(11);
    expectTilesRegion(tiles, awkward);

    const rects = [...tiles.values()];
    expect(Math.min(...rects.map((r) => r.x))).toBeCloseTo(awkward.x, 9);
    expect(Math.max(...rects.map((r) => r.x + r.width))).toBeCloseTo(
      awkward.x + awkward.width,
      9,
    );
    expect(Math.max(...rects.map((r) => r.y + r.height))).toBeCloseTo(
      awkward.y + awkward.height,
      9,
    );
  });

  it('bare H and V produce the same geometry as the explicit even weights', () => {
    const bare = tilesOf([
      'H',
      InstanceId('a'),
      'V',
      InstanceId('b'),
      InstanceId('c'),
    ]);
    const weighted = tilesOf([
      'H:1,1',
      InstanceId('a'),
      'V:1,1',
      InstanceId('b'),
      InstanceId('c'),
    ]);
    expect([...bare.entries()]).toEqual([...weighted.entries()]);
  });

  it('bare H and V geometry is unchanged from 50/50 bisection', () => {
    // Pins the pre-weights output exactly: an unweighted tree must render
    // byte-identically to what it rendered before splits gained weights.
    const tiles = tilesOf(
      ['H', InstanceId('a'), 'V', InstanceId('b'), InstanceId('c')],
      { x: 0, y: 0, width: 800, height: 600 },
    );
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 800, height: 300 });
    expect(tiles.get('b')).toEqual({ x: 0, y: 300, width: 400, height: 300 });
    expect(tiles.get('c')).toEqual({ x: 400, y: 300, width: 400, height: 300 });
  });

  it('applies padding per leaf, not per split', () => {
    const parsed = parseTilingTree([
      'V:1,1,1',
      InstanceId('a'),
      InstanceId('b'),
      InstanceId('c'),
    ]);
    if (!parsed) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(parsed, containerRect, 10);
    expect(tiles.map(({ rect }) => rect)).toEqual([
      { x: 5, y: 5, width: 290, height: 590 },
      { x: 305, y: 5, width: 290, height: 590 },
      { x: 605, y: 5, width: 290, height: 590 },
    ]);
  });

  it('an unfilled child slot leaves its region empty', () => {
    const tiles = tilesOf(['V:1,1,1', InstanceId('a'), InstanceId('b')]);
    expect(tiles.size).toBe(2);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 300, height: 600 });
    expect(tiles.get('b')).toEqual({ x: 300, y: 0, width: 300, height: 600 });
  });

  it('matches protocol visibility for a weighted tree', () => {
    const tree: readonly TilingNode[] = [
      'V:1,1,1',
      InstanceId('a'),
      null,
      InstanceId('c'),
    ];
    const layout: TilingLayout = { type: 'tiling', tree, instances: [] };
    const tiles = tilesOf(tree);
    expect(new Set(tiles.keys())).toEqual(
      new Set(getVisibleInstanceIds(layout)),
    );
  });
});
