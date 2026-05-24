import { z } from 'zod';

import { type Brand, requireNonEmptyBrand } from './brand.js';

/**
 * Opaque session identifier representing a conversation thread.
 * Format is intentionally unspecified — Maelstrom treats it as an opaque string.
 */
export type SessionId = Brand<string, 'SessionId'>;

/**
 * Creates or brands a SessionId. Smart constructor — the identifier
 * `SessionId` refers to both the type (for type annotations) and the factory
 * (for runtime creation), exploiting TypeScript's separate type/value namespaces.
 *
 * - Called with no arguments: generates a new unique session ID with a
 *   `session-` prefix for easy log grepping.
 * - Called with an existing string: brands it as a SessionId without changing
 *   its value. Use this when the developer brings their own ID (DB row ID,
 *   user ID, persisted localStorage value, etc.) or when rehydrating from
 *   serialized data.
 *
 * @example
 * ```ts
 * const fresh = SessionId();               // 'session-<uuid>'
 * const fromDb = SessionId(row.sessionId); // brands an existing id
 * ```
 */
export const SessionId = (value?: string): SessionId => {
  if (value !== undefined) {
    requireNonEmptyBrand(value, 'SessionId');
  }
  return (value ?? `session-${crypto.randomUUID()}`) as SessionId;
};

/**
 * Wire-format Zod parser for {@link SessionId}. Mirrors the
 * non-empty-string invariant enforced by {@link requireNonEmptyBrand}
 * (rejects `''`, `'   '`, `'\t'`, etc.) and carries the `SessionId`
 * brand on `z.infer` output so consumer schemas that reference it stay
 * branded end-to-end.
 */
export const SessionIdSchema = z
  .string()
  .min(1, 'SessionId must be a non-empty string')
  .refine((s) => s.trim().length > 0, {
    message: 'SessionId must not be whitespace-only',
  })
  .transform((s) => s as SessionId);
