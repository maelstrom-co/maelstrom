import { describe, expect, it } from 'bun:test';

import type { TilingNode } from '@maelstrom-co/protocol-old';

import {
  computeTilingLayout,
  getVisibleInstanceIds,
  parseTilingTree,
  type Rect,
} from './tiling.js';

const CONTAINER: Rect = { x: 0, y: 0, width: 100, height: 100 };

describe('parseTilingTree', () => {
  it('should return null for empty array', () => {
    expect(parseTilingTree([])).toBeNull();
  });

  it('should parse a single leaf', () => {
    const result = parseTilingTree(['instance-1']);

    expect(result).toEqual({ type: 'leaf', instanceId: 'instance-1' });
  });

  it('should parse a null leaf', () => {
    const result = parseTilingTree([null]);

    expect(result).toEqual({ type: 'leaf', instanceId: null });
  });

  it('should parse a V split with two leaves', () => {
    const result = parseTilingTree(['V', 'left', 'right']);

    expect(result).toEqual({
      type: 'split',
      direction: 'V',
      left: { type: 'leaf', instanceId: 'left' },
      right: { type: 'leaf', instanceId: 'right' },
    });
  });

  it('should parse an H split with two leaves', () => {
    const result = parseTilingTree(['H', 'top', 'bottom']);

    expect(result).toEqual({
      type: 'split',
      direction: 'H',
      left: { type: 'leaf', instanceId: 'top' },
      right: { type: 'leaf', instanceId: 'bottom' },
    });
  });

  it('should parse nested splits', () => {
    // V split: left is a leaf, right is an H split
    const result = parseTilingTree([
      'V',
      'left',
      'H',
      'top-right',
      'bottom-right',
    ]);

    expect(result).toEqual({
      type: 'split',
      direction: 'V',
      left: { type: 'leaf', instanceId: 'left' },
      right: {
        type: 'split',
        direction: 'H',
        left: { type: 'leaf', instanceId: 'top-right' },
        right: { type: 'leaf', instanceId: 'bottom-right' },
      },
    });
  });

  it('should handle split with missing right child', () => {
    const result = parseTilingTree(['V', 'left'] as TilingNode[]);

    expect(result).toEqual({
      type: 'split',
      direction: 'V',
      left: { type: 'leaf', instanceId: 'left' },
    });
  });
});

describe('computeTilingLayout', () => {
  it('should return empty array for null tree', () => {
    expect(computeTilingLayout(null, CONTAINER, 0)).toEqual([]);
  });

  it('should place single vessel in full container', () => {
    const tree = parseTilingTree(['instance-1'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 0);

    expect(tiles).toEqual([
      {
        instanceId: 'instance-1',
        rect: { x: 0, y: 0, width: 100, height: 100 },
      },
    ]);
  });

  it('should split vertically', () => {
    const tree = parseTilingTree(['V', 'left', 'right'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 0);

    expect(tiles).toEqual([
      { instanceId: 'left', rect: { x: 0, y: 0, width: 50, height: 100 } },
      { instanceId: 'right', rect: { x: 50, y: 0, width: 50, height: 100 } },
    ]);
  });

  it('should split horizontally', () => {
    const tree = parseTilingTree(['H', 'top', 'bottom'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 0);

    expect(tiles).toEqual([
      { instanceId: 'top', rect: { x: 0, y: 0, width: 100, height: 50 } },
      { instanceId: 'bottom', rect: { x: 0, y: 50, width: 100, height: 50 } },
    ]);
  });

  it('should skip null leaves', () => {
    const tree = parseTilingTree(['V', null, 'right'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 0);

    expect(tiles).toEqual([
      { instanceId: 'right', rect: { x: 50, y: 0, width: 50, height: 100 } },
    ]);
  });

  it('should apply padding', () => {
    const tree = parseTilingTree(['instance-1'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 10);

    expect(tiles).toEqual([
      { instanceId: 'instance-1', rect: { x: 5, y: 5, width: 90, height: 90 } },
    ]);
  });

  it('should apply padding on split children', () => {
    const tree = parseTilingTree(['V', 'left', 'right'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 10);

    expect(tiles).toEqual([
      { instanceId: 'left', rect: { x: 5, y: 5, width: 40, height: 90 } },
      { instanceId: 'right', rect: { x: 55, y: 5, width: 40, height: 90 } },
    ]);
  });

  it('should clamp to zero when padding exceeds dimensions', () => {
    const tree = parseTilingTree(['instance-1'])!;
    const smallContainer: Rect = { x: 0, y: 0, width: 4, height: 4 };
    const tiles = computeTilingLayout(tree, smallContainer, 10);

    expect(tiles[0].rect.width).toBe(0);
    expect(tiles[0].rect.height).toBe(0);
  });

  it('should merge duplicate instance IDs using bounding box', () => {
    const tree = parseTilingTree(['V', 'same', 'same'])!;
    const tiles = computeTilingLayout(tree, CONTAINER, 0);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].instanceId).toBe('same');
    expect(tiles[0].rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('should handle non-zero container origin', () => {
    const tree = parseTilingTree(['instance-1'])!;
    const offset: Rect = { x: 10, y: 20, width: 100, height: 100 };
    const tiles = computeTilingLayout(tree, offset, 0);

    expect(tiles).toEqual([
      {
        instanceId: 'instance-1',
        rect: { x: 10, y: 20, width: 100, height: 100 },
      },
    ]);
  });
});

describe('getVisibleInstanceIds', () => {
  it('should return empty set for empty array', () => {
    expect(getVisibleInstanceIds([])).toEqual(new Set());
  });

  it('should extract instance IDs', () => {
    const ids = getVisibleInstanceIds(['a', 'b', 'c']);

    expect(ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('should skip directions and null', () => {
    const ids = getVisibleInstanceIds(['V', 'a', 'H', null, 'b']);

    expect(ids).toEqual(new Set(['a', 'b']));
  });

  it('should deduplicate instance IDs', () => {
    const ids = getVisibleInstanceIds(['V', 'a', 'a']);

    expect(ids).toEqual(new Set(['a']));
    expect(ids.size).toBe(1);
  });
});
