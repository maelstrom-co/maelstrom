import {
  assertValidSplitWeights,
  type InstanceId,
  isTilingSplit,
  parseTilingSplitToken,
  type TilingNode,
  type TilingSplit,
  tilingLeafInstanceId,
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

declare const validWeights: unique symbol;

/**
 * Split node dividing the current rectangle along its axis, each child taking
 * a share proportional to its weight.
 *
 * {@link createTilingSplitNode} and {@link parseTilingTree} are the only ways
 * to reach this type without an assertion, so a split that reaches layout has
 * had its weights checked.
 */
export interface TilingSplitNode {
  /**
   * Type-level marker for weights that passed validation. Declared and never
   * assigned, so no runtime object carries it.
   *
   * @internal
   */
  readonly [validWeights]: true;
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
  /**
   * Type-level marker for weights that passed validation. Declared and never
   * assigned, so no runtime object carries it.
   *
   * @internal
   */
  readonly [validWeights]: true;
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
  /**
   * Instance this tile renders. Each Instance leaf produces exactly one tile;
   * a repeated leaf is refused upstream rather than merged here, so two tiles
   * can carry the same identity only when the public API was bypassed.
   */
  readonly instanceId: InstanceId;
  /** Padded pixel-space bounds for the Instance. */
  readonly rect: Rect;
}

/**
 * Builds a validated split node.
 *
 * A weight that is zero, negative or fractional does not fail loudly during
 * layout: it hands a child a region of zero or negative extent, or a sum that
 * no longer divides the parent, so the malformed geometry surfaces far from
 * the code that invented the weight. Guarding the sum is not enough — weights
 * `[5, -1]` sum to 4 and still overlap.
 *
 * @throws {RangeError} If `children`'s weights violate the split invariant —
 * see {@link assertValidSplitWeights}.
 */
export function createTilingSplitNode(
  direction: TilingSplit,
  children: readonly [
    { weight: number; node?: TilingTreeNode },
    { weight: number; node?: TilingTreeNode },
    ...{ weight: number; node?: TilingTreeNode }[],
  ],
): TilingSplitNode {
  assertValidSplitWeights(children.map(({ weight }) => weight));

  const [first, second, ...rest] = children;
  const slots: [TilingSplitChild, TilingSplitChild, ...TilingSplitChild[]] = [
    toSplitChild(first),
    toSplitChild(second),
    ...rest.map(toSplitChild),
  ];

  const split: Omit<TilingSplitNode, typeof validWeights> = {
    type: 'split',
    direction,
    children: slots,
  };

  return split as TilingSplitNode;
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

    const tokenIndex = index;
    const node = nodes[tokenIndex];
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
          `[Maelstrom] Malformed tiling tree: split at token index ${tokenIndex} declares ${weights.length + discardedChildCount} children, ${discardedChildCount} past the limit of ${weights.length}; the subtrees the discarded slots would have taken are re-parented onto an ancestor split`,
        );
      } else if (repairReason === 'unreadable') {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split at token index ${tokenIndex} has an unreadable weight suffix, read as ${weights.length} children weighted ${weights.join(',')}`,
        );
      } else if (repairReason === 'padded') {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split at token index ${tokenIndex} declares fewer than the two weights a split needs, read as ${weights.length} children weighted ${weights.join(',')}`,
        );
      }

      let missing = 0;

      const toChild = (weight: number) => {
        const child = parseNode();
        if (child === null) missing++;
        return { weight, node: child ?? undefined };
      };

      const [first, second, ...rest] = weights;
      const children = [
        toChild(first),
        toChild(second),
        ...rest.map(toChild),
      ] as const;

      if (missing > 0) {
        console.warn(
          `[Maelstrom] Malformed tiling tree: split at token index ${tokenIndex} declares ${weights.length} children but ${missing} are missing`,
        );
      }

      // Every weight came from parseTilingSplitToken, which clamps each field
      // to the split invariant, so the factory cannot throw here and this
      // function stays as tolerant of malformed input as its contract says.
      return createTilingSplitNode(axis, children);
    }

    const instanceId = tilingLeafInstanceId(node);

    if (instanceId === null && node !== null) {
      console.warn(
        `[Maelstrom] Malformed tiling tree: token at index ${tokenIndex} is neither a split nor an "ID:" leaf; rendered as empty space`,
      );
    }

    return {
      type: 'leaf',
      instanceId,
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
 *
 * One tile per Instance leaf, with no post-pass. A tree naming the same
 * Instance twice is refused by the seed validator and by the command
 * processor, and heal blanks the repeat before it reaches the store, so a
 * duplicate arriving here means the public API was bypassed. Merging the
 * repeats into a bounding box used to hide that: correct only when the rects
 * happen to form a rectangle, and silently painting over a sibling when they
 * do not. Emitting both tiles surfaces it as a duplicate React key instead.
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

  return tiles;
}

function toSplitChild(child: {
  weight: number;
  node?: TilingTreeNode;
}): TilingSplitChild {
  return { weight: child.weight, node: child.node } as TilingSplitChild;
}
