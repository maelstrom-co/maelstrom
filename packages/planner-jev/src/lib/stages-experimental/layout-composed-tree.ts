import {
  type InstanceId,
  type TilingNode,
  tilingLeafToken,
} from '@maelstrom-co/protocol';

import { splitTree } from '../layout-fit.js';

/** The shapes a composed layout can take: top-level direction and part count. */
export const SHAPES = [
  'side_by_side_2',
  'side_by_side_3',
  'side_by_side_4',
  'stacked_2',
  'stacked_3',
  'stacked_4',
] as const;

/** A top-level direction and part count; side by side is a `V` split, stacked an `H` split. */
export type Shape = (typeof SHAPES)[number];

/** The parts an Instance can be placed in, part 1 leftmost or topmost. */
export const PARTS = ['part_1', 'part_2', 'part_3', 'part_4'] as const;

/** One part of a {@link Shape}. */
export type Part = (typeof PARTS)[number];

/** An Instance's order within its part, first leftmost or topmost. */
export const POSITIONS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
] as const;

/** One {@link POSITIONS} entry. */
export type Position = (typeof POSITIONS)[number];

/** The smallest share of the Chart any Instance is given, before renormalising. */
export const SIZE_FLOOR = 0.05;

/** Probability per option of one choice answer; options left out have probability 0. */
export type OptionProbabilities = Readonly<Record<string, number>>;

/** What Jev answered about one Instance. */
export interface InstanceAnswers {
  readonly instanceId: InstanceId;
  /** Over {@link PARTS}. */
  readonly placement: OptionProbabilities;
  /** Over {@link POSITIONS}. */
  readonly position: OptionProbabilities;
  /** The Instance's share of the Chart by area as answered, from 0 to 1, before normalising. */
  readonly size: number;
}

/** Every answer of one composed-layout call, as probabilities. */
export interface CompositionAnswers {
  /** Over {@link SHAPES}; any other key is ignored. */
  readonly shape: OptionProbabilities;
  /** In a stable order, which also breaks position ties left after probability. */
  readonly instances: readonly InstanceAnswers[];
}

/** One answer combination assembled into a tiling tree. */
export interface ComposedCandidate {
  readonly tree: readonly TilingNode[];
  /** Geometric mean of the probabilities the tree depends on (see {@link composeCandidates}). */
  readonly meanProbability: number;
  readonly shape: Shape;
  readonly placements: Readonly<Record<string, Part>>;
  readonly positions: Readonly<Record<string, Position>>;
  /** Normalised share of the Chart per Instance; the same for every candidate of one call. */
  readonly shares: Readonly<Record<string, number>>;
  /** Parts of the shape no Instance was placed in; dropped from the tree. */
  readonly droppedParts: readonly Part[];
  /** Parts past the shape's count that Instances were placed in; kept in the tree. */
  readonly addedParts: readonly Part[];
}

/**
 * The `limit` most probable distinct trees the answers describe, most
 * probable first.
 *
 * Each combination of one shape, one placement per Instance and one
 * position per Instance becomes a tree: the shape's direction splits the
 * Chart into the placed parts in part order, a part with two or more
 * Instances splits the other direction in position order, and a
 * one-Instance part is a leaf. Placements win over the shape's part count:
 * a part nobody was placed in is dropped and a part past the count is
 * added, and both repairs are reported. A combination is ranked by the
 * geometric mean of the probabilities its tree depends on: the shape, every
 * placement, and the position of every Instance sharing its part; a tree
 * several combinations build keeps its best rank. Sizes are
 * not enumerated: every candidate weighs its splits by {@link sizeShares}.
 */
