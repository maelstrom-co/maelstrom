import { z } from 'zod';

import { type Brand, requireNonEmptyBrand } from './brand.js';

/**
 * Opaque identifier assigned by a realtime provider (OpenAI, Google, …) to a
 * single tool call, correlating that call with the tool result sent back for
 * it. Format is intentionally unspecified — Maelstrom treats it as an opaque
 * string minted by the provider, never by the client.
 */
export type ToolCallId = Brand<string, 'ToolCallId'>;

/**
 * Creates or brands a ToolCallId. Smart constructor — the identifier
 * `ToolCallId` refers to both the type (for type annotations) and the
 * factory (for runtime creation), exploiting TypeScript's separate
 * type/value namespaces.
 *
 * Unlike {@link SessionId}, a ToolCallId always comes from the provider (it
 * correlates an in-flight tool call with its result), so this constructor
 * never generates one — it only brands an existing string.
 *
 * @example
 * ```ts
 * const callId = ToolCallId(event.call_id); // brands a provider-assigned id
 * ```
 */
export const ToolCallId = (value: string): ToolCallId => {
  requireNonEmptyBrand(value, 'ToolCallId');
  return value as ToolCallId;
};

/**
 * Wire-format Zod parser for {@link ToolCallId}. Mirrors the
 * non-empty-string invariant enforced by {@link requireNonEmptyBrand}
 * (rejects `''`, `'   '`, `'\t'`, etc.) and carries the `ToolCallId`
 * brand on `z.infer` output so consumer schemas that reference it stay
 * branded end-to-end.
 */
export const ToolCallIdSchema = z
  .string()
  .min(1, 'ToolCallId must be a non-empty string')
  .refine((s) => s.trim().length > 0, {
    message: 'ToolCallId must not be whitespace-only',
  })
  .transform((s) => s as ToolCallId);
