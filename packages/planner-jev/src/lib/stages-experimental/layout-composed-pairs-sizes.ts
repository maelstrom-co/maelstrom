import type { InstanceId } from '@maelstrom-co/protocol';

/**
 * The fraction of its row or column each level of the within-part
 * fraction question stands for, smallest first: a quarter, a third,
 * half, two thirds, three quarters.
 */
export const FRACTION_LEVELS: readonly number[] = [
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  0.75,
];

/**
 * The smallest fraction of its part each member without a stated fraction
 * keeps (see {@link partFractionShares}).
 */
export const MIN_UNSTATED_FRACTION = 0.1;

/**
 * The area ratio, first Instance over second, each level of the size
 * comparison question stands for, smallest first. Powers of two, so the
 * levels are evenly spaced in log space.
 */
export const COMPARISON_RATIOS: readonly [
  number,
  number,
  number,
  number,
  number,
] = [0.25, 0.5, 1, 2, 4];

/** One size comparison as a log area ratio, `first` over `second`. */
export interface LogRatio {
  readonly first: InstanceId;
  readonly second: InstanceId;
  readonly logRatio: number;
}

/**
 * The value at a fractional `score` along `values`, one value per level:
 * linear between the two levels the score falls between, and the end
 * value for a score outside the levels.
 */
export function interpolateLevels(
  score: number,
  values: readonly number[],
): number {
  const last = values.length - 1;
  const position = Math.min(Math.max(score, 0), last);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, last);
  const low = values[lower] ?? 0;
  const high = values[upper] ?? low;
  return low + (high - low) * (position - lower);
}

/**
 * Shares of one part for its members in order, from each member's stated
 * fraction of the part, `undefined` where the request states none.
 * Unstated members split what the stated ones leave evenly, each keeping
 * at least {@link MIN_UNSTATED_FRACTION}: stated fractions adding up to
 * more than that allows are scaled down in proportion. When every member
 * states one, the fractions are read as weights and normalised to sum to 1.
 */
export function partFractionShares(
  fractions: readonly (number | undefined)[],
): readonly number[] {
  const unstated = fractions.filter((fraction) => fraction === undefined);
  const statedTotal = fractions.reduce<number>(
    (sum, fraction) => sum + (fraction ?? 0),
    0,
  );
  if (unstated.length === 0)
    return fractions.map((fraction) =>
      statedTotal > 0 ? (fraction ?? 0) / statedTotal : 1 / fractions.length,
    );
  const room = 1 - unstated.length * MIN_UNSTATED_FRACTION;
  const scale = statedTotal > room ? room / statedTotal : 1;
  const remainder = (1 - statedTotal * scale) / unstated.length;
  return fractions.map((fraction) =>
    fraction === undefined ? remainder : fraction * scale,
  );
}

/** The log area ratio a size comparison `score` stands for, interpolated in log space between {@link COMPARISON_RATIOS}. */
export function comparisonLogRatio(score: number): number {
  return interpolateLevels(score, COMPARISON_RATIOS.map(Math.log));
}

/**
 * Area shares of `ids` summing to 1 from log area ratios between pairs of
 * them: the log areas that fit every ratio best in least squares, with
 * mean zero, exponentiated and normalised. With every pair compared once
 * the least-squares log area of an Instance is the mean of its log ratios
 * against every Instance, itself included at zero; a pair left out counts
 * as about the same size.
 */
export function logAreaShares(
  ids: readonly InstanceId[],
  ratios: readonly LogRatio[],
): Readonly<Record<string, number>> {
  const sums = new Map<InstanceId, number>(ids.map((id) => [id, 0]));
  for (const { first, second, logRatio } of ratios) {
    if (!sums.has(first) || !sums.has(second) || first === second) continue;
    sums.set(first, (sums.get(first) ?? 0) + logRatio);
    sums.set(second, (sums.get(second) ?? 0) - logRatio);
  }
  const areas = ids.map((id) => Math.exp((sums.get(id) ?? 0) / ids.length));
  const total = areas.reduce((sum, area) => sum + area, 0);
  return Object.fromEntries(
    ids.map((id, index) => [id, (areas[index] ?? 0) / total]),
  );
}
