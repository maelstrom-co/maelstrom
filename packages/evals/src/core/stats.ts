/** Nearest-rank percentile; `undefined` without samples. */
export function percentile(
  values: readonly number[],
  p: number,
): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** A count over a total. */
export interface Ratio {
  readonly count: number;
  readonly total: number;
}

/** How {@link ratio} prints a count over a total. */
export interface RatioFormat {
  /** Decimal places of the percentage. */
  readonly decimals: number;
  /** What a ratio with a total of 0 prints, since it has no percentage. */
  readonly whenEmpty: string;
}

/** The full planner report's format: one decimal, and `n/a` over no turns. */
export const PLANNER_RATIO: RatioFormat = { decimals: 1, whenEmpty: 'n/a' };

/** The stage report's format: a whole percentage, and `0/0` over no turns. */
export const STAGE_RATIO: RatioFormat = { decimals: 0, whenEmpty: '0/0' };

/**
 * `count/total (percent)`, the percentage rounded to `format.decimals`
 * places. A total of 0 prints `format.whenEmpty` whatever the count, since
 * 0/0 has no percentage.
 */
export function ratio({ count, total }: Ratio, format: RatioFormat): string {
  if (total === 0) return format.whenEmpty;
  return `${count}/${total} (${((count / total) * 100).toFixed(format.decimals)}%)`;
}
