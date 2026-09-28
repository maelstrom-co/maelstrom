import {
  type ChartRequest,
  MAX_SPLIT_CHILDREN,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { layoutFits, splitTree } from './layout-fit.js';
import { packingChoices } from './packing.js';

export interface LayoutChoice {
  readonly id: string;
  readonly description: string;
  readonly tree: readonly TilingNode[];
}

/**
 * Candidate trees for the visible instances, each already checked against
 * the Chart and every instance's `minSize`: `preserve` (the current tree),
 * `single`, `row`, `column`, balanced `rows_N`, `focus/<axis>/<id>` (one
 * instance gets two thirds) and size-aware `fit_rows` / `fit_columns`.
 */
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
  add(
    'row',
    `One row of ${leaves.length} equal columns.`,
    splitTree('V', leaves),
  );
  add(
    'column',
    `One column of ${leaves.length} equal rows.`,
    splitTree('H', leaves),
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
      const row = splitTree('V', leaves.slice(offset, offset + size));
      offset += size;
      return row;
    });
    if (rows.every((row) => row.length > 0))
      add(
        `rows_${count}`,
        `${count} equal-height rows containing ${Array.from({ length: count }, (_, i) => Math.floor(leaves.length / count) + (i < leaves.length % count ? 1 : 0)).join(' + ')} instances.`,
        splitTree('H', rows),
      );
  }
  for (const [index, instance] of sorted.entries()) {
    const others = leaves.filter((_, other) => other !== index);
    for (const axis of ['H', 'V'] as const) {
      const rest = splitTree(axis === 'V' ? 'H' : 'V', others);
      if (rest.length)
        add(
          `focus/${axis}/${instance.instanceId}`,
          `Give ${instance.instanceId} two thirds of the Chart ${axis === 'V' ? 'on the left' : 'at the top'}, with the other instances in the remaining third.`,
          splitTree(axis, [leaves[index], rest], [2, 1]),
        );
    }
  }
  for (const axis of ['H', 'V'] as const) {
    for (const packed of packingChoices(request, sorted, axis)) {
      if (!layoutFits(request, packed.tree, visible)) continue;
      if (
        !candidates.some(
          (candidate) =>
            candidate.tree.length === packed.tree.length &&
            candidate.tree.every((node, index) => node === packed.tree[index]),
        )
      ) {
        candidates.push({
          id: axis === 'H' ? 'fit_rows' : 'fit_columns',
          ...packed,
        });
      }
      break;
    }
  }
  return candidates;
}
