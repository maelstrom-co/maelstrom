import type { TilingTreeNode } from '@maelstrom-co/client';
import { parseTilingTree } from '@maelstrom-co/client';
import { type InstanceId, tilingLeafInstanceId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHOP_LAYOUT } from './default-layout';

describe('SHOP_LAYOUT', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses into a complete tiling tree of the orders and cart tiles', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const leaves = assertCompleteAndCollectLeaves(
      parseTilingTree(SHOP_LAYOUT.tree),
    );

    expect(new Set(leaves)).toEqual(new Set(['orders-main', 'cart-main']));
    expect(warn).not.toHaveBeenCalled();
  });

  it('declares exactly the instances its tree references', () => {
    const declared = SHOP_LAYOUT.instances.map(
      (instance) => instance.instanceId as string,
    );
    const leaves: InstanceId[] = SHOP_LAYOUT.tree
      .map(tilingLeafInstanceId)
      .filter((instanceId) => instanceId !== null);

    expect(new Set(declared)).toEqual(new Set(leaves));
    expect(declared.length).toBe(new Set(declared).size);
  });

  it('starts orders on its list and cart on its items', () => {
    expect(
      SHOP_LAYOUT.instances.map(({ vesselId, variant }) => [vesselId, variant]),
    ).toEqual([
      ['orders', 'list'],
      ['cart', 'items'],
    ]);
  });
});

// A split that declares more child slots than it fills silently drops a tile
// at runtime, so every slot is asserted while the leaf ids are collected.
function assertCompleteAndCollectLeaves(node: TilingTreeNode | null): string[] {
  if (node === null) {
    throw new Error('expected a non-null tiling tree');
  }
  if (node.type === 'leaf') {
    expect(node.instanceId).not.toBeNull();
    return node.instanceId === null ? [] : [node.instanceId];
  }
  return node.children.flatMap(({ node: child }) => {
    expect(child).toBeDefined();
    return child ? assertCompleteAndCollectLeaves(child) : [];
  });
}
