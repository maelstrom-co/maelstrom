import { nanoid } from 'nanoid';
import { z } from 'zod';

import { type Brand, requireNonEmptyBrand } from './brand.ts';

/**
 * Opaque identifier for messages sent to the engine.
 *
 * Every EngineMessage variant carries one. Used for:
 *  1. Correlation — EngineOutput echoes the input id, so callers can match
 *     responses to requests without external bookkeeping.
 *  2. Deduplication — HistoryManager skips duplicate entries when the same
 *     MessageId arrives twice in the same session for an assistant_message
 *     variant.
 *  3. Audit and trace — log lines and history entries are keyed by MessageId,
 *     enabling end-to-end request correlation.
 */
export type MessageId = Brand<string, 'MessageId'>;

/**
 * Creates or brands a MessageId. Smart constructor — same pattern as SessionId.
 *
 * - Called with no arguments: generates a new unique Nano ID (no prefix).
 * - Called with an existing string: brands it as a MessageId without
 *   changing its value. Use this when rehydrating from serialized data.
 *
 * @example
 * ```ts
 * const fresh = MessageId();          // new Nano ID
 * const echoed = MessageId(input.id); // brands an existing id
 * ```
 */
export const MessageId = (value?: string): MessageId => {
  if (value !== undefined) {
    requireNonEmptyBrand(value, 'MessageId');
  }
  return (value ?? nanoid()) as MessageId;
};

/**
 * Wire-format Zod parser for {@link MessageId}. Mirrors the
 * non-empty-string invariant enforced by {@link requireNonEmptyBrand}
 * (rejects `''`, `'   '`, `'\t'`, etc.) and carries the `MessageId`
 * brand on `z.infer` output so consumer schemas that reference it stay
 * branded end-to-end.
 */
export const MessageIdSchema = z
  .string()
  .min(1, 'MessageId must be a non-empty string')
  .refine((s) => s.trim().length > 0, {
    message: 'MessageId must not be whitespace-only',
  })
  .transform((s) => s as MessageId);
