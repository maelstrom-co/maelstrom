import {
  type ChartRequest,
  MAX_SPLIT_CHILDREN,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { layoutFits, splitTree, treeRects } from './layout-fit.js';
import { packingChoices } from './packing.js';

export interface LayoutChoice {
  readonly id: string;
  readonly description: string;
  readonly tree: readonly TilingNode[];
}

/** How {@link layoutChoices} phrases each candidate's `description`. */
export type LayoutChoicesDescribeMode = 'tokens' | 'placements';

/** Options for {@link layoutChoices}. */
export interface LayoutChoicesOptions {
  /**
   * `'tokens'` (the default) describes each candidate by its split
   * structure, as today. `'placements'` describes it by the Instances and
   * their positions in the rectangles the candidate's tree resolves to on
   * the request's Chart, and collapses candidates whose Instances land on
   * the exact same rectangles, keeping the first (`preserve` wins any tie,
   * since it is always considered first).
   */
  readonly describe?: LayoutChoicesDescribeMode;
}

/**
 * Candidate trees for the visible instances, each already checked against
 * the Chart and every instance's `minSize`: `preserve` (the current tree),
 * `single`, `row`, `column`, balanced `rows_N`, `focus/<axis>/<id>` (one
 * instance gets two thirds) and size-aware `fit_rows` / `fit_columns`.
 *
 * `options.describe` only changes how each candidate is phrased (and, in
 * `'placements'` mode, collapses rectangle-identical candidates); it never
 * changes which trees are offered.
 */
export function layoutChoices(
  request: ChartRequest,
  visible: readonly VesselInstanceSnapshot[],
  options: LayoutChoicesOptions = {},
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
  return options.describe === 'placements'
    ? describeAsPlacements(request, candidates)
    : candidates;
}

const RECT_PRECISION = 4;

/**
 * Collapses candidates whose Instances resolve to the same rectangles on
 * the Chart, keeping the first occurrence, and rewrites every remaining
 * candidate's description to name its Instances and their positions.
 */
function describeAsPlacements(
  request: ChartRequest,
  candidates: readonly LayoutChoice[],
): readonly LayoutChoice[] {
  const seen = new Set<string>();
  const deduped: LayoutChoice[] = [];
  for (const candidate of candidates) {
    const signature = rectSignature(request, candidate.tree);
    if (signature !== undefined) {
      if (seen.has(signature)) continue;
      seen.add(signature);
    }
    deduped.push({
      ...candidate,
      description:
        placementDescription(candidate.tree) || candidate.description,
    });
  }
  return deduped;
}

/** A key identifying the set of rectangles `tree` resolves to, order-independent. */
function rectSignature(
  request: ChartRequest,
  tree: readonly TilingNode[],
): string | undefined {
  const rects = treeRects(request, tree);
  if (!rects) return undefined;
  return rects
    .map(
      (rect) =>
        `${rect.instanceId}:${roundToPrecision(rect.x)},${roundToPrecision(rect.y)},${roundToPrecision(rect.width)},${roundToPrecision(rect.height)}`,
    )
    .sort()
    .join('|');
}

function roundToPrecision(value: number): number {
  const scale = 10 ** RECT_PRECISION;
  return Math.round(value * scale) / scale;
}

/** One node of a tiling tree read back into a nested shape, for description. */
type PlacementNode =
  | { readonly kind: 'leaf'; readonly instanceId: string }
  | {
      readonly kind: 'split';
      readonly axis: 'H' | 'V';
      readonly children: readonly PlacementNode[];
    };

/** Plain words naming `tree`'s Instances and their positions, or `undefined` when `tree` is empty or malformed. */
function placementDescription(tree: readonly TilingNode[]): string | undefined {
  if (tree.length === 0) return undefined;
  const cursor = { index: 0 };
  const root = parsePlacementNode(tree, cursor);
  if (!root || cursor.index !== tree.length) return undefined;
  return describePlacementRoot(root);
}

function parsePlacementNode(
  tree: readonly TilingNode[],
  cursor: { index: number },
): PlacementNode | undefined {
  if (cursor.index >= tree.length) return undefined;
  const token = tree[cursor.index++];
  const branch = parseTilingSplitToken(token);
  if (branch) {
    if (branch.repaired) return undefined;
    const children: PlacementNode[] = [];
    for (let count = 0; count < branch.weights.length; count++) {
      const child = parsePlacementNode(tree, cursor);
      if (child) children.push(child);
    }
    return { kind: 'split', axis: branch.axis, children };
  }
  if (token === null) return undefined;
  const instanceId = tilingLeafInstanceId(token);
  return instanceId === null ? undefined : { kind: 'leaf', instanceId };
}

function describePlacementRoot(node: PlacementNode): string {
  if (node.kind === 'leaf') return `${node.instanceId} fills the Chart.`;
  const parts = node.children
    .map((child) => ({
      text: describePlacementGroup(child),
      leaf: child.kind === 'leaf',
    }))
    .filter((part) => part.text.length > 0);
  if (parts.length === 0) return '';
  if (parts.length === 1) return `${parts[0].text} fills the Chart.`;
  const mixed =
    parts.some((part) => part.leaf) && parts.some((part) => !part.leaf);
  const qualifier = node.axis === 'V' ? 'full height' : 'full width';
  const verb = node.axis === 'V' ? 'Side by side' : 'Stacked';
  const labeled = parts.map((part, index) => {
    const position = placementPosition(node.axis, index, parts.length);
    const suffix = mixed && part.leaf ? ` ${qualifier}` : '';
    return `${part.text}${suffix} ${position}`;
  });
  return `${verb}: ${labeled.join(', ')}.`;
}

function describePlacementGroup(node: PlacementNode): string {
  if (node.kind === 'leaf') return node.instanceId;
  const parts = node.children
    .map(describePlacementGroup)
    .filter((text) => text.length > 0);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const verb = node.axis === 'V' ? 'side by side' : 'stacked';
  return `${listJoin(parts)} ${verb}`;
}

function placementPosition(
  axis: 'H' | 'V',
  index: number,
  count: number,
): string {
  if (axis === 'V') {
    if (index === 0) return 'on the left';
    if (index === count - 1) return 'on the right';
    return 'in the middle';
  }
  if (index === 0) return 'on top';
  if (index === count - 1) return 'below';
  return 'in the middle';
}

function listJoin(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}
