import {
  type InstanceId,
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';

import { splitTree } from '../layout-fit.js';

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

/** Probability per option of one choice answer; options left out have probability 0. */
export type OptionProbabilities = Readonly<Record<string, number>>;

/** The smallest share of the Chart any Instance is given, before renormalising. */
export const SIZE_FLOOR = 0.05;

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
 * The log probability every relation and top-level axis scores with,
 * read from the pair answers and the top-level `direction` answer (a
 * distribution over {@link TOP_DIRECTIONS} and {@link NOT_STATED}), each
 * floored at {@link PROBABILITY_FLOOR}.
 */
export interface RelationScores {
  /** The log probability of each top-level axis, weighted as one pair. */
  readonly direction: Readonly<Record<'H' | 'V', number>>;
  /** Per answered pair, the log probability of each relation `first` can have to `second`. */
  readonly pairs: readonly {
    readonly first: InstanceId;
    readonly second: InstanceId;
    readonly logProbability: Readonly<Record<PairRelation, number>>;
  }[];
}

/**
 * The {@link RelationScores} of the answers against `currentTree`.
 *
 * {@link NOT_STATED} votes for `currentTree`: a pair's not stated
 * probability is added to the relation the pair has in the current tree,
 * and ignored for a pair the current tree does not hold; a not stated
 * direction is added to the current tree's top split. When the direction's
 * most likely option is `side_by_side` or `stacked` and differs from the
 * current tree's top split, a pair's not stated probability votes instead
 * for the relation along that direction that keeps the pair's order in the
 * current tree (the leaf that comes first there goes left, or on top).
 */
export function relationScores(
  pairs: readonly PairAnswer[],
  currentTree: readonly TilingNode[],
  direction: OptionProbabilities,
): RelationScores {
  const statedDirection = statedAxis(direction);
  const redirectAxis =
    statedDirection === treeDirection(currentTree)
      ? undefined
      : statedDirection;
  const leafOrder =
    redirectAxis === undefined ? undefined : leafIndexes(currentTree);
  return {
    direction: directionTable(direction, currentTree),
    pairs: pairs.map((pair) => {
      const current =
        redirectAxis === undefined || leafOrder === undefined
          ? treeRelation(currentTree, pair.first, pair.second)
          : orderAlong(redirectAxis, leafOrder, pair.first, pair.second);
      const notStated = pair.probabilities[NOT_STATED] ?? 0;
      return {
        first: pair.first,
        second: pair.second,
        logProbability: Object.fromEntries(
          PAIR_RELATIONS.map((relation) => {
            const probability =
              (pair.probabilities[relation] ?? 0) +
              (relation === current ? notStated : 0);
            return [
              relation,
              Math.log(Math.max(probability, PROBABILITY_FLOOR)),
            ];
          }),
        ) as Record<PairRelation, number>,
      };
    }),
  };
}

/**
 * The score of a tree whose top split runs along `axis` and whose pairs
 * relate as `relationOf` reads them: the direction's log probability plus,
 * for each answered pair the tree holds, the log probability of its
 * relation.
 */
export function scoreRelations(
  scores: RelationScores,
  axis: 'H' | 'V',
  relationOf: (
    first: InstanceId,
    second: InstanceId,
  ) => PairRelation | undefined,
): number {
  return scores.pairs.reduce((sum, { first, second, logProbability }) => {
    const relation = relationOf(first, second);
    return relation === undefined ? sum : sum + logProbability[relation];
  }, scores.direction[axis]);
}

/**
 * Scores every arrangement of `ids` against the pair answers and the
 * top-level `direction` answer, highest first; ties keep enumeration
 * order. An arrangement scores the sum over answered pairs of the log
 * probability of the relation it implies plus the log probability of its
 * top-level axis, read with {@link relationScores}, so not stated votes
 * for the current tree or, when the direction changes its top split, for
 * the current order along that direction.
 */
export function rankArrangements(
  ids: readonly InstanceId[],
  pairs: readonly PairAnswer[],
  currentTree: readonly TilingNode[],
  direction: OptionProbabilities,
): readonly ScoredArrangement[] {
  const scores = relationScores(pairs, currentTree, direction);
  return enumerateArrangements(ids)
    .map((arrangement, order) => ({
      scored: {
        arrangement,
        score: scoreRelations(scores, arrangement.axis, (first, second) =>
          arrangementRelation(arrangement, first, second),
        ),
      },
      order,
    }))
    .sort((a, b) => b.scored.score - a.scored.score || a.order - b.order)
    .map(({ scored }) => scored);
}

/** How {@link arrangementTree} splits inside each part. */
export interface PartSizing {
  /** Shares for the split inside each part from its members in order; `shareById` when absent. */
  readonly innerSharesOf?: (
    members: readonly InstanceId[],
  ) => readonly number[];
}

/** An Instance's minimum size as fractions of the Chart's width and height. */
export interface MinimumFraction {
  readonly width: number;
  readonly height: number;
}

/**
 * The tiling tree of `arrangement`, each split weighted by the summed
 * shares of the Instances under each child, as the smallest integers in
 * that ratio (see {@link integerWeights}). A part of one Instance is a leaf.
 * `sizing` can split inside a part by separate shares.
 */
export function arrangementTree(
  arrangement: Arrangement,
  shareById: Readonly<Record<string, number>>,
  sizing: PartSizing = {},
): readonly TilingNode[] {
  const { top, inner: innerShares } = arrangementShares(
    arrangement,
    shareById,
    sizing,
  );
  return treeOfShares(arrangement, top, innerShares);
}

/**
 * {@link arrangementTree} with every share below its Instance's minimum
 * raised to it along each split and the other shares scaled down (see
 * {@link raiseToMinimum}); a part's minimum along the top axis is the
 * largest of its members'. `undefined` when the minimums along one split
 * add up to more than the whole.
 */
export function arrangementTreeAtMinimum(
  arrangement: Arrangement,
  shareById: Readonly<Record<string, number>>,
  minimumById: Readonly<Record<string, MinimumFraction>>,
  sizing: PartSizing = {},
): readonly TilingNode[] | undefined {
  const { top, inner: innerShares } = arrangementShares(
    arrangement,
    shareById,
    sizing,
  );
  const along = (axis: 'H' | 'V', id: InstanceId) => {
    const minimum = minimumById[id];
    if (minimum === undefined) return 0;
    return axis === 'V' ? minimum.width : minimum.height;
  };
  const topMinimum = arrangement.parts.map((members) =>
    Math.max(0, ...members.map((id) => along(arrangement.axis, id))),
  );
  const topWeights = weightsAtMinimum(top, topMinimum);
  if (topWeights === undefined) return undefined;
  const innerWeights: (readonly number[])[] = [];
  for (const [index, members] of arrangement.parts.entries()) {
    const weights = weightsAtMinimum(
      innerShares[index] ?? [],
      members.map((id) => along(inner(arrangement.axis), id)),
    );
    if (weights === undefined) return undefined;
    innerWeights.push(weights);
  }
  return treeOfWeights(arrangement, topWeights, innerWeights);
}

/** The tiling tree of `arrangement` with every split's children weighted equally. */
export function equalArrangementTree(
  arrangement: Arrangement,
): readonly TilingNode[] {
  return treeOfShares(
    arrangement,
    arrangement.parts.map(() => 1),
    arrangement.parts.map((members) => members.map(() => 1)),
  );
}

/**
 * `desired` normalised to fractions of 1, with every fraction below its
 * `minimum` raised to it and the others scaled down in proportion until
 * none is below its minimum. `undefined` when the minimums add up to more
 * than 1.
 */
export function raiseToMinimum(
  desired: readonly number[],
  minimum: readonly number[],
): readonly number[] | undefined {
  const floorOf = (index: number) => minimum[index] ?? 0;
  if (desired.reduce((sum, _, index) => sum + floorOf(index), 0) > 1 + 1e-9)
    return undefined;
  const total = desired.reduce((sum, share) => sum + share, 0);
  const target = desired.map((share) =>
    total > 0 ? share / total : 1 / desired.length,
  );
  const fixed = new Set<number>();
  for (;;) {
    const remaining =
      1 - [...fixed].reduce((sum, index) => sum + floorOf(index), 0);
    const freeTotal = target.reduce(
      (sum, share, index) => (fixed.has(index) ? sum : sum + share),
      0,
    );
    const shares = target.map((share, index) =>
      fixed.has(index)
        ? floorOf(index)
        : freeTotal > 0
          ? (share / freeTotal) * remaining
          : remaining / (target.length - fixed.size),
    );
    const below = shares.flatMap((share, index) =>
      !fixed.has(index) && share < floorOf(index) - 1e-12 ? [index] : [],
    );
    if (below.length === 0) return shares;
    for (const index of below) fixed.add(index);
  }
}

/**
 * Small integer weights for `shares` raised to `minimum` (see
 * {@link raiseToMinimum}) that keep every child at or above its minimum
 * fraction after rounding, the closest to the raised shares among the
 * smallest totals tried. `undefined` when the minimums cannot fit or no
 * total up to {@link MAX_MINIMUM_WEIGHT_TOTAL} keeps them.
 */
export function weightsAtMinimum(
  shares: readonly number[],
  minimum: readonly number[],
): readonly number[] | undefined {
  if (shares.length < 2) return shares;
  const raised = raiseToMinimum(shares, minimum);
  if (raised === undefined) return undefined;
  let best: { weights: number[]; error: number } | undefined;
  for (let scale = 1; scale <= MAX_MINIMUM_WEIGHT_TOTAL; scale += 1) {
    const weights = raised.map((share) =>
      Math.max(1, Math.round(share * scale)),
    );
    const sum = weights.reduce((acc, weight) => acc + weight, 0);
    const keepsMinimum = weights.every(
      (weight, index) => weight / sum + 1e-9 >= (minimum[index] ?? 0),
    );
    if (!keepsMinimum) continue;
    const error = Math.max(
      ...weights.map((weight, index) =>
        Math.abs(weight / sum - (raised[index] ?? 0)),
      ),
    );
    if (error <= MINIMUM_WEIGHT_TOLERANCE) return weights;
    if (best === undefined || error < best.error) best = { weights, error };
  }
  return best?.weights;
}

/**
 * Normalises answered sizes into shares of the Chart summing to 1. All zero
 * reads as equal shares; any share under {@link SIZE_FLOOR} is raised to it
 * before renormalising, so no share is 0.
 */
export function sizeShares(sizes: readonly number[]): readonly number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const shares =
    total > 0
      ? sizes.map((size) => size / total)
      : sizes.map(() => 1 / sizes.length);
  if (shares.every((share) => share >= SIZE_FLOOR)) return shares;
  const floored = shares.map((share) => Math.max(share, SIZE_FLOOR));
  const flooredTotal = floored.reduce((sum, share) => sum + share, 0);
  return floored.map((share) => share / flooredTotal);
}

