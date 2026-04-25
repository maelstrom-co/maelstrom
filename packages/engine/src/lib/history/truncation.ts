import type { HistoryEntry } from './history-store.js';

export interface TruncationOptions<TMeta = unknown> {
  /** Hard cap on entry count. Entries beyond this are dropped oldest-first. */
  readonly maxEntries: number;
  /**
   * Budget for summed entry size, measured by {@link estimate}. Used as a
   * token proxy — entries are dropped oldest-first until the sum fits,
   * except we always retain the newest entry even if it alone exceeds the
   * budget (losing the latest turn would break the user's session more
   * visibly than exceeding the cap would).
   */
  readonly maxChars: number;
  /** Cost function. Returns a non-negative integer for each entry. */
  readonly estimate: (entry: HistoryEntry<TMeta>) => number;
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

  if (maxEntries <= 0 || maxChars <= 0) {
    return [];
  }

  // Walk newest-first, accumulating until we would exceed either cap. This
  // lets the most recent entry always win even when it alone exceeds the
  // char budget.
  const kept: HistoryEntry<TMeta>[] = [];
  let runningChars = 0;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const candidate = entries[i];
    if (candidate === undefined) continue;

    if (kept.length >= maxEntries) break;

    // Defensively clamp the estimator's output. NaN propagates through the
    // budget comparison silently (NaN > maxChars is always false → we'd keep
    // every entry); a negative value would let the budget grow without bound.
    // Both are bugs in the supplied estimator, but the cost of treating them
    // as "0 chars" here is trivial vs. silently breaking the cap.
    const raw = estimate(candidate);
    const candidateChars =
      Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (kept.length > 0 && runningChars + candidateChars > maxChars) break;

    kept.push(candidate);
    runningChars += candidateChars;
  }

  return kept.reverse();
}
