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
 * Unstated members split what the stated ones leave evenly, or in
 * proportion to `unstatedWeights` (one per member, such as whole-Chart
 * shares) when given and positive for some unstated member. Stated
 * fractions adding up to more than leaves {@link MIN_UNSTATED_FRACTION}
 * per unstated member are scaled down in proportion. When every member
 * states one, the fractions are read as weights and normalised to sum to 1.
 */
export function partFractionShares(
  fractions: readonly (number | undefined)[],
  unstatedWeights?: readonly number[],
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
  const remainder = 1 - statedTotal * scale;
  const weightOf = (index: number) => unstatedWeights?.[index] ?? 0;
  const unstatedWeight = fractions.reduce<number>(
    (sum, fraction, index) =>
      fraction === undefined ? sum + weightOf(index) : sum,
    0,
  );
  return fractions.map((fraction, index) => {
    if (fraction !== undefined) return fraction * scale;
    return unstatedWeight > 0
      ? (remainder * weightOf(index)) / unstatedWeight
      : remainder / unstated.length;
  });
}
