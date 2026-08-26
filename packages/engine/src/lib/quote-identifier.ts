const MAX_IDENTIFIER_CODE_POINTS = 128;
const IDENTIFIER_TRUNCATION_SUFFIX = '…[truncated]';

/**
 * Sanitizes, code-point-bounds, and JSON-quotes one untrusted identifier.
 *
 * Model-authored text reaches two rendered surfaces — the retry prompt and the
 * operator log — and neither imposes a length or character ceiling of its own.
 * A control character, line separator or escape sequence in a model-chosen
 * identifier would otherwise let one entry forge lines around it, and an
 * identifier the model can make arbitrarily long would otherwise be rendered
 * whole.
 */
export function quoteIdentifier(identifier: string): string {
  const sanitized = identifier.replace(/[\p{Cc}\u2028\u2029]/gu, '\uFFFD');
  const codePoints = Array.from(sanitized);
  const bounded =
    codePoints.length <= MAX_IDENTIFIER_CODE_POINTS
      ? sanitized
      : `${codePoints.slice(0, MAX_IDENTIFIER_CODE_POINTS).join('')}${IDENTIFIER_TRUNCATION_SUFFIX}`;
  return JSON.stringify(bounded);
}
