import type { HistoryEntry } from './history-store.js';

export interface TruncationBudget<TMeta = unknown> {
  /** Budget for summed entry size. */
  readonly maxChars: number;
  /** Cost function. Returns a non-negative integer for each entry. */
  readonly estimate: (entry: HistoryEntry<TMeta>) => number;
}

export interface TruncationOptions<TMeta = unknown>
  extends TruncationBudget<TMeta> {
  /** Hard cap on entry count. Entries beyond this are dropped oldest-first. */
  readonly maxEntries: number;
  /** Independent budgets that every retained entry must satisfy. */
  readonly additionalBudgets?: readonly TruncationBudget<TMeta>[];
}

/**
 * Apply hybrid truncation: drop the oldest entries until both caps are
 * satisfied, with newest-first retention. Pure function — input is not
 * mutated.
 */
export function truncate<TMeta = unknown>(
  entries: readonly HistoryEntry<TMeta>[],
  options: TruncationOptions<TMeta>,
): HistoryEntry<TMeta>[] {
  const { maxEntries, maxChars, estimate } = options;
  const budgets = [
    { maxChars, estimate },
    ...(options.additionalBudgets ?? []),
  ];

  if (maxEntries <= 0 || budgets.some((budget) => budget.maxChars <= 0)) {
    return [];
  }

  // Walk newest-first, accumulating until we would exceed either cap. This
  // lets the most recent entry always win even when it alone exceeds the
  // char budget.
  const kept: HistoryEntry<TMeta>[] = [];
  const runningChars = budgets.map(() => 0);

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const candidate = entries[i];
    if (candidate === undefined) continue;

    if (kept.length >= maxEntries) break;

    // Defensively clamp each estimator. NaN and negatives must not disable a
    // retention cap, and the newest entry remains sticky even when oversized.
    const candidateChars = budgets.map((budget) => {
      const raw = budget.estimate(candidate);
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    });
    if (
      kept.length > 0 &&
      budgets.some(
        (budget, index) =>
          (runningChars[index] ?? 0) + (candidateChars[index] ?? 0) >
          budget.maxChars,
      )
    )
      break;

    kept.push(candidate);
    for (let index = 0; index < runningChars.length; index += 1) {
      runningChars[index] =
        (runningChars[index] ?? 0) + (candidateChars[index] ?? 0);
    }
  }

  return kept.reverse();
}
