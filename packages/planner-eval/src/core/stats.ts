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
