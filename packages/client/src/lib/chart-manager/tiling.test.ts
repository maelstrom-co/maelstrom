import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { InstanceId } from '@maelstrom-co/protocol';
import { parseTilingTree, computeTilingLayout, type Rect } from './tiling.js';

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
    expect(result).toEqual({ type: 'leaf', instanceId: 'inst-1' });
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
      left: { type: 'leaf', instanceId: 'inst-1' },
      right: { type: 'leaf', instanceId: 'inst-2' },
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
      left: { type: 'leaf', instanceId: 'inst-1' },
      right: { type: 'leaf', instanceId: 'inst-2' },
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
      left: { type: 'leaf', instanceId: 'inst-1' },
      right: {
        type: 'split',
        direction: 'V',
        left: { type: 'leaf', instanceId: 'inst-2' },
        right: { type: 'leaf', instanceId: 'inst-3' },
      },
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

  it('returns empty array for null tree', () => {
    expect(computeTilingLayout(null, containerRect, 0)).toEqual([]);
  });

  it('returns one tile for a single leaf', () => {
    const tree = parseTilingTree([InstanceId('inst-1')])!;
    const tiles = computeTilingLayout(tree, containerRect, 0);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].instanceId).toBe('inst-1');
    expect(tiles[0].rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('skips null leaf nodes', () => {
    const tree = parseTilingTree([null])!;
    const tiles = computeTilingLayout(tree, containerRect, 0);
    expect(tiles).toHaveLength(0);
  });

  it('applies padding to tile rects', () => {
    const tree = parseTilingTree([InstanceId('inst-1')])!;
    const tiles = computeTilingLayout(tree, containerRect, 8);
    expect(tiles[0].rect).toEqual({ x: 4, y: 4, width: 792, height: 592 });
  });

  it('horizontal split divides container top/bottom equally', () => {
    const tree = parseTilingTree([
      'H',
      InstanceId('top'),
      InstanceId('bottom'),
    ])!;
    const tiles = computeTilingLayout(tree, containerRect, 0);
    const top = tiles.find((t) => t.instanceId === 'top')!;
    const bottom = tiles.find((t) => t.instanceId === 'bottom')!;
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
    ])!;
    const tiles = computeTilingLayout(tree, containerRect, 0);
    const left = tiles.find((t) => t.instanceId === 'left')!;
    const right = tiles.find((t) => t.instanceId === 'right')!;
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
    ])!;
    const tiles = computeTilingLayout(tree, containerRect, 0);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].instanceId).toBe('inst-1');
    // Bounding box should span the full container
    expect(tiles[0].rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
