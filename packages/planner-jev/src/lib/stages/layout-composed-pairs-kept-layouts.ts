import {
  InstanceId,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';

import { splitTree } from '../layout-fit.js';
import { partFractionShares } from './layout-composed-pairs-sizes.js';
import {
  type Arrangement,
  arrangementRelation,
  enumerateArrangements,
  integerWeights,
  MAX_TOP_PARTS,
  type MinimumFraction,
  type OptionProbabilities,
  type PairAnswer,
  relationScores,
  scoreRelations,
  treeRelation,
  weightsAtMinimum,
} from './layout-composed-pairs-tree.js';

/** A leaf of a {@link LayoutShape}: one Instance. */
export interface ShapeLeaf {
  readonly kind: 'leaf';
  readonly id: InstanceId;
}

/** A split of a {@link LayoutShape}: children side by side (`V`) or stacked (`H`). */
export interface ShapeSplit {
  readonly kind: 'split';
  readonly axis: 'H' | 'V';
  /** One positive weight per child, in child order; not necessarily integers. */
  readonly weights: readonly number[];
  readonly children: readonly LayoutShape[];
  /** Whether the split comes from the current tree, so it keeps its current weights when sized. */
  readonly copied: boolean;
}

/** A tiling tree of any depth, before it is written as tokens. */
export type LayoutShape = ShapeLeaf | ShapeSplit;

/** Where a kept layout comes from: the current tree itself, or the current tree with one widget moved. */
export type KeptLayoutKind = 'current_layout' | 'one_widget_moved';

/** A candidate tree kept from the current layout, which the two-level enumeration cannot build. */
export interface KeptLayoutCandidate {
  readonly kind: KeptLayoutKind;
  readonly shape: ShapeSplit;
}

/**
 * The current tree reduced to the `visible` Instances, every split marked
 * as copied: leaves not visible are removed and the other children keep
 * their weights, a split left with one child becomes that child, and a
 * split along the same axis as its parent is flattened into it, its
 * children's weights scaled by its share of the parent. `undefined` when
 * no visible Instance is in the tree.
 */
export function shapeOfTree(
  tree: readonly TilingNode[],
  visible: readonly InstanceId[],
): LayoutShape | undefined {
  return pruned(parsedShape(tree), new Set(visible));
}

/**
 * The weight-free key of a shape, such as `H(V(a,b),c)`: two shapes with
 * the same key place their Instances the same way.
 */
export function shapeKey(shape: LayoutShape): string {
  if (shape.kind === 'leaf') return shape.id;
  return `${shape.axis}(${shape.children.map(shapeKey).join(',')})`;
}

/**
 * The trees kept from `currentTree` for the visible `ids`, in order: the
 * current tree itself (see {@link shapeOfTree}) when it holds every
 * visible Instance, then, for each visible Instance in turn, the current
 * tree without it with the Instance put back beside each node (in
 * pre-order, the whole tree first), along each axis (`H`, then `V`),
 * before and after. An Instance the current tree does not hold is placed
 * the same way. Beside a node whose parent splits along that axis, the
 * Instance joins the parent with the parent's total weight divided by the
 * number of leaves under it; otherwise, and always beside the whole tree,
 * the node and the Instance form a new split. A shape that
 * {@link enumerateArrangements} also lists, or that an earlier candidate
 * already has, is left out.
 */
export function keptLayoutCandidates(
  currentTree: readonly TilingNode[],
  ids: readonly InstanceId[],
): readonly KeptLayoutCandidate[] {
  const visible = new Set(ids);
  const current = pruned(parsedShape(currentTree), visible);
  if (current === undefined) return [];
  const built: { kind: KeptLayoutKind; shape: LayoutShape }[] = [];
  if (ids.every((id) => leafIds(current).includes(id)))
    built.push({ kind: 'current_layout', shape: current });
  for (const moving of ids) {
    const rest = pruned(current, new Set(ids.filter((id) => id !== moving)));
    if (rest === undefined || leafIds(rest).length !== ids.length - 1) continue;
    for (const path of nodePaths(rest))
      for (const axis of ['H', 'V'] as const)
        for (const before of [true, false])
          built.push({
            kind: 'one_widget_moved',
            shape: normalized(placed(rest, path, moving, axis, before)),
          });
  }
  const seen = new Set<string>();
  return built.flatMap(({ kind, shape }) => {
    if (shape.kind === 'leaf' || isTwoLevel(shape)) return [];
    const key = shapeKey(shape);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ kind, shape }];
  });
}

