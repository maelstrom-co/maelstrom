import type { TilingNode, TilingSplitDirection } from '@maelstrom-co/protocol-old';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TilingTreeNode {
  type: 'split' | 'leaf';
  direction?: TilingSplitDirection | undefined;
  left?: TilingTreeNode | undefined;
  right?: TilingTreeNode | undefined;
  instanceId?: string | null | undefined;
}

export interface ComputedTile {
  instanceId: string;
  rect: Rect;
}

export function parseTilingTree(nodes: TilingNode[]): TilingTreeNode | null {
  if (nodes.length === 0) {
    return null;
  }

  let index = 0;

  function parseNode(): TilingTreeNode | null {
    if (index >= nodes.length) {
      return null;
    }

    const node = nodes[index];
    index++;

    if (node === 'H' || node === 'V') {
      const left = parseNode();
      const right = parseNode();
      return {
        type: 'split',
        direction: node,
        left: left ?? undefined,
        right: right ?? undefined,
      };
    }

    return {
      type: 'leaf',
      instanceId: node,
    };
  }

  return parseNode();
}

export function computeTilingLayout(
  tree: TilingTreeNode | null,
  containerRect: Rect,
  padding: number,
): ComputedTile[] {
  if (!tree) {
    return [];
  }

  const tiles: ComputedTile[] = [];

  function traverse(node: TilingTreeNode, rect: Rect): void {
    if (node.type === 'leaf') {
      if (node.instanceId !== null && node.instanceId !== undefined) {
        tiles.push({
          instanceId: node.instanceId,
          rect: {
            x: rect.x + padding / 2,
            y: rect.y + padding / 2,
            width: Math.max(0, rect.width - padding),
            height: Math.max(0, rect.height - padding),
          },
        });
      }
      return;
    }

    if (node.direction === 'H') {
      const topHeight = rect.height / 2;
      const bottomHeight = rect.height - topHeight;

      if (node.left) {
        traverse(node.left, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: topHeight,
        });
      }
      if (node.right) {
        traverse(node.right, {
          x: rect.x,
          y: rect.y + topHeight,
          width: rect.width,
          height: bottomHeight,
        });
      }
    } else {
      const leftWidth = rect.width / 2;
      const rightWidth = rect.width - leftWidth;

      if (node.left) {
        traverse(node.left, {
          x: rect.x,
          y: rect.y,
          width: leftWidth,
          height: rect.height,
        });
      }
      if (node.right) {
        traverse(node.right, {
          x: rect.x + leftWidth,
          y: rect.y,
          width: rightWidth,
          height: rect.height,
        });
      }
    }
  }

  traverse(tree, containerRect);

  return mergeDuplicateTiles(tiles);
}

function mergeDuplicateTiles(tiles: ComputedTile[]): ComputedTile[] {
  const instanceMap = new Map<string, ComputedTile[]>();

  for (const tile of tiles) {
    const existing = instanceMap.get(tile.instanceId);
    if (existing) {
      existing.push(tile);
    } else {
      instanceMap.set(tile.instanceId, [tile]);
    }
  }

  const merged: ComputedTile[] = [];

  for (const [instanceId, instanceTiles] of instanceMap) {
    if (instanceTiles.length === 1) {
      merged.push(instanceTiles[0]);
    } else {
      const boundingBox = computeBoundingBox(instanceTiles.map((t) => t.rect));
      merged.push({
        instanceId,
        rect: boundingBox,
      });
    }
  }

  return merged;
}

function computeBoundingBox(rects: Rect[]): Rect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function getVisibleInstanceIds(nodes: TilingNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node !== null && node !== 'H' && node !== 'V') {
      ids.add(node);
    }
  }
  return ids;
}
