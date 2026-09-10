/**
 * Run-level policy and arithmetic for the resize-replay eval.
 *
 * Separate from `eval-resize-replay.ts` because that file is a script: it
 * reads argv, demands a provider key and starts calling a model on import, so
 * nothing declared inside it can be exercised from a test.
 */

/**
 * Retries a trial allows past its first model call.
 *
 * Zero is load-bearing. A trial reads only the last attempt's execution plan
 * and only the newest "Response healed" line, so a retry that comes back clean
 * erases the earlier attempt's refused replay and the trial scores no replay
 * at all.
 */
export const TRIAL_MAX_RETRIES = 0;

/** The trial counters a run summary is computed from. */
export interface RunTally {
  readonly hits: number;
  readonly completed: number;
  readonly errors: number;
}

/**
 * The seeded-replay hit rate over the trials that produced a verdict.
 *
 * An errored trial can never reach `hits`, so counting it in the denominator
 * would report a rate no trial measured. A run left with nothing to divide by
 * reports `n/a`, because a printed number would read as a measurement.
 */
export function formatHitRate(tally: RunTally): string {
  const scored = tally.completed - tally.errors;
  if (scored <= 0) return 'n/a';
  return `${((tally.hits / scored) * 100).toFixed(1)}%`;
}