/** How {@link keptLayoutTree} and {@link keptLayoutTreeAtMinimum} size a kept layout. */
export interface KeptLayoutSizing {
  /** Each Instance's share of the whole Chart. */
  readonly shareById: Readonly<Record<string, number>>;
  /** The fraction of its row or column the request states for an Instance, `undefined` when it states none. */
  readonly statedFractionOf: (id: InstanceId) => number | undefined;
}

/**
 * The tiling tree of `shape` weighted by the answered sizes. A copied
 * split keeps its current weights, except that a leaf child with a stated
 * fraction gets it inside that split and the others split the rest in
 * proportion to their current weights (see `partFractionShares`). A new
 * split of leaves only, below the top, splits like an enumerated part: by
 * stated fractions and whole-Chart shares. Any other new split weights
 * each child by the summed whole-Chart shares of the leaves under it.
 * Every split is written with the smallest integer weights in that ratio.
 */
export function keptLayoutTree(
  shape: LayoutShape,
  sizing: KeptLayoutSizing,
): readonly TilingNode[] {
  const write = (node: LayoutShape, top: boolean): readonly TilingNode[] => {
    if (node.kind === 'leaf') return [tilingLeafToken(node.id)];
    return splitTree(
      node.axis,
      node.children.map((child) => write(child, false)),
      integerWeights(desiredShares(node, sizing, top)),
    );
  };
  return write(shape, true);
}

/**
 * {@link keptLayoutTree} with every share below its minimum raised to it
 * along each split, at any depth, and the other shares scaled down (see
 * `raiseToMinimum` and `weightsAtMinimum`). Along a split, a child's
 * minimum is the sum of its children's minimums when they run along the
 * same axis, else the largest one, as a fraction of the extent the split
 * has; each child is then raised within the extent its new weight gives
 * it. `undefined` when the minimums along one split cannot fit.
 */
export function keptLayoutTreeAtMinimum(
  shape: LayoutShape,
  sizing: KeptLayoutSizing,
  minimumById: Readonly<Record<string, MinimumFraction>>,
): readonly TilingNode[] | undefined {
  const write = (
    node: LayoutShape,
    extent: MinimumFraction,
    top: boolean,
  ): readonly TilingNode[] | undefined => {
    if (node.kind === 'leaf') return [tilingLeafToken(node.id)];
    const along = node.axis === 'V' ? extent.width : extent.height;
    const weights = weightsAtMinimum(
      desiredShares(node, sizing, top),
      node.children.map(
        (child) => minimumAlong(child, node.axis, minimumById) / along,
      ),
    );
    if (weights === undefined) return undefined;
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const children: (readonly TilingNode[])[] = [];
    for (const [index, child] of node.children.entries()) {
      const share = (weights[index] ?? 0) / total;
      const written = write(
        child,
        node.axis === 'V'
          ? { width: extent.width * share, height: extent.height }
          : { width: extent.width, height: extent.height * share },
        false,
      );
      if (written === undefined) return undefined;
      children.push(written);
    }
    return splitTree(node.axis, children, weights);
  };
  return write(shape, { width: 1, height: 1 }, true);
}

/** The tiling tree of `shape` with every split's children weighted equally. */
export function equalKeptLayoutTree(shape: LayoutShape): readonly TilingNode[] {
  if (shape.kind === 'leaf') return [tilingLeafToken(shape.id)];
  return splitTree(shape.axis, shape.children.map(equalKeptLayoutTree));
}

/** A candidate tree of the layout stage: an enumerated two-level arrangement, or a layout kept from the current tree. */
export type LayoutCandidate =
  | { readonly kind: 'two_level'; readonly arrangement: Arrangement }
  | { readonly kind: KeptLayoutKind; readonly shape: ShapeSplit };

