/**
 * Run-level policy for the resize-replay eval.
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
