import {
  type InstanceId,
  isTilingSplit,
  type TilingNode,
  type TilingSplit,
} from '@maelstrom-co/protocol';

/** Pixel-space rectangle used while projecting a tiling tree. */
export interface Rect {
  /** Horizontal coordinate of the rectangle's top-left corner. */
  readonly x: number;
  /** Vertical coordinate of the rectangle's top-left corner. */
  readonly y: number;
  /** Rectangle width in pixels. */
  readonly width: number;
  /** Rectangle height in pixels. */
  readonly height: number;
}

/** Parsed node in a binary tiling tree. */
export type TilingTreeNode = TilingSplitNode | TilingLeafNode;

/** Split node whose children divide the current rectangle into equal regions. */
export interface TilingSplitNode {
  /** Node discriminator. */
  readonly type: 'split';
  /** `H` divides top/bottom; `V` divides left/right. */
  readonly direction: TilingSplit;
  /** First child, absent when the preorder input is incomplete. */
  readonly left?: TilingTreeNode | undefined;
  /** Second child, absent when the preorder input is incomplete. */
  readonly right?: TilingTreeNode | undefined;
}

/** Leaf node that either names an Instance or reserves empty space. */
export interface TilingLeafNode {
  /** Node discriminator. */
  readonly type: 'leaf';
  /** Instance occupying the region, or `null` for an empty region. */
  readonly instanceId: InstanceId | null;
}

/** Renderable tile computed for one Instance. */
export interface ComputedTile {
  /** Instance rendered in the tile. */
  readonly instanceId: InstanceId;
  /** Padded pixel-space bounds for the Instance. */
  readonly rect: Rect;
}

/**
 * Parses the first preorder root from a flat tiling tree.
 *
 * Returns `null` for empty input. Malformed input is retained as a partial tree:
 * missing children are omitted and trailing tokens are ignored, with a warning.
 */
export function parseTilingTree(
  nodes: readonly TilingNode[],
): TilingTreeNode | null {
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

    if (isTilingSplit(node)) {
      const left = parseNode();
      const right = parseNode();
      if (!left || !right) {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split node '${node}' has missing ${!left && !right ? 'left and right' : !left ? 'left' : 'right'} child`,
        );
      }
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

  const result = parseNode();

  if (index < nodes.length) {
    console.warn(
      `[Maelstrom] Malformed tiling tree: ${nodes.length - index} unconsumed token(s) after parsing`,
    );
  }

  return result;
}

/**
 * Projects a parsed tiling tree into padded pixel-space tiles.
 *
 * Empty trees and empty leaves produce no tile. Repeated Instance leaves are
 * merged into their bounding rectangle, and padding never yields negative size.
 */
export function computeTilingLayout(
  tree: TilingTreeNode | null,
  containerRect: Rect,
  padding: number,
): readonly ComputedTile[] {
  if (!tree) {
    return [];
  }

  const tiles: ComputedTile[] = [];

  function traverse(node: TilingTreeNode, rect: Rect): void {
    if (node.type === 'leaf') {
      if (node.instanceId !== null) {
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
  const instanceMap = new Map<InstanceId, ComputedTile[]>();

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
      const tile = instanceTiles[0];
      if (!tile)
        throw new Error(
          'instanceTiles must contain an element when length is 1',
        );
      merged.push(tile);
    } else {
      const boundingBox = computeBoundingBox(instanceTiles.map((t) => t.rect));
      merged.push({ instanceId, rect: boundingBox });
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

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