/** A {@link LayoutCandidate} with its score, highest first when ranked. */
export interface ScoredLayoutCandidate {
  readonly candidate: LayoutCandidate;
  /** Sum over the pairs and the top-level direction of the log probability the tree implies. */
  readonly score: number;
}

/**
 * Scores every enumerated two-level arrangement of `ids` (see
 * `rankArrangements`) and every layout kept from `currentTree` (see
 * {@link keptLayoutCandidates}) from the same `relationScores`, a kept
 * layout reading each pair's relation at the split where the two leaves
 * part, at any depth. Not stated votes for the current tree, or for the
 * current order along a direction that changes the top split and is meant
 * for the whole board: no Instance is new to the tree and no pair states a
 * relation across the direction. Highest first; ties keep the enumeration
 * order, with the kept layouts after every arrangement.
 */
export function rankLayoutCandidates(
  ids: readonly InstanceId[],
  pairs: readonly PairAnswer[],
  currentTree: readonly TilingNode[],
  direction: OptionProbabilities,
): readonly ScoredLayoutCandidate[] {
  const scores = relationScores(ids, pairs, currentTree, direction);
  const arrangements = enumerateArrangements(ids).map(
    (arrangement): ScoredLayoutCandidate => ({
      candidate: { kind: 'two_level', arrangement },
      score: scoreRelations(scores, arrangement.axis, (first, second) =>
        arrangementRelation(arrangement, first, second),
      ),
    }),
  );
  const kept = keptLayoutCandidates(currentTree, ids).map(
    ({ kind, shape }): ScoredLayoutCandidate => {
      const tree = equalKeptLayoutTree(shape);
      return {
        candidate: { kind, shape },
        score: scoreRelations(scores, shape.axis, (first, second) =>
          treeRelation(tree, first, second),
        ),
      };
    },
  );
  return [...arrangements, ...kept]
    .map((scored, order) => ({ scored, order }))
    .sort((a, b) => b.scored.score - a.scored.score || a.order - b.order)
    .map(({ scored }) => scored);
}

type NodePath = readonly number[];

/** A tree as read from tokens: a token that is no split and no Instance leaf reads as a leaf without an id, which pruning drops. */
type ParsedNode =
  | { readonly kind: 'leaf'; readonly id: InstanceId | undefined }
  | {
      readonly kind: 'split';
      readonly axis: 'H' | 'V';
      readonly weights: readonly number[];
      readonly children: readonly ParsedNode[];
      readonly copied: boolean;
    };

function parsedShape(tree: readonly TilingNode[]): ParsedNode {
  let cursor = 0;
  const walk = (): ParsedNode => {
    const token = tree[cursor] ?? null;
    cursor += 1;
    const split = parseTilingSplitToken(token);
    if (split === null) {
      const id = tilingLeafInstanceId(token);
      return { kind: 'leaf', id: id === null ? undefined : InstanceId(id) };
    }
    return {
      kind: 'split',
      axis: split.axis,
      weights: [...split.weights],
      children: split.weights.map(() => walk()),
      copied: true,
    };
  };
  return walk();
}

function pruned(
  node: ParsedNode,
  keep: ReadonlySet<string>,
): LayoutShape | undefined {
  if (node.kind === 'leaf')
    return node.id !== undefined && keep.has(node.id)
      ? { kind: 'leaf', id: node.id }
      : undefined;
  const children: LayoutShape[] = [];
  const weights: number[] = [];
  for (const [index, child] of node.children.entries()) {
    const kept = pruned(child, keep);
    if (kept === undefined) continue;
    children.push(kept);
    weights.push(node.weights[index] ?? 1);
  }
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return normalized({ ...node, weights, children });
}

function normalized(node: LayoutShape): LayoutShape {
  if (node.kind === 'leaf') return node;
  const children: LayoutShape[] = [];
  const weights: number[] = [];
  for (const [index, original] of node.children.entries()) {
    const child = normalized(original);
    const weight = node.weights[index] ?? 1;
    if (child.kind === 'split' && child.axis === node.axis) {
      const total = child.weights.reduce((sum, part) => sum + part, 0);
      for (const [inner, grandchild] of child.children.entries()) {
        children.push(grandchild);
        weights.push((weight * (child.weights[inner] ?? 1)) / total);
      }
    } else {
      children.push(child);
      weights.push(weight);
    }
  }
  return { ...node, weights, children };
}