export function composeCandidates(
  answers: CompositionAnswers,
  limit = 3,
): readonly ComposedCandidate[] {
  const { instances } = answers;
  if (instances.length === 0) return [];
  const variables = [
    ranked(answers.shape, SHAPES),
    ...instances.map((instance) => ranked(instance.placement, PARTS)),
    ...instances.map((instance) =>
      ranked(instance.position, POSITIONS.slice(0, instances.length)),
    ),
  ];
  if (variables.some((options) => options.length === 0)) return [];
  const shares = sizeShares(instances.map((instance) => instance.size));
  const shareById = Object.fromEntries(
    instances.map((instance, index) => [instance.instanceId, shares[index]]),
  );
  const byTree = new Map<string, ComposedCandidate>();
  for (const picks of mostProbable(variables, COMBINATIONS_SEARCHED)) {
    const candidate = assemble(picks, instances, shareById);
    const key = JSON.stringify(candidate.tree);
    const known = byTree.get(key);
    if (
      known === undefined ||
      candidate.meanProbability > known.meanProbability
    )
      byTree.set(key, candidate);
  }
  return [...byTree.values()]
    .sort((a, b) => b.meanProbability - a.meanProbability)
    .slice(0, limit);
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

/** Largest error per share a ratio of small integers may have before a larger total is tried. */
const WEIGHT_TOLERANCE = 0.025;

/** The largest sum of integer weights one split is written with. */
const MAX_WEIGHT_TOTAL = 24;

/** How many combinations, most probable first, are assembled before distinct trees are ranked. */
const COMBINATIONS_SEARCHED = 64;

interface RankedOption {
  readonly option: string;
  readonly probability: number;
}

/** Options with positive probability, most probable first, ties in `options` order. */
function ranked(
  probabilities: OptionProbabilities,
  options: readonly string[],
): readonly RankedOption[] {
  return options
    .map((option) => ({ option, probability: probabilities[option] ?? 0 }))
    .filter(({ probability }) => probability > 0)
    .sort((a, b) => b.probability - a.probability);
}

/**
 * The `limit` combinations with the highest product of probabilities, one
 * option per variable, most probable first. Keeping only the best `limit`
 * partial products after each variable is exact, since every factor is
 * non-negative.
 */
function mostProbable(
  variables: readonly (readonly RankedOption[])[],
  limit: number,
): readonly (readonly RankedOption[])[] {
  let partial: { picks: RankedOption[]; product: number }[] = [
    { picks: [], product: 1 },
  ];
  for (const options of variables) {
    partial = partial
      .flatMap(({ picks, product }) =>
        options.slice(0, limit).map((option) => ({
          picks: [...picks, option],
          product: product * option.probability,
        })),
      )
      .sort((a, b) => b.product - a.product)
      .slice(0, limit);
  }
  return partial.map(({ picks }) => picks);
}

function assemble(
  picks: readonly RankedOption[],
  instances: readonly InstanceAnswers[],
  shareById: Readonly<Record<string, number | undefined>>,
): ComposedCandidate {
  const [shapePick, ...rest] = picks;
  const shape = shapePick?.option as Shape;
  const placementPicks = rest.slice(0, instances.length);
  const positionPicks = rest.slice(instances.length);
  const axis = shape.startsWith('side_by_side') ? 'V' : 'H';
  const inner = axis === 'V' ? 'H' : 'V';
  const partCount = Number(shape.at(-1));

  const members = new Map<
    number,
    { index: number; rank: number; probability: number }[]
  >();
  instances.forEach((_, index) => {
    const part = PARTS.indexOf(placementPicks[index]?.option as Part);
    const position = positionPicks[index];
    const list = members.get(part) ?? [];
    list.push({
      index,
      rank: POSITIONS.indexOf(position?.option as Position),
      probability: position?.probability ?? 0,
    });
    members.set(part, list);
  });
  const usedParts = [...members.keys()].sort((a, b) => a - b);
  const parts = usedParts.map((part) =>
    (members.get(part) ?? []).sort(
      (a, b) =>
        a.rank - b.rank || b.probability - a.probability || a.index - b.index,
    ),
  );

  const used = [shapePick, ...placementPicks];
  for (const part of parts)
    if (part.length > 1)
      for (const member of part) used.push(positionPicks[member.index]);
  const logSum = used.reduce(
    (sum, pick) => sum + Math.log(pick?.probability ?? 0),
    0,
  );

  const shareOf = (index: number) =>
    shareById[instances[index]?.instanceId ?? ''] ?? 0;
  const partTrees = parts.map((part) =>
    splitTree(
      inner,
      part.map(({ index }) => {
        const instance = instances[index];
        return instance ? [tilingLeafToken(instance.instanceId)] : [];
      }),
      weightsOf(part.map(({ index }) => shareOf(index))),
    ),
  );
  const partShares = parts.map((part) =>
    part.reduce((sum, { index }) => sum + shareOf(index), 0),
  );

  return {
    tree: splitTree(axis, partTrees, weightsOf(partShares)),
    meanProbability: Math.exp(logSum / used.length),
    shape,
    placements: Object.fromEntries(
      instances.map((instance, index) => [
        instance.instanceId,
        placementPicks[index]?.option as Part,
      ]),
    ),
    positions: Object.fromEntries(
      instances.map((instance, index) => [
        instance.instanceId,
        positionPicks[index]?.option as Position,
      ]),
    ),
    shares: Object.fromEntries(
      instances.map((instance, index) => [instance.instanceId, shareOf(index)]),
    ),
    droppedParts: PARTS.slice(0, partCount).filter(
      (_, part) => !members.has(part),
    ),
    addedParts: usedParts
      .filter((part) => part >= partCount)
      .map((part) => PARTS[part] as Part),
  };
}

function weightsOf(shares: readonly number[]): readonly number[] {
  return shares.length < 2 ? shares : integerWeights(shares);
}

function reduced(weights: readonly number[]): readonly number[] {
  const divisor = weights.reduce(gcd);
  return weights.map((weight) => weight / divisor);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