/**
 * The smallest positive integers in the ratio of `shares`, within
 * {@link WEIGHT_TOLERANCE} of each normalised share, for a Weighted Split
 * token. Falls back to the closest ratio with a total of at most
 * {@link MAX_WEIGHT_TOTAL}.
 */
export function integerWeights(shares: readonly number[]): readonly number[] {
  const total = shares.reduce((sum, share) => sum + share, 0);
  const target = shares.map((share) => share / total);
  let best: { weights: number[]; error: number } | undefined;
  for (let scale = 1; scale <= MAX_WEIGHT_TOTAL; scale += 1) {
    const weights = target.map((share) =>
      Math.max(1, Math.round(share * scale)),
    );
    const sum = weights.reduce((acc, weight) => acc + weight, 0);
    const error = Math.max(
      ...weights.map((weight, index) =>
        Math.abs(weight / sum - (target[index] ?? 0)),
      ),
    );
    if (error <= WEIGHT_TOLERANCE) return reduced(weights);
    if (best === undefined || error < best.error) best = { weights, error };
  }
  return reduced(best?.weights ?? shares.map(() => 1));
}

/**
 * How far, in nats, a lower-ranked tree that fits as sized may score behind
 * a tree that does not before the higher tree is resized instead. Within it
 * the two are too close to trust the ranking over the answered sizes.
 */
