import {
  type InstanceId,
  isTilingSplit,
  parseTilingSplitToken,
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

/** Parsed node in a tiling tree of weighted n-ary splits. */
export type TilingTreeNode = TilingSplitNode | TilingLeafNode;

/**
 * Split node dividing the current rectangle along its axis, each child taking
 * a share proportional to its weight.
 */
export interface TilingSplitNode {
  /** Selects recursive weighted traversal of the child slots. */
  readonly type: 'split';
  /** `H` divides top/bottom; `V` divides left/right. */
  readonly direction: TilingSplit;
  /**
   * One entry per child slot the token declared, so `children.length` is the
   * split's arity. A bare `H` / `V` token yields two slots weighted `1` each,
   * and a split of fewer than two slots is unconstructable.
   */
  readonly children: readonly [
    TilingSplitChild,
    TilingSplitChild,
    ...TilingSplitChild[],
  ];
}

/**
 * One child slot of a split, carrying the weight its region is sized by.
 *
 * The weight travels with the slot rather than in a parallel array, so a split
 * whose weights and children disagree is unconstructable — the mismatch that
 * would otherwise hand the last child the wrong fraction of its parent.
 */
export interface TilingSplitChild {
  /** Share of the parent region, relative to its siblings' weights. */
  readonly weight: number;
  /**
   * The subtree filling this slot, or `undefined` where the token array ran
   * out before the slot could be filled. The region is left empty either way.
   */
  readonly node: TilingTreeNode | undefined;
}

/** Leaf node that either names an Instance or reserves empty space. */
export interface TilingLeafNode {
  /** Terminates traversal and allocates the current region. */
  readonly type: 'leaf';
  /** Instance occupying the region, or `null` for an empty region. */
  readonly instanceId: InstanceId | null;
}

/** Renderable tile computed for one Instance. */
export interface ComputedTile {
  /** Repeated leaves with this identity coalesce into one bounding tile. */
  readonly instanceId: InstanceId;
  /** Padded pixel-space bounds for the Instance. */
  readonly rect: Rect;
}

/**
 * Builds a tree from the flat preorder token array.
 *
 * Each split token consumes exactly as many following subtrees as its weights
 * declare — two for a bare `H` / `V`. Malformed input is reported on the
 * console and rendered as far as it goes: an unfilled child slot stays
 * `undefined`, and tokens trailing the first complete root are ignored.
 * Returns `null` for empty input.
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
      const { axis, weights, repairReason, discardedChildCount } =
        parseTilingSplitToken(node);

      // A seed layout never passes through the engine's heal, so this is the
      // only signal an author gets that the token they wrote is not the token
      // being rendered. Each repair is reported apart from the others:
      // truncation reshapes the tree rather than substituting a value, and a
      // short suffix is perfectly legible.
      if (repairReason === 'truncated') {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split node '${node}' declares ${weights.length + discardedChildCount} children, ${discardedChildCount} past the limit of ${weights.length}; the subtrees the discarded slots would have taken are re-parented onto an ancestor split`,
        );
      } else if (repairReason === 'unreadable') {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split node '${node}' has an unreadable weight suffix, read as ${weights.length} children weighted ${weights.join(',')}`,
        );
      } else if (repairReason === 'padded') {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split node '${node}' declares fewer than the two weights a split needs, read as ${weights.length} children weighted ${weights.join(',')}`,
        );
      }

      let missing = 0;

      const toChild = (weight: number): TilingSplitChild => {
        const child = parseNode();
        if (child === null) missing++;
        return { weight, node: child ?? undefined };
      };

      const [first, second, ...rest] = weights;
      const children: [
        TilingSplitChild,
        TilingSplitChild,
        ...TilingSplitChild[],
      ] = [toChild(first), toChild(second), ...rest.map(toChild)];

      if (missing > 0) {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split node '${node}' declares ${weights.length} children but ${missing} are missing`,
        );
      }

      return { type: 'split', direction: axis, children };
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
 * Assigns every leaf a rectangle inside `containerRect`.
 *
 * A split divides its region along its axis in proportion to its weights, so
 * the children tile it exactly: the cut positions are computed as cumulative
 * edges and the last edge is the region's own far side, leaving no gap or
 * overlap for any weighting. `padding` is then inset per leaf, never per
 * split, so it never accumulates with depth. Empty trees and empty leaves
 * produce no tile, and padding never yields negative size.
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

    const alongHeight = node.direction === 'H';
    const start = alongHeight ? rect.y : rect.x;
    const extent = alongHeight ? rect.height : rect.width;
    const total = node.children.reduce((sum, { weight }) => sum + weight, 0);
    const lastIndex = node.children.length - 1;

    // Cumulative edges rather than accumulated widths: each child spans
    // [edge_i, edge_i+1), and the final edge is the region's own far side, so
    // the children tile the region exactly with no float gap or overlap.
    let edge = start;
    let cumulative = 0;

    node.children.forEach(({ weight, node: child }, index) => {
      cumulative += weight;
      const nextEdge =
        index === lastIndex
          ? start + extent
          : start + (extent * cumulative) / total;

      if (child) {
        traverse(
          child,
          alongHeight
            ? { x: rect.x, y: edge, width: rect.width, height: nextEdge - edge }
            : {
                x: edge,
                y: rect.y,
                width: nextEdge - edge,
                height: rect.height,
              },
        );
      }

      edge = nextEdge;
    });
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
