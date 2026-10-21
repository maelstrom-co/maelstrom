// The client's capability projection drops a parameter's options entirely
// past either cap, so the published list is trimmed to fit both.
import {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
} from '@maelstrom-co/client';
import type { UpdateVesselResult } from '@maelstrom-co/react';

export function cleanOptionValues(
  values: readonly string[],
  label: string,
): string[] {
  const safe = values.filter(
    (value) => value.trim().length > 0 && !UNSAFE_VALUE_CHARS.test(value),
  );
  if (safe.length < values.length) {
    console.warn(
      `[shop-option-publishing] ${label}: dropped ${values.length - safe.length} value(s) containing a blank or unsafe character`,
    );
  }

  let result = [...new Set(safe)];

  if (result.length > MAX_CAPABILITY_OPTION_COUNT) {
    console.warn(
      `[shop-option-publishing] ${label}: dropping ${result.length - MAX_CAPABILITY_OPTION_COUNT} of ${result.length} values to stay under the ${MAX_CAPABILITY_OPTION_COUNT}-option cap`,
    );
    result = result.slice(0, MAX_CAPABILITY_OPTION_COUNT);
  }

  const totalChars = result.reduce((sum, value) => sum + value.length, 0);
  if (totalChars > MAX_CAPABILITY_OPTIONS_TOTAL_CHARS) {
    // Stops at the first value that does not fit, so the published enum stays
    // a prefix of the order the user sees on screen.
    const fitted: string[] = [];
    let runningChars = 0;
    for (const value of result) {
      if (runningChars + value.length > MAX_CAPABILITY_OPTIONS_TOTAL_CHARS)
        break;
      fitted.push(value);
      runningChars += value.length;
    }
    console.warn(
      `[shop-option-publishing] ${label}: dropping ${result.length - fitted.length} of ${result.length} values to stay under the ${MAX_CAPABILITY_OPTIONS_TOTAL_CHARS}-character budget`,
    );
    result = fitted;
  }

  if (values.length > 0 && result.length === 0) {
    console.warn(
      `[shop-option-publishing] ${label}: no values survived cleaning, so the parameter keeps no enum and the engine will invent values`,
    );
  }

  return result;
}

// JSON keeps distinct lists distinct even when a value contains a delimiter
// a join() key would collide on.
export function optionKey(values: readonly string[]): string {
  return JSON.stringify(values);
}

/**
 * Publishes once and retries on a bounded backoff while the refusal is
 * `batch_in_flight`. Returns a cleanup that cancels any pending retry.
 */
export function republishWithRetry(
  publish: () => UpdateVesselResult,
): () => void {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const attempt = (retryCount: number) => {
    if (cancelled) return;
    const result = publish();
    if (result.ok) return;

    const { conflict } = result;
    if (conflict.code !== 'batch_in_flight') {
      console.warn(
        `[shop-option-publishing] ${conflict.vesselId}: republish refused (${conflict.code}), not retrying: ${conflict.message}`,
      );
      return;
    }

    if (retryCount >= MAX_BATCH_IN_FLIGHT_RETRIES) {
      console.warn(
        `[shop-option-publishing] ${conflict.vesselId}: gave up republishing after ${MAX_BATCH_IN_FLIGHT_RETRIES} retries while a command batch stayed in flight`,
      );
      return;
    }

    timeoutId = setTimeout(
      () => attempt(retryCount + 1),
      RETRY_BASE_DELAY_MS * 2 ** retryCount,
    );
  };

  attempt(0);

  return () => {
    cancelled = true;
    clearTimeout(timeoutId);
  };
}

// The engine serializer escapes these itself. Rejecting them here keeps a
// value with the prompt's option delimiter or a control character out of the
// enum regardless of how the engine renders it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point, a value containing one must be rejected.
const UNSAFE_VALUE_CHARS = /[|\r\n\x00-\x1f\x7f]/;

// A refusal with `batch_in_flight` is transient: the command batch that
// mutated the store is still settling. The sync also re-runs when
// `isProcessing` flips, which covers a batch that outlasts this backoff.
const MAX_BATCH_IN_FLIGHT_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 100;