export const AS_SIZED_SCORE_MARGIN = 2;

/** How a tree was resized because it did not fit as sized. */
export type SizeFallbackKind = 'raised_to_minimum' | 'equal_weights';

/** One of the top-ranked trees offered to {@link pickSizedTree}, written each way it can be sized. */
export interface SizedTreeCandidate {
  /** Log probability of the tree under the answers; higher is better. */
  readonly score: number;
  /** The tree weighted by the answered sizes. */
  readonly asSized: readonly TilingNode[];
  /** The tree with every share raised to its Instance's minimum; `undefined` when the minimums cannot fit together. */
  readonly raised: readonly TilingNode[] | undefined;
  /** The tree with every split's children weighted equally. */
  readonly equal: readonly TilingNode[];
}

/** The tree {@link pickSizedTree} picked, and how it was sized. */
export type SizedTreePick =
  | {
      readonly tree: readonly TilingNode[];
      /** Index of the candidate shipped as sized. */
      readonly chosen: number;
      readonly fallback?: undefined;
    }
  | {
      readonly tree: readonly TilingNode[];
      readonly chosen?: undefined;
      /** The resize that wrote the tree, and the index of the candidate whose structure it kept. */
      readonly fallback: {
        readonly kind: SizeFallbackKind;
        readonly candidate: number;
      };
    };

