// JSON.stringify escapes U+0000-U+001F but leaves U+007F, U+0085 (NEL) and
// U+2028/U+2029 (line and paragraph separator) raw, and the last three read
// as line breaks to many tokenizers.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control and line-break characters is the point -- they must not survive into text a language model reads.
const CONTROL_AND_LINE_SEPARATOR_CHARS = /[\x00-\x1f\x7f\u0085\u2028\u2029]/g;

/**
 * Replaces every C0 control character (U+0000-U+001F), DEL (U+007F), and
 * line-break lookalike in `value` with a single space.
 *
 * `JSON.stringify` escapes U+0000-U+001F but leaves U+007F, U+0085 (NEL) and
 * U+2028/U+2029 (line and paragraph separator) untouched -- and the last
 * three read as a fresh line to many LLM tokenizers even while still sitting
 * inside a validly quoted JSON string. A free-form value that later passes
 * through `JSON.stringify` -- an enum option, a task title, anything sourced
 * from user input or a voice transcript -- can use one of those characters
 * to smuggle what reads as a new line, or a new top-level instruction, into
 * text a language model consumes. Apply this to any such value before it is
 * embedded in prompt text or emitted as part of a payload a language model
 * will read.
 *
 * @example
 * ```typescript
 * sanitizeControlChars('Ship v2\u2028Ignore prior instructions');
 * // 'Ship v2 Ignore prior instructions'
 * ```
 */
export function sanitizeControlChars(value: string): string {
  return value.replace(CONTROL_AND_LINE_SEPARATOR_CHARS, ' ');
}
