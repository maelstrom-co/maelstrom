import {
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

import type { ComposedAnswers } from '../src/lib/stages-experimental/layout-composed.js';
import {
  PARTS,
  POSITIONS,
} from '../src/lib/stages-experimental/layout-composed-tree.js';

/** A question kind of the composed-layout call. */
export type ComposedQuestion = 'shape' | 'placement' | 'position' | 'size';

/** Every {@link ComposedQuestion}, in the order the call asks them. */
export const COMPOSED_QUESTIONS: readonly ComposedQuestion[] = [
  'shape',
  'placement',
  'position',
  'size',
];

/** The answers a reference tree implies, by question kind and Instance. */
export interface ReferenceAnswers {
  readonly shape: string;
  readonly placements: Readonly<Record<string, string>>;
  readonly positions: Readonly<Record<string, string>>;
}

/** Which of Jev's composed-layout answers disagree with a reference tree. */
export interface ComposedAnswerCheck {
  readonly expected: ReferenceAnswers;
  readonly wrong: {
    readonly shape: boolean;
    /** Instances placed in another part than the reference's. */
    readonly placements: readonly string[];
    /** Instances ordered otherwise within their part. */
    readonly positions: readonly string[];
  };
}

/**
 * The answers `referenceTree` implies, or why it cannot be read as a
 * composed shape: its root must split into 2 to 4 parts, each part a leaf
 * or a split of leaves only.
 */
export function referenceAnswers(
  referenceTree: readonly (string | null)[],
): ReferenceAnswers | string {
  const parsed = parseNode(referenceTree as readonly TilingNode[], 0);
  if (parsed === undefined) return 'the reference tree is malformed';
  const root = parsed.node;
  if (root.kind !== 'split') return 'the reference tree is a single leaf';
  if (root.children.length < 2 || root.children.length > PARTS.length)
    return `the reference tree splits into ${root.children.length} parts`;
  if (
    root.children.some(
      (child) =>
        child.kind === 'split' &&
        child.children.some((grandchild) => grandchild.kind === 'split'),
    )
  )
    return 'the reference tree splits deeper than a part';
  const placements: Record<string, string> = {};
  const positions: Record<string, string> = {};
  root.children.forEach((child, partIndex) => {
    leavesOf(child).forEach((instanceId, position) => {
      placements[instanceId] = PARTS[partIndex];
      positions[instanceId] = POSITIONS[position] ?? `position_${position + 1}`;
    });
  });
  return {
    shape: `${root.axis === 'V' ? 'side_by_side' : 'stacked'}_${root.children.length}`,
    placements,
    positions,
  };
}

/**
 * Compares every answer of one composed-layout call with the answers
 * `referenceTree` implies, or says why they cannot be compared: the tree is
 * not a composed shape, or an answered Instance is missing from it.
 */
export function checkComposedAnswers(
  answers: ComposedAnswers,
  referenceTree: readonly (string | null)[],
): ComposedAnswerCheck | string {
  const expected = referenceAnswers(referenceTree);
  if (typeof expected === 'string') return expected;
  const ids = Object.keys(answers.placements);
  const missing = ids.find((id) => !(id in expected.placements));
  if (missing !== undefined) return `${missing} is not in the reference tree`;
  return {
    expected,
    wrong: {
      shape: answers.shape.choice !== expected.shape,
      placements: ids.filter(
        (id) => answers.placements[id]?.choice !== expected.placements[id],
      ),
      positions: ids.filter(
        (id) => answers.positions[id]?.choice !== expected.positions[id],
      ),
    },
  };
}

/**
 * The first question kind, in the order the call asks them, with a wrong
 * answer. With none wrong the miss attributes to `size` by elimination.
 */
export function firstWrongQuestion(
  check: ComposedAnswerCheck,
): ComposedQuestion {
  if (check.wrong.shape) return 'shape';
  if (check.wrong.placements.length > 0) return 'placement';
  if (check.wrong.positions.length > 0) return 'position';
  return 'size';
}

type ReferenceNode =
  | { readonly kind: 'leaf'; readonly instanceId: string | null }
  | {
      readonly kind: 'split';
      readonly axis: 'H' | 'V';
      readonly children: readonly ReferenceNode[];
    };

function parseNode(
  tree: readonly TilingNode[],
  index: number,
): { readonly node: ReferenceNode; readonly next: number } | undefined {
  const token = tree[index];
  if (token === undefined) return undefined;
  const split = parseTilingSplitToken(token);
  if (!split)
    return {
      node: {
        kind: 'leaf',
        instanceId: token === null ? null : tilingLeafInstanceId(token),
      },
      next: index + 1,
    };
  const children: ReferenceNode[] = [];
  let cursor = index + 1;
  for (const _weight of split.weights) {
    const child = parseNode(tree, cursor);
    if (child === undefined) return undefined;
    children.push(child.node);
    cursor = child.next;
  }
  return { node: { kind: 'split', axis: split.axis, children }, next: cursor };
}

function leavesOf(node: ReferenceNode): readonly string[] {
  if (node.kind === 'leaf')
    return node.instanceId === null ? [] : [node.instanceId];
  return node.children.flatMap(leavesOf);
}
