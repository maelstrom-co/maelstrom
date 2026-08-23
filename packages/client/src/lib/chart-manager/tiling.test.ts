import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  getVisibleInstanceIds,
  InstanceId,
  type TilingLayout,
  type TilingNode,
} from '@maelstrom-co/protocol';
import {
  computeTilingLayout,
  createTilingSplitNode,
  parseTilingTree,
  type Rect,
} from './tiling.js';

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
    const result = parseTilingTree(['ID:inst-1']);
    expect(result).toEqual({ type: 'leaf', instanceId: InstanceId('inst-1') });
  });

  it('parses a null leaf node', () => {
    const result = parseTilingTree([null]);
    expect(result).toEqual({ type: 'leaf', instanceId: null });
  });

  it('parses a horizontal split with two leaves', () => {
    const result = parseTilingTree(['H', 'ID:inst-1', 'ID:inst-2']);
    // A split node's brand is type-level only, so the literal below is the
    // whole runtime object. Widening the actual is what lets a plain literal
    // stand in for a branded type; nothing about the value differs.
    expect<unknown>(result).toEqual({
      type: 'split',
      direction: 'H',
      children: [
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('inst-1') } },
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('inst-2') } },
      ],
    });
  });

  it('parses a vertical split with two leaves', () => {
    const result = parseTilingTree(['V', 'ID:inst-1', 'ID:inst-2']);
    expect<unknown>(result).toEqual({
      type: 'split',
      direction: 'V',
      children: [
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('inst-1') } },
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('inst-2') } },
      ],
    });
  });

  it('parses a weighted split, arity from the weight count', () => {
    const result = parseTilingTree(['V:1,1,1', 'ID:a', 'ID:b', 'ID:c']);
    expect<unknown>(result).toEqual({
      type: 'split',
      direction: 'V',
      children: [
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('a') } },
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('b') } },
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('c') } },
      ],
    });
  });

  it('parses uneven weights verbatim', () => {
    const result = parseTilingTree(['H:2,1', 'ID:a', 'ID:b']);
    expect(result).toMatchObject({
      direction: 'H',
      children: [{ weight: 2 }, { weight: 1 }],
    });
  });

  it('falls back to an even two-way split for a malformed weight suffix', () => {
    const result = parseTilingTree(['V:abc', 'ID:a', 'ID:b']);
    expect(result).toMatchObject({
      direction: 'V',
      children: [{ weight: 1 }, { weight: 1 }],
    });
  });

  it('warns that a malformed weight suffix was repaired', () => {
    // A seed layout never passes through the engine's heal, so an author who
    // writes ['V:abc', …] in a DEFAULT_LAYOUT gets a plausible render and,
    // without this, an empty console.
    parseTilingTree(['V:abc', 'ID:a', 'ID:b']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unreadable weight suffix'),
    );
  });

  it('warns that a split token past the arity limit was truncated', () => {
    parseTilingTree([
      'V:1,1,1,1,1,1,1,1,1,1,1,1,1',
      ...Array.from({ length: 12 }, (_, i): TilingNode => `ID:i${i}`),
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('re-parented onto an ancestor split'),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unreadable weight suffix'),
    );
  });

  it('warns that a one-weight token was padded rather than misread', () => {
    // "V:5" spells its single weight perfectly; what it got wrong is the
    // arity. Calling that an unreadable suffix sends the author after a typo
    // that is not there.
    parseTilingTree(['V:5', 'ID:a', 'ID:b']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('declares fewer than the two weights'),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unreadable weight suffix'),
    );
  });

  it('does not warn for a well-formed weighted token', () => {
    parseTilingTree(['V:2,1', 'ID:a', 'ID:b']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('leaves an unfilled child slot undefined', () => {
    const result = parseTilingTree(['V:1,1,1', 'ID:a', 'ID:b']);
    expect(result).toMatchObject({
      children: [
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('a') } },
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('b') } },
        { weight: 1, node: undefined },
      ],
    });
  });

  it('parses nested splits', () => {
    // H splits into inst-1 and (V splits inst-2 and inst-3)
    const result = parseTilingTree([
      'H',
      'ID:inst-1',
      'V',
      'ID:inst-2',
      'ID:inst-3',
    ]);
    expect<unknown>(result).toEqual({
      type: 'split',
      direction: 'H',
      children: [
        { weight: 1, node: { type: 'leaf', instanceId: InstanceId('inst-1') } },
        {
          weight: 1,
          node: {
            type: 'split',
            direction: 'V',
            children: [
              {
                weight: 1,
                node: { type: 'leaf', instanceId: InstanceId('inst-2') },
              },
              {
                weight: 1,
                node: { type: 'leaf', instanceId: InstanceId('inst-3') },
              },
            ],
          },
        },
      ],
    });
  });

  it('renders a token that is neither a split nor a leaf as empty space', () => {
    // Unreachable through the schema, which refuses such a token; a seed
    // layout written by hand reaches the parser without one.
    const result = parseTilingTree(['V', 'ID:a', 'b' as TilingNode]);
    expect(result).toMatchObject({
      children: [
        { node: { type: 'leaf', instanceId: InstanceId('a') } },
        { node: { type: 'leaf', instanceId: null } },
      ],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('neither a split nor an "ID:" leaf'),
    );
  });

  it('warns when trailing tokens remain unconsumed', () => {
    parseTilingTree(['ID:inst-1', 'ID:inst-2']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unconsumed'));
  });

  it('warns when split node has missing children', () => {
    parseTilingTree(['H', 'ID:inst-1']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing'));
  });

  it('locates a malformed split by token index, not by token text', () => {
    // The token is model output. Quoting it verbatim lets a crafted token
    // forge log lines, and the index is what the engine's own diagnostics
    // report anyway.
    parseTilingTree(['H', 'V:abc', 'ID:a', 'ID:b']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('split at token index 1'),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('V:abc'));
  });
});

describe('createTilingSplitNode', () => {
  it('builds a split whose weights pass validation', () => {
    const node = createTilingSplitNode('V', [
      { weight: 2, node: { type: 'leaf', instanceId: InstanceId('a') } },
      { weight: 1 },
    ]);
    expect<unknown>(node).toEqual({
      type: 'split',
      direction: 'V',
      children: [
        { weight: 2, node: { type: 'leaf', instanceId: InstanceId('a') } },
        { weight: 1, node: undefined },
      ],
    });
  });

  it('carries no runtime brand', () => {
    const node = createTilingSplitNode('V', [{ weight: 1 }, { weight: 1 }]);
    expect(Object.getOwnPropertySymbols(node)).toEqual([]);
    expect(
      node.children.flatMap((child) => Object.getOwnPropertySymbols(child)),
    ).toEqual([]);
  });

  it('rejects weights that sum to zero', () => {
    expect(() =>
      createTilingSplitNode('V', [{ weight: 1 }, { weight: -1 }]),
    ).toThrow(RangeError);
  });

  it('rejects a negative weight whose siblings hide it in the sum', () => {
    // [5, -1] sums to 4, so a guard on the total alone lets it through and
    // the second child gets a region that runs back over the first.
    expect(() =>
      createTilingSplitNode('V', [{ weight: 5 }, { weight: -1 }]),
    ).toThrow(RangeError);
  });

  it('rejects a fractional weight', () => {
    expect(() =>
      createTilingSplitNode('H', [{ weight: 1.5 }, { weight: 1 }]),
    ).toThrow(RangeError);
  });
});

describe('computeTilingLayout', () => {
  const containerRect: Rect = { x: 0, y: 0, width: 800, height: 600 };
  const weatherId = InstanceId('weather-1');
  const calendarId = InstanceId('calendar-1');
  const weatherLeaf = 'ID:weather-1' satisfies TilingNode;
  const calendarLeaf = 'ID:calendar-1' satisfies TilingNode;

  const visibilityCases: readonly {
    readonly name: string;
    readonly tree: readonly TilingNode[];
    readonly expectedVisibleIds: readonly InstanceId[];
  }[] = [
    {
      name: 'trailing tokens',
      tree: [weatherLeaf, calendarLeaf],
      expectedVisibleIds: [weatherId],
    },
    {
      name: 'incomplete split',
      tree: ['H', weatherLeaf],
      expectedVisibleIds: [weatherId],
    },
    { name: 'null leaf', tree: [null], expectedVisibleIds: [] },
    {
      name: 'a weighted split with a null in the middle',
      tree: ['V:1,1,1', weatherLeaf, null, calendarLeaf],
      expectedVisibleIds: [weatherId, calendarId],
    },
    {
      name: 'a weighted split one subtree short',
      tree: ['V:1,1,1', weatherLeaf, calendarLeaf],
      expectedVisibleIds: [weatherId, calendarId],
    },
    {
      name: 'a weighted split with a trailing token',
      tree: ['V:1,1', weatherLeaf, calendarLeaf, 'ID:never-placed'],
      expectedVisibleIds: [weatherId, calendarId],
    },
    {
      name: 'a malformed weight suffix falling back to two children',
      tree: ['V:abc', weatherLeaf, calendarLeaf, 'ID:never-placed'],
      expectedVisibleIds: [weatherId, calendarId],
    },
    {
      name: 'an empty weight field adding no child slot',
      tree: ['V:1,1,', weatherLeaf, calendarLeaf, 'ID:never-placed'],
      expectedVisibleIds: [weatherId, calendarId],
    },
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
    const tree = parseTilingTree(['ID:inst-1']);
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
    const tree = parseTilingTree(['ID:inst-1']);
    if (!tree) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(tree, containerRect, 8);
    expect(tiles[0].rect).toEqual({ x: 4, y: 4, width: 792, height: 592 });
  });

  it('horizontal split divides container top/bottom equally', () => {
    const tree = parseTilingTree(['H', 'ID:top', 'ID:bottom']);
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
    const tree = parseTilingTree(['V', 'ID:left', 'ID:right']);
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
    const tiles = tilesOf(['V:1,1,1', 'ID:a', 'ID:b', 'ID:c']);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 300, height: 600 });
    expect(tiles.get('b')).toEqual({ x: 300, y: 0, width: 300, height: 600 });
    expect(tiles.get('c')).toEqual({ x: 600, y: 0, width: 300, height: 600 });
  });

  it('honours uneven weights', () => {
    const tiles = tilesOf(['V:2,1', 'ID:a', 'ID:b']);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 600, height: 600 });
    expect(tiles.get('b')).toEqual({ x: 600, y: 0, width: 300, height: 600 });
  });

  it('honours uneven weights on the H axis', () => {
    const tiles = tilesOf(['H:2,1', 'ID:a', 'ID:b']);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 900, height: 400 });
    expect(tiles.get('b')).toEqual({ x: 0, y: 400, width: 900, height: 200 });
  });

  it('lays out an exact 3x3', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const tree: TilingNode[] = ['H:1,1,1'];
    for (let row = 0; row < 3; row++) {
      tree.push('V:1,1,1');
      for (let col = 0; col < 3; col++) {
        tree.push(`ID:${ids[row * 3 + col] ?? ''}`);
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
        tree.push(`ID:${ids[row * 6 + col] ?? ''}`);
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
        'ID:a',
        'ID:b',
        'ID:c',
        'V:2,1',
        'ID:d',
        'ID:e',
        'V:1,1,1,1,1,1',
        ...Array.from({ length: 6 }, (_, i): TilingNode => `ID:f${i}`),
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
    const bare = tilesOf(['H', 'ID:a', 'V', 'ID:b', 'ID:c']);
    const weighted = tilesOf(['H:1,1', 'ID:a', 'V:1,1', 'ID:b', 'ID:c']);
    expect([...bare.entries()]).toEqual([...weighted.entries()]);
  });

  it('bare H and V geometry is unchanged from 50/50 bisection', () => {
    // Pins the pre-weights output exactly: an unweighted tree must render
    // byte-identically to what it rendered before splits gained weights.
    const tiles = tilesOf(['H', 'ID:a', 'V', 'ID:b', 'ID:c'], {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 800, height: 300 });
    expect(tiles.get('b')).toEqual({ x: 0, y: 300, width: 400, height: 300 });
    expect(tiles.get('c')).toEqual({ x: 400, y: 300, width: 400, height: 300 });
  });

  it('applies padding per leaf, not per split', () => {
    const parsed = parseTilingTree(['V:1,1,1', 'ID:a', 'ID:b', 'ID:c']);
    if (!parsed) throw new Error('expected parsed tree');
    const tiles = computeTilingLayout(parsed, containerRect, 10);
    expect(tiles.map(({ rect }) => rect)).toEqual([
      { x: 5, y: 5, width: 290, height: 590 },
      { x: 305, y: 5, width: 290, height: 590 },
      { x: 605, y: 5, width: 290, height: 590 },
    ]);
  });

  it('an unfilled child slot leaves its region empty', () => {
    const tiles = tilesOf(['V:1,1,1', 'ID:a', 'ID:b']);
    expect(tiles.size).toBe(2);
    expect(tiles.get('a')).toEqual({ x: 0, y: 0, width: 300, height: 600 });
    expect(tiles.get('b')).toEqual({ x: 300, y: 0, width: 300, height: 600 });
  });
});
