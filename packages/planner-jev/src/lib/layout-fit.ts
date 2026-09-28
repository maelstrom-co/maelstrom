import {
  type ChartRequest,
  formatTilingSplitToken,
  type InstanceId,
  MAX_SPLIT_CHILDREN,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

/**
 * Joins subtrees under one split token. One child is returned as is; more
 * children than a split can hold give an empty tree, which never fits.
 */
export function splitTree(
  axis: 'H' | 'V',
  children: readonly (readonly TilingNode[])[],
  weights: readonly number[] = children.map(() => 1),
): readonly TilingNode[] {
  if (children.length === 0) return [];
  if (children.length === 1) return children[0];
  if (children.length > MAX_SPLIT_CHILDREN) return [];
  return [
    formatTilingSplitToken(axis, weights as [number, number, ...number[]]),
    ...children.flat(),
  ];
}

/** A leaf's region on the Chart, in grid units from the top-left corner. */
export interface LeafRect {
  readonly instanceId: InstanceId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Whether `tree` places exactly the `visible` instances, each once, in a
 * region at least its variant's `minSize` on the request's Chart.
 */
export function layoutFits(
  request: ChartRequest,
  tree: readonly TilingNode[],
  visible: readonly VesselInstanceSnapshot[],
): boolean {
  if (tree.length === 0) return visible.length === 0;
  const rects = treeRects(request, tree);
  if (rects === undefined) return false;
  const byId = new Map(
    visible.map((instance) => [instance.instanceId, instance]),
  );
  const seen = new Set<string>();
  for (const rect of rects) {
    const instance = byId.get(rect.instanceId);
    if (!instance || seen.has(instance.instanceId)) return false;
    const minimum = request.vessels.find((v) => v.id === instance.vesselId)
      ?.variants[instance.variant]?.minSize;
    if (
      !minimum ||
      rect.width + 1e-9 < minimum.width ||
      rect.height + 1e-9 < minimum.height
    )
      return false;
    seen.add(instance.instanceId);
  }
  return seen.size === visible.length;
}

/**
 * The region of every leaf of `tree` on the request's Chart, in tree order.
 * `V` splits divide the width left to right, `H` splits the height top to
 * bottom; null leaves take their share without a rect. `undefined` when the
 * tree is malformed: a repaired split token, a token that is neither a split
 * nor a leaf, too few children for a split, or tokens after the root closes.
 */
export function treeRects(
  request: ChartRequest,
  tree: readonly TilingNode[],
): readonly LeafRect[] | undefined {
  const remaining: Omit<LeafRect, 'instanceId'>[] = [
    {
      x: 0,
      y: 0,
      width: request.context.chartDimensions.columns,
      height: request.context.chartDimensions.rows,
    },
  ];
  const rects: LeafRect[] = [];
  for (const token of tree) {
    const space = remaining.pop();
    if (!space) return undefined;
    const branch = parseTilingSplitToken(token);
    if (branch) {
      if (branch.repaired) return undefined;
      const total = branch.weights.reduce((sum, weight) => sum + weight, 0);
      const children: Omit<LeafRect, 'instanceId'>[] = [];
      let offset = 0;
      for (const weight of branch.weights) {
        const fraction = weight / total;
        children.push(
          branch.axis === 'V'
            ? {
                x: space.x + space.width * offset,
                y: space.y,
                width: space.width * fraction,
                height: space.height,
              }
            : {
                x: space.x,
                y: space.y + space.height * offset,
                width: space.width,
                height: space.height * fraction,
              },
        );
        offset += fraction;
      }
      remaining.push(...children.reverse());
    } else if (token !== null) {
      const instanceId = tilingLeafInstanceId(token);
      if (instanceId === null) return undefined;
      rects.push({ instanceId, ...space });
    }
  }
  return remaining.length === 0 ? rects : undefined;
}