/**
 * Picks the tree to ship from `candidates`, best first. Each candidate in
 * turn ships as sized when it fits. When it does not, the first lower
 * candidate that fits as sized and scores within
 * {@link AS_SIZED_SCORE_MARGIN} of it ships instead; otherwise the
 * candidate ships raised to its minimums, then with equal weights, before
 * the next candidate is tried. `undefined` when nothing fits.
 */
export function pickSizedTree(
  candidates: readonly SizedTreeCandidate[],
  fits: (tree: readonly TilingNode[]) => boolean,
): SizedTreePick | undefined {
  for (const [index, candidate] of candidates.entries()) {
    if (fits(candidate.asSized))
      return { tree: candidate.asSized, chosen: index };
    const near = candidates.findIndex(
      (lower, lowerIndex) =>
        lowerIndex > index &&
        lower.score >= candidate.score - AS_SIZED_SCORE_MARGIN &&
        fits(lower.asSized),
    );
    const nearTree = candidates[near]?.asSized;
    if (nearTree !== undefined) return { tree: nearTree, chosen: near };
    if (candidate.raised !== undefined && fits(candidate.raised))
      return {
        tree: candidate.raised,
        fallback: { kind: 'raised_to_minimum', candidate: index },
      };
    if (fits(candidate.equal))
      return {
        tree: candidate.equal,
        fallback: { kind: 'equal_weights', candidate: index },
      };
  }
  return undefined;
}

/** The largest weight total {@link weightsAtMinimum} tries. */
const MAX_MINIMUM_WEIGHT_TOTAL = 48;

/** Largest error per share {@link weightsAtMinimum} accepts before trying a larger total. */
const MINIMUM_WEIGHT_TOLERANCE = 0.025;

/** Largest error per share a ratio of small integers may have before a larger total is tried. */
const WEIGHT_TOLERANCE = 0.025;

/** The largest sum of integer weights one split is written with. */
const MAX_WEIGHT_TOTAL = 24;

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

function arrangementShares(
  arrangement: Arrangement,
  shareById: Readonly<Record<string, number>>,
  sizing: PartSizing,
): {
  readonly top: readonly number[];
  readonly inner: readonly (readonly number[])[];
} {
  const shareOf = (id: InstanceId) => shareById[id] ?? 0;
  return {
    top: arrangement.parts.map((members) =>
      members.reduce((sum, id) => sum + shareOf(id), 0),
    ),
    inner: arrangement.parts.map((members) =>
      sizing.innerSharesOf
        ? sizing.innerSharesOf(members)
        : members.map(shareOf),
    ),
  };
}

function treeOfShares(
  arrangement: Arrangement,
  top: readonly number[],
  innerShares: readonly (readonly number[])[],
): readonly TilingNode[] {
  return treeOfWeights(
    arrangement,
    weightsOf(top),
    innerShares.map((shares) => weightsOf(shares)),
  );
}

function treeOfWeights(
  arrangement: Arrangement,
  top: readonly number[],
  innerWeights: readonly (readonly number[])[],
): readonly TilingNode[] {
  const partTrees = arrangement.parts.map((members, index) =>
    splitTree(
      inner(arrangement.axis),
      members.map((id) => [tilingLeafToken(id)]),
      innerWeights[index] ?? [],
    ),
  );
  return splitTree(arrangement.axis, partTrees, top);
}

/** The axis the direction answer's most likely option names, `undefined` when that is not stated. */
function statedAxis(direction: OptionProbabilities): 'H' | 'V' | undefined {
  const [best] = Object.entries(direction).sort((a, b) => b[1] - a[1]);
  if (best === undefined || !(best[0] in TOP_DIRECTIONS)) return undefined;
  return TOP_DIRECTIONS[best[0] as TopDirection];
}

function leafIndexes(tree: readonly TilingNode[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const token of tree) {
    const id = tilingLeafInstanceId(token ?? null);
    if (id !== null) order.set(id, order.size);
  }
  return order;
}

function orderAlong(
  axis: 'H' | 'V',
  order: ReadonlyMap<string, number>,
  first: InstanceId,
  second: InstanceId,
): PairRelation | undefined {
  const a = order.get(first);
  const b = order.get(second);
  if (a === undefined || b === undefined) return undefined;
  return relationAlong(axis, a < b);
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

function reduced(weights: readonly number[]): readonly number[] {
  const divisor = weights.reduce(gcd);
  return weights.map((weight) => weight / divisor);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
