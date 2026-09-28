import {
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

import { treeRects } from '../src/lib/layout-fit.js';
import type { Arranged } from './predicates.js';

/**
 * Bumped whenever the wording below changes, so a stored grader result
 * records which wording produced it.
 */
export const VERBALIZER_VERSION = 1;

/**
 * Deterministic, versioned English description of a tiling layout: the
 * split structure in words, then one line per leaf with its vessel,
 * variant, column and row extents and area share. Reads vessel and variant
 * from `layout.request.instances`, so describing a shipped layout takes a
 * request whose `instances` reflect the state after the response.
 */
export function verbalizeTree(layout: Arranged): string {
  const { request, tree } = layout;
  const { columns, rows } = request.context.chartDimensions;
  const byId = new Map(
    request.instances.map((instance) => [instance.instanceId, instance]),
  );
  const root = parseTree(tree);
  const lines = [
    `verbalize-tree v${VERBALIZER_VERSION}`,
    root === undefined ? '(empty)' : describeNode(root, byId),
  ];
  const shares =
    root === undefined ? new Map<string, Fraction>() : areaShares(root);
  const rects = treeRects(request, tree) ?? [];
  for (const rect of rects) {
    const instance = byId.get(rect.instanceId);
    if (instance === undefined) continue;
    const share = shares.get(rect.instanceId) ?? { num: 0, den: 1 };
    lines.push(
      `${rect.instanceId}: ${instance.vesselId} (${instance.variant}), ` +
        `columns ${fmt(rect.x)}-${fmt(rect.x + rect.width)} of ${columns}, ` +
        `rows ${fmt(rect.y)}-${fmt(rect.y + rect.height)} of ${rows}, ` +
        `area ${share.num}/${share.den}`,
    );
  }
  return lines.join('\n');
}

interface Fraction {
  readonly num: number;
  readonly den: number;
}

type ParsedNode =
  | { readonly kind: 'leaf'; readonly instanceId: string | null }
  | {
      readonly kind: 'split';
      readonly axis: 'H' | 'V';
      readonly weights: readonly number[];
      readonly children: readonly ParsedNode[];
    };

/** `undefined` for an empty tree; a malformed tree reads its leftover tokens as empty leaves. */
function parseTree(tree: readonly TilingNode[]): ParsedNode | undefined {
  if (tree.length === 0) return undefined;
  const cursor = { index: 0 };
  return parseNode(tree, cursor);
}

function parseNode(
  tree: readonly TilingNode[],
  cursor: { index: number },
): ParsedNode {
  const token = tree[cursor.index] ?? null;
  cursor.index += 1;
  const split = parseTilingSplitToken(token);
  if (split === null)
    return { kind: 'leaf', instanceId: tilingLeafInstanceId(token) };
  const children = split.weights.map(() => parseNode(tree, cursor));
  return { kind: 'split', axis: split.axis, weights: split.weights, children };
}

function describeNode(
  node: ParsedNode,
  byId: ReadonlyMap<string, { readonly vesselId: string }>,
): string {
  if (node.kind === 'leaf')
    return node.instanceId === null
      ? 'empty'
      : (byId.get(node.instanceId)?.vesselId ?? node.instanceId);
  const total = node.weights.reduce((sum, weight) => sum + weight, 0);
  const equal = node.weights.every((weight) => weight === node.weights[0]);
  if (equal) {
    const relation = node.axis === 'V' ? 'left of' : 'above';
    return node.children
      .map((child) => wrap(child, byId))
      .join(` ${relation} `);
  }
  const labels = positionLabels(node.axis, node.children.length);
  return node.children
    .map((child, index) => {
      const fraction = reduce(node.weights[index], total);
      return `${labels[index]} ${fraction.num}/${fraction.den}: ${describeNode(child, byId)}`;
    })
    .join('; ');
}

function wrap(
  node: ParsedNode,
  byId: ReadonlyMap<string, { readonly vesselId: string }>,
): string {
  const described = describeNode(node, byId);
  return node.kind === 'split' ? `(${described})` : described;
}

function positionLabels(axis: 'H' | 'V', count: number): readonly string[] {
  if (axis === 'V') {
    if (count === 2) return ['left', 'right'];
    if (count === 3) return ['left', 'center', 'right'];
    return Array.from({ length: count }, (_, index) => `column ${index + 1}`);
  }
  if (count === 2) return ['top', 'bottom'];
  if (count === 3) return ['top', 'middle', 'bottom'];
  return Array.from({ length: count }, (_, index) => `row ${index + 1}`);
}

/**
 * Each split divides its parent's area in proportion to its weight share
 * regardless of axis, so the area fraction is just the product of every
 * ancestor split's weight share, computed as an exact reduced fraction so
 * the result never carries floating-point drift.
 */
function areaShares(root: ParsedNode): Map<string, Fraction> {
  const shares = new Map<string, Fraction>();
  walk(root, { num: 1, den: 1 });
  return shares;

  function walk(node: ParsedNode, acc: Fraction): void {
    if (node.kind === 'leaf') {
      if (node.instanceId !== null) shares.set(node.instanceId, acc);
      return;
    }
    const total = node.weights.reduce((sum, weight) => sum + weight, 0);
    node.children.forEach((child, index) => {
      walk(child, reduce(acc.num * node.weights[index], acc.den * total));
    });
  }
}

function reduce(num: number, den: number): Fraction {
  const divisor = gcd(num, den) || 1;
  return { num: num / divisor, den: den / divisor };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}
