import {
  type ChartRequest,
  formatTilingSplitToken,
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
  const byId = new Map(
    visible.map((instance) => [instance.instanceId, instance]),
  );
  const remaining = [
    {
      width: request.context.chartDimensions.columns,
      height: request.context.chartDimensions.rows,
    },
  ];
  const seen = new Set<string>();
  for (const token of tree) {
    const space = remaining.pop();
    if (!space) return false;
    const branch = parseTilingSplitToken(token);
    if (branch) {
      if (branch.repaired) return false;
      const total = branch.weights.reduce((sum, weight) => sum + weight, 0);
      for (let index = branch.weights.length - 1; index >= 0; index--) {
        const fraction = branch.weights[index] / total;
        remaining.push({
          width: space.width * (branch.axis === 'V' ? fraction : 1),
          height: space.height * (branch.axis === 'H' ? fraction : 1),
        });
      }
    } else if (token !== null) {
      const id = tilingLeafInstanceId(token);
      const instance = id === null ? undefined : byId.get(id);
      if (!instance || seen.has(instance.instanceId)) return false;
      const minimum = request.vessels.find((v) => v.id === instance.vesselId)
        ?.variants[instance.variant]?.minSize;
      if (
        !minimum ||
        space.width + 1e-9 < minimum.width ||
        space.height + 1e-9 < minimum.height
      )
        return false;
      seen.add(instance.instanceId);
    }
  }
  return remaining.length === 0 && seen.size === visible.length;
}
