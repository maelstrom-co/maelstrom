import {
  type InstanceId,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';

import { splitTree } from '../layout-fit.js';
import {
  integerWeights,
  type OptionProbabilities,
} from './layout-composed-tree.js';

/** Where one Instance sits relative to another. */
export const PAIR_RELATIONS = [
  'left_of',
  'right_of',
  'above',
  'below',
] as const;

/** One {@link PAIR_RELATIONS} entry. */
export type PairRelation = (typeof PAIR_RELATIONS)[number];

/** The pair answer meaning the request places neither Instance relative to the other. */
export const NOT_STATED = 'not_stated';

/** The options of the top-level direction answer, by the split axis each stands for. */
export const TOP_DIRECTIONS = { side_by_side: 'V', stacked: 'H' } as const;

/** One {@link TOP_DIRECTIONS} option. */
export type TopDirection = keyof typeof TOP_DIRECTIONS;

/** The most parts the top-level split of an enumerated arrangement has. */
export const MAX_TOP_PARTS = 4;

/** The smallest probability a relation is scored with, so no tree scores minus infinity. */
export const PROBABILITY_FLOOR = 1e-6;

/**
 * A two-level arrangement: the top-level split direction (`V` side by side,
 * `H` stacked) and its parts in order, each part's Instances arranged the
 * other way in order.
 */
export interface Arrangement {
  readonly axis: 'H' | 'V';
  readonly parts: readonly (readonly InstanceId[])[];
}

/** Jev's answer about one unordered pair, `first` before `second` in the visible list. */
export interface PairAnswer {
  readonly first: InstanceId;
  readonly second: InstanceId;
  /** Over {@link PAIR_RELATIONS} and {@link NOT_STATED}: where `first` sits relative to `second`. */
  readonly probabilities: OptionProbabilities;
}

/** An arrangement with its score, highest first when ranked. */
export interface ScoredArrangement {
  readonly arrangement: Arrangement;
  /** Sum over the pairs of the log probability of the relation the arrangement implies. */
  readonly score: number;
}

/**
 * Every arrangement of `ids`: each top-level direction, each order of the
 * Instances, and each cut of that order into 2 to
 * `min(MAX_TOP_PARTS, n)` consecutive parts. That is
 * `2 * n! * sum_{k=2..min(4,n)} C(n-1, k-1)` arrangements, all distinct;
 * none for fewer than 2 Instances.
 */
export function enumerateArrangements(
  ids: readonly InstanceId[],
): readonly Arrangement[] {
  if (ids.length < 2) return [];
  const cuts = cutsOf(ids.length);
  const arrangements: Arrangement[] = [];
  for (const axis of ['V', 'H'] as const)
    for (const order of permutations(ids))
      for (const sizes of cuts) {
        const parts: InstanceId[][] = [];
        let start = 0;
        for (const size of sizes) {
          parts.push(order.slice(start, start + size));
          start += size;
        }
        arrangements.push({ axis, parts });
      }
  return arrangements;
}

/**
 * The relation `first` has to `second` in `arrangement`: along the top
 * axis by part order when they sit in different parts, along the inner
 * axis by order when they share one. `undefined` when either is absent.
 */
export function arrangementRelation(
  arrangement: Arrangement,
  first: InstanceId,
  second: InstanceId,
): PairRelation | undefined {
  const locate = (id: InstanceId) => {
    const part = arrangement.parts.findIndex((members) => members.includes(id));
    return { part, index: arrangement.parts[part]?.indexOf(id) ?? -1 };
  };
  const a = locate(first);
  const b = locate(second);
  if (a.part < 0 || b.part < 0 || first === second) return undefined;
  if (a.part !== b.part)
    return relationAlong(arrangement.axis, a.part < b.part);
  return relationAlong(inner(arrangement.axis), a.index < b.index);
}

/**
 * The relation `first` has to `second` in any tiling tree, read at the
 * split where their paths part: `left_of` or `right_of` under a `V` split,
 * `above` or `below` under an `H` split. `undefined` when either is not a
 * leaf of `tree` or the tree is malformed.
 */
export function treeRelation(
  tree: readonly TilingNode[],
  first: string,
  second: string,
): PairRelation | undefined {
  const paths = leafPaths(tree);
  const a = paths?.get(first);
  const b = paths?.get(second);
  if (a === undefined || b === undefined || first === second) return undefined;
  for (let depth = 0; depth < Math.min(a.length, b.length); depth += 1) {
    const stepA = a[depth];
    const stepB = b[depth];
    if (stepA === undefined || stepB === undefined) return undefined;
    if (stepA.child !== stepB.child)
      return relationAlong(stepA.axis, stepA.child < stepB.child);
  }
  return undefined;
}

/**
 * The axis of the top split of `tree`, `undefined` when it is empty, a
 * single leaf, or does not start with a split.
 */
export function treeDirection(
  tree: readonly TilingNode[],
): 'H' | 'V' | undefined {
  return parseTilingSplitToken(tree[0] ?? null)?.axis;
}

/**
 * Scores every arrangement of `ids` against the pair answers, highest
 * first; ties keep enumeration order. An arrangement scores the sum over
 * answered pairs of the log probability of the relation it implies,
 * floored at {@link PROBABILITY_FLOOR}. {@link NOT_STATED} votes for
 * `currentTree`: its probability is added to the relation the pair has in
 * the current tree, and ignored for a pair the current tree does not hold.
 *
 * With `direction`, a distribution over {@link TOP_DIRECTIONS} and
 * {@link NOT_STATED}, each arrangement also scores the log probability of
 * its top-level axis, weighted as one pair, with not stated voting for the
 * current tree's top split the same way.
 */
export function rankArrangements(
  ids: readonly InstanceId[],
  pairs: readonly PairAnswer[],
  currentTree: readonly TilingNode[],
  direction?: OptionProbabilities,
): readonly ScoredArrangement[] {
  const directionScore = direction && directionTable(direction, currentTree);
  const tables = pairs.map((pair) => {
    const current = treeRelation(currentTree, pair.first, pair.second);
    const notStated = pair.probabilities[NOT_STATED] ?? 0;
    return {
      pair,
      logProbability: Object.fromEntries(
        PAIR_RELATIONS.map((relation) => {
          const probability =
            (pair.probabilities[relation] ?? 0) +
            (relation === current ? notStated : 0);
          return [relation, Math.log(Math.max(probability, PROBABILITY_FLOOR))];
        }),
      ) as Record<PairRelation, number>,
    };
  });
  return enumerateArrangements(ids)
    .map((arrangement) => ({
      arrangement,
      score: tables.reduce((sum, { pair, logProbability }) => {
        const relation = arrangementRelation(
          arrangement,
          pair.first,
          pair.second,
        );
        return relation === undefined ? sum : sum + logProbability[relation];
      }, directionScore?.[arrangement.axis] ?? 0),
    }))
    .map((scored, order) => ({ scored, order }))
    .sort((a, b) => b.scored.score - a.scored.score || a.order - b.order)
    .map(({ scored }) => scored);
}

/**
 * The tiling tree of `arrangement`, each split weighted by the summed
 * shares of the Instances under each child, as the smallest integers in
 * that ratio (see {@link integerWeights}). A part of one Instance is a leaf.
 */
export function arrangementTree(
  arrangement: Arrangement,
  shareById: Readonly<Record<string, number>>,
): readonly TilingNode[] {
  const shareOf = (id: InstanceId) => shareById[id] ?? 0;
  const partTrees = arrangement.parts.map((members) =>
    splitTree(
      inner(arrangement.axis),
      members.map((id) => [tilingLeafToken(id)]),
      weightsOf(members.map(shareOf)),
    ),
  );
  return splitTree(
    arrangement.axis,
    partTrees,
    weightsOf(
      arrangement.parts.map((members) =>
        members.reduce((sum, id) => sum + shareOf(id), 0),
      ),
    ),
  );
}

function directionTable(
  direction: OptionProbabilities,
  currentTree: readonly TilingNode[],
): Record<'H' | 'V', number> {
  const current = treeDirection(currentTree);
  const notStated = direction[NOT_STATED] ?? 0;
  const logOf = (option: TopDirection) => {
    const axis = TOP_DIRECTIONS[option];
    const probability =
      (direction[option] ?? 0) + (axis === current ? notStated : 0);
    return Math.log(Math.max(probability, PROBABILITY_FLOOR));
  };
  return { V: logOf('side_by_side'), H: logOf('stacked') };
}

function relationAlong(
  axis: 'H' | 'V',
  firstComesFirst: boolean,
): PairRelation {
  if (axis === 'V') return firstComesFirst ? 'left_of' : 'right_of';
  return firstComesFirst ? 'above' : 'below';
}

function inner(axis: 'H' | 'V'): 'H' | 'V' {
  return axis === 'V' ? 'H' : 'V';
}

function weightsOf(shares: readonly number[]): readonly number[] {
  return shares.length < 2 ? shares : integerWeights(shares);
}

/** Part sizes of every cut of `n` Instances into 2 to {@link MAX_TOP_PARTS} consecutive parts. */
function cutsOf(n: number): readonly (readonly number[])[] {
  const cuts: number[][] = [];
  const extend = (sizes: number[], remaining: number) => {
    if (remaining === 0) {
      if (sizes.length >= 2) cuts.push(sizes);
      return;
    }
    if (sizes.length === MAX_TOP_PARTS) return;
    for (let size = 1; size <= remaining; size += 1)
      extend([...sizes, size], remaining - size);
  };
  extend([], n);
  return cuts;
}

function permutations<T>(items: readonly T[]): readonly T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

interface PathStep {
  readonly axis: 'H' | 'V';
  readonly child: number;
}

function leafPaths(
  tree: readonly TilingNode[],
): Map<string, readonly PathStep[]> | undefined {
  const paths = new Map<string, readonly PathStep[]>();
  let cursor = 0;
  const walk = (path: readonly PathStep[]): boolean => {
    if (cursor >= tree.length) return false;
    const token = tree[cursor] ?? null;
    cursor += 1;
    const split = parseTilingSplitToken(token);
    if (split === null) {
      const id = tilingLeafInstanceId(token);
      if (id !== null) paths.set(id, path);
      return true;
    }
    return split.weights.every((_, child) =>
      walk([...path, { axis: split.axis, child }]),
    );
  };
  if (tree.length === 0 || !walk([])) return undefined;
  return paths;
}
