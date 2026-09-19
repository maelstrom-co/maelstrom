import {
  type ChartRequest,
  formatTilingSplitToken,
  MAX_SPLIT_CHILDREN,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

export interface LayoutChoice {
  readonly id: string;
  readonly description: string;
  readonly tree: readonly TilingNode[];
}

function split(
  axis: 'H' | 'V',
  children: readonly (readonly TilingNode[])[],
  weights = children.map(() => 1),
): readonly TilingNode[] {
  if (children.length === 0) return [];
  if (children.length === 1) return children[0];
  if (children.length > MAX_SPLIT_CHILDREN) return [];
  return [
    formatTilingSplitToken(axis, weights as [number, number, ...number[]]),
    ...children.flat(),
  ];
}

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

export function layoutChoices(
  request: ChartRequest,
  visible: readonly VesselInstanceSnapshot[],
): readonly LayoutChoice[] {
  const candidates: LayoutChoice[] = [];
  const add = (
    id: string,
    description: string,
    tree: readonly TilingNode[],
  ) => {
    if (layoutFits(request, tree, visible))
      candidates.push({ id, description, tree });
  };
  if (request.layout.type === 'tiling')
    add(
      'preserve',
      'Preserve the exact current tree, order, relative sizes, and empty space.',
      request.layout.tree,
    );
  if (visible.length === 0) {
    if (!candidates.length)
      add('empty', 'No visible instances. Keep hidden retained state.', []);
    return candidates;
  }
  const order =
    request.layout.type === 'tiling'
      ? request.layout.tree
          .map(tilingLeafInstanceId)
          .filter((id) => id !== null)
      : [];
  const sorted = [...visible].sort((a, b) => {
    const rank = (id: typeof a.instanceId) => {
      const index = order.indexOf(id);
      return index < 0 ? order.length : index;
    };
    return rank(a.instanceId) - rank(b.instanceId);
  });
  const leaves = sorted.map((instance) => [
    tilingLeafToken(instance.instanceId),
  ]);
  if (leaves.length === 1) {
    if (
      !candidates.some(
        (candidate) =>
          candidate.tree.length === 1 && candidate.tree[0] === leaves[0][0],
      )
    )
      add('single', 'One instance fills the Chart.', leaves[0]);
    return candidates;
  }
  add('row', `One row of ${leaves.length} equal columns.`, split('V', leaves));
  add(
    'column',
    `One column of ${leaves.length} equal rows.`,
    split('H', leaves),
  );
  for (
    let count = 2;
    count <= Math.min(MAX_SPLIT_CHILDREN, leaves.length);
    count++
  ) {
    let offset = 0;
    const rows = Array.from({ length: count }, (_, index) => {
      const size =
        Math.floor(leaves.length / count) +
        (index < leaves.length % count ? 1 : 0);
      const row = split('V', leaves.slice(offset, offset + size));
      offset += size;
      return row;
    });
    if (rows.every((row) => row.length > 0))
      add(
        `rows_${count}`,
        `${count} equal-height rows containing ${Array.from({ length: count }, (_, i) => Math.floor(leaves.length / count) + (i < leaves.length % count ? 1 : 0)).join(' + ')} instances.`,
        split('H', rows),
      );
  }
  for (const [index, instance] of sorted.entries()) {
    const others = leaves.filter((_, other) => other !== index);
    for (const axis of ['H', 'V'] as const) {
      const rest = split(axis === 'V' ? 'H' : 'V', others);
      if (rest.length)
        add(
          `focus/${axis}/${instance.instanceId}`,
          `Give ${instance.instanceId} two thirds of the Chart ${axis === 'V' ? 'on the left' : 'at the top'}, with the other instances in the remaining third.`,
          split(axis, [leaves[index], rest], [2, 1]),
        );
    }
  }
  return candidates;
}
