import type { EngineMessage, Result } from '@maelstrom-co/protocol';
import { EngineMessageSchema, err, ok } from '@maelstrom-co/protocol';

import type { RequestValidationError } from '../errors.js';
import { requestValidationError } from '../errors.js';
import type { Logger } from '../logger.js';

// Strips unknown fields for forward-compat with newer clients — downstream
// code must use the `Ok` value, not the original input, to see only declared
// fields.
export function validateEngineMessage(
  input: unknown,
): Result<EngineMessage, RequestValidationError> {
  const parsed = EngineMessageSchema.safeParse(input);
  if (parsed.success) {
    // Deliberate unbranding gap pending MAE-133: `z.infer<EngineMessageSchema>`
    // uses plain `string` for `InstanceId`-bearing fields, so this is a
    // widening cast (inferred → declared), not a structural narrowing the
    // backward drift guard could prove safe. Brands are erased at runtime, so
    // the gap is type-system-only — but a malformed schema with an unbranded
    // `InstanceId` would today flow through to consumers without a runtime
    // brand-constructor running. Once MAE-133 brands the inner ID schemas,
    // drop this cast.
    return ok(parsed.data as EngineMessage);
  }
  return err(requestValidationError(parsed.error.issues));
}

/**
 * Type guard: is `input` an object with a string-typed `sessionId`?
 *
 * Defensive narrowing for unvalidated wire input — used by
 * {@link extractSessionIdCandidate} to extract a correlation key from a
 * malformed envelope before the validator rejects it. Never trust the
 * branded type here; the value might still be empty or whitespace-only.
 */
function hasStringSessionId(input: unknown): input is { sessionId: string } {
  return (
    input !== null &&
    typeof input === 'object' &&
    'sessionId' in input &&
    typeof (input as { sessionId: unknown }).sessionId === 'string'
  );
}

/**
 * Extracts a `sessionId` candidate from unvalidated wire input for log
 * correlation. Returns `undefined` if the input doesn't look like an
 * envelope — never throws.
 */
export function extractSessionIdCandidate(input: unknown): string | undefined {
  return hasStringSessionId(input) ? input.sessionId : undefined;
}

/**
 * Logs a wire-format validation failure at `warn` (caller-fault, not engine
 * fault). Emits structured fields a dashboard can group on (`layer`, `path`,
 * `issueCount`) plus enough context to debug a malformed-request flood
 * (`stack`, `sessionIdCandidate` if extractable from the raw input).
 *
 * See {@link RequestValidationError} for the `path` structure and the
 * dot-join caveat.
 */
export function logValidationFailure(
  logger: Logger,
  rawInput: unknown,
  error: RequestValidationError,
): void {
  const sessionIdCandidate = extractSessionIdCandidate(rawInput);
  logger.warn('EngineMessage validation failed', {
    layer: error.layer,
    path: error.path,
    issueCount: error.issues.length,
    errorMessage: error.message,
    stack: error.stack,
    ...(sessionIdCandidate !== undefined && { sessionIdCandidate }),
  });
}
