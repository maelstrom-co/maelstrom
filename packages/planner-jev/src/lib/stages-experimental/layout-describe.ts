import {
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

/**
 * The arrangement of `tree` in plain words, naming each Instance by its id:
 * the top-level parts with where they sit, each nested part as its
 * Instances "stacked" or "side by side", and every share of an unevenly
 * weighted split. For example `calendar on the left; tasks and map stacked
 * on the right`.
 */
export function describeLayout(tree: readonly TilingNode[]): string {
  if (tree.length === 0) return 'the chart is empty';
  const root = parseNode(tree, { index: 0 });
  if (root.kind === 'leaf') return `${leafName(root)} fills the chart`;
  const places = placeNames(root.axis, root.children.length);
  return root.children
    .map(
      (child, index) =>
        `${describeGroup(child)} ${places[index]}${shareOf(root, index)}`,
    )
    .join('; ');
}

type Node =
  | { readonly kind: 'leaf'; readonly instanceId: string | null }
  | {
      readonly kind: 'split';
      readonly axis: 'H' | 'V';
      readonly weights: readonly number[];
      readonly children: readonly Node[];
    };

function parseNode(
  tree: readonly TilingNode[],
  cursor: { index: number },
): Node {
  const token = tree[cursor.index] ?? null;
  cursor.index += 1;
  const split = parseTilingSplitToken(token);
  if (split === null)
    return { kind: 'leaf', instanceId: tilingLeafInstanceId(token) };
  const children = split.weights.map(() => parseNode(tree, cursor));
  return { kind: 'split', axis: split.axis, weights: split.weights, children };
}

function describeGroup(node: Node): string {
  if (node.kind === 'leaf') return leafName(node);
  const items = node.children.map((child, index) => {
    const name =
      child.kind === 'leaf' ? leafName(child) : `(${describeGroup(child)})`;
    return `${name}${shareOf(node, index)}`;
  });
  const listed = `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return `${listed} ${node.axis === 'V' ? 'side by side' : 'stacked'}`;
}

function leafName(node: { readonly instanceId: string | null }): string {
  return node.instanceId ?? 'nothing';
}

function shareOf(
  split: Extract<Node, { kind: 'split' }>,
  index: number,
): string {
  const { weights } = split;
  if (weights.every((weight) => weight === weights[0])) return '';
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const divisor = gcd(weights[index] ?? 0, total);
  const extent = split.axis === 'V' ? 'width' : 'height';
  return ` (${(weights[index] ?? 0) / divisor}/${total / divisor} of the ${extent})`;
}

function placeNames(axis: 'H' | 'V', count: number): readonly string[] {
  const [first, last, from] =
    axis === 'V'
      ? ['on the left', 'on the right', 'from the left']
      : ['at the top', 'at the bottom', 'from the top'];
  if (count === 2) return [first, last];
  if (count === 3) return [first, 'in the middle', last];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return first;
    if (index === count - 1) return last;
    return `${ordinal(index + 1)} ${from}`;
  });
}

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
];

function ordinal(place: number): string {
  return ORDINALS[place - 1] ?? `number ${place}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
