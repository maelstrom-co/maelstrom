// The client's capability projection drops a parameter's options entirely
// past either of its caps, and the Vessel schema rejects a definition with
// more enum candidates than it accepts, so the published list fits all three.
import {
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_CAPABILITY_OPTIONS_TOTAL_CHARS,
} from '@maelstrom-co/client';
import { MAX_ACTION_PARAMETER_ENUM_CANDIDATES } from '@maelstrom-co/protocol';

const MAX_OPTION_COUNT = Math.min(
  MAX_CAPABILITY_OPTION_COUNT,
  MAX_ACTION_PARAMETER_ENUM_CANDIDATES,
);

export function cleanOptionValues(
  values: readonly string[],
  label: string,
): string[] {
  const safe = values.filter(
    (value) => value.trim().length > 0 && !UNSAFE_VALUE_CHARS.test(value),
  );
  if (safe.length < values.length) {
    console.warn(
      `[tasklane-option-publishing] ${label}: dropped ${values.length - safe.length} value(s) containing a blank or unsafe character`,
    );
  }

  let result = [...new Set(safe)];

  if (result.length > MAX_OPTION_COUNT) {
    console.warn(
      `[tasklane-option-publishing] ${label}: dropping ${result.length - MAX_OPTION_COUNT} of ${result.length} values to stay under the ${MAX_OPTION_COUNT}-option cap`,
    );
    result = result.slice(0, MAX_OPTION_COUNT);
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
      `[tasklane-option-publishing] ${label}: dropping ${result.length - fitted.length} of ${result.length} values to stay under the ${MAX_CAPABILITY_OPTIONS_TOTAL_CHARS}-character budget`,
    );
    result = fitted;
  }

  if (values.length > 0 && result.length === 0) {
    console.warn(
      `[tasklane-option-publishing] ${label}: no values survived cleaning, so the parameter keeps no enum and the engine will invent values`,
    );
  }

  return result;
}

// JSON keeps distinct lists distinct even when a value contains a delimiter
// a join() key would collide on.
export function optionKey(values: readonly string[]): string {
  return JSON.stringify(values);
}

// The engine serializer escapes these itself. Rejecting them here keeps a
// value with the prompt's option delimiter or a control character out of the
// enum regardless of how the engine renders it.
// oxlint-disable-next-line eslint/no-control-regex -- Control characters must be rejected from option values.
const UNSAFE_VALUE_CHARS = /[|\r\n\x00-\x1f\x7f]/;
