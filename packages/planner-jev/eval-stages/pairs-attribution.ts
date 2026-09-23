import type { TilingNode } from '@maelstrom-co/protocol';

import type { ComposedPairsRecord } from '../src/lib/stages-experimental/layout-composed-pairs.js';
import {
  NOT_STATED,
  type PairRelation,
  treeRelation,
} from '../src/lib/stages-experimental/layout-composed-pairs-tree.js';

/** How one composed-pairs call's answers and trees compare with a reference tree. */
export interface PairsAnswerCheck {
  /** Answered pairs the reference tree relates. */
  readonly compared: number;
  /** Pairs whose answer, with not stated read as the current tree's relation, differs from the reference's. */
  readonly wrongAnswers: readonly string[];
  /** Pairs answered not stated. */
  readonly notStated: number;
  /** Pairs the returned tree relates otherwise than the reference; absent when no tree was returned. */
  readonly wrongInTree?: readonly string[];
  /** Whether a candidate relates every answered pair as the reference does. */
  readonly referenceInCandidates: boolean;
}

/**
 * Compares one composed-pairs call with `referenceTree`, pair by pair,
 * over the answered pairs the reference relates, or says why it cannot:
 * no call was made, or an answered Instance is missing from the reference.
 */
export function checkPairAnswers(
  record: ComposedPairsRecord,
  referenceTree: readonly (string | null)[],
  currentTree: readonly (string | null)[],
  returnedTree: readonly TilingNode[] | undefined,
): PairsAnswerCheck | string {
  if (record.pairs === undefined) return 'no Jev call was made';
  const reference = referenceTree as readonly TilingNode[];
  const current = currentTree as readonly TilingNode[];
  const expected = new Map<string, PairRelation>();
  for (const { first, second } of record.pairs) {
    const relation = treeRelation(reference, first, second);
    if (relation === undefined)
      return `${first} or ${second} is not in the reference tree`;
    expected.set(pairKey(first, second), relation);
  }
  const wrongAnswers: string[] = [];
  let notStated = 0;
  for (const { first, second, answer } of record.pairs) {
    const key = pairKey(first, second);
    const stated =
      answer.choice === NOT_STATED
        ? treeRelation(current, first, second)
        : answer.choice;
    if (answer.choice === NOT_STATED) notStated += 1;
    if (stated !== expected.get(key)) wrongAnswers.push(key);
  }
  const differing = (tree: readonly TilingNode[]) =>
    [...expected].flatMap(([key, relation]) => {
      const [first = '', second = ''] = key.split(' / ');
      return treeRelation(tree, first, second) === relation ? [] : [key];
    });
  return {
    compared: expected.size,
    wrongAnswers,
    notStated,
    ...(returnedTree !== undefined && {
      wrongInTree: differing(returnedTree),
    }),
    referenceInCandidates: record.candidates.some(
      (candidate) => differing(candidate.tree).length === 0,
    ),
  };
}

function pairKey(first: string, second: string): string {
  return `${first} / ${second}`;
}