function leafIds(node: LayoutShape): readonly InstanceId[] {
  return node.kind === 'leaf' ? [node.id] : node.children.flatMap(leafIds);
}

function nodePaths(node: LayoutShape, path: NodePath = []): NodePath[] {
  if (node.kind === 'leaf') return [path];
  return [
    path,
    ...node.children.flatMap((child, index) =>
      nodePaths(child, [...path, index]),
    ),
  ];
}

function placed(
  root: LayoutShape,
  path: NodePath,
  moving: InstanceId,
  axis: 'H' | 'V',
  before: boolean,
): LayoutShape {
  const leaf: ShapeLeaf = { kind: 'leaf', id: moving };
  const wrap = (node: LayoutShape): ShapeSplit => ({
    kind: 'split',
    axis,
    weights: [1, 1],
    children: before ? [leaf, node] : [node, leaf],
    copied: false,
  });
  const [first, ...rest] = path;
  if (first === undefined) return wrap(root);
  const visit = (
    parent: ShapeSplit,
    index: number,
    below: NodePath,
  ): ShapeSplit => {
    const [next, ...deeper] = below;
    const child = parent.children[index];
    if (child === undefined) return parent;
    if (next !== undefined && child.kind === 'split')
      return replaceChild(parent, index, visit(child, next, deeper));
    if (parent.axis === axis) {
      const total = parent.weights.reduce((sum, weight) => sum + weight, 0);
      const at = before ? index : index + 1;
      return {
        ...parent,
        weights: [
          ...parent.weights.slice(0, at),
          total / leafIds(parent).length,
          ...parent.weights.slice(at),
        ],
        children: [
          ...parent.children.slice(0, at),
          leaf,
          ...parent.children.slice(at),
        ],
      };
    }
    return replaceChild(parent, index, wrap(child));
  };
  return root.kind === 'split' ? visit(root, first, rest) : root;
}

function replaceChild(
  parent: ShapeSplit,
  index: number,
  child: LayoutShape,
): ShapeSplit {
  return {
    ...parent,
    children: parent.children.map((original, at) =>
      at === index ? child : original,
    ),
  };
}

function isTwoLevel(shape: ShapeSplit): boolean {
  return (
    shape.children.length <= MAX_TOP_PARTS &&
    shape.children.every(
      (child) =>
        child.kind === 'leaf' ||
        (child.axis !== shape.axis &&
          child.children.every((member) => member.kind === 'leaf')),
    )
  );
}

function desiredShares(
  node: ShapeSplit,
  sizing: KeptLayoutSizing,
  top: boolean,
): readonly number[] {
  const statedOf = (child: LayoutShape) =>
    child.kind === 'leaf' ? sizing.statedFractionOf(child.id) : undefined;
  const shareOf = (child: LayoutShape) =>
    leafIds(child).reduce((sum, id) => sum + (sizing.shareById[id] ?? 0), 0);
  if (node.copied) {
    const total = node.weights.reduce((sum, weight) => sum + weight, 0);
    const current = node.weights.map((weight) => weight / total);
    const stated = node.children.map(statedOf);
    return stated.some((fraction) => fraction !== undefined)
      ? partFractionShares(stated, current)
      : current;
  }
  if (!top && node.children.every((child) => child.kind === 'leaf'))
    return partFractionShares(
      node.children.map(statedOf),
      node.children.map(shareOf),
    );
  return node.children.map(shareOf);
}

function minimumAlong(
  node: LayoutShape,
  axis: 'H' | 'V',
  minimumById: Readonly<Record<string, MinimumFraction>>,
): number {
  if (node.kind === 'leaf') {
    const minimum = minimumById[node.id];
    return (axis === 'V' ? minimum?.width : minimum?.height) ?? 0;
  }
  const minimums = node.children.map((child) =>
    minimumAlong(child, axis, minimumById),
  );
  return node.axis === axis
    ? minimums.reduce((sum, minimum) => sum + minimum, 0)
    : Math.max(0, ...minimums);
}
