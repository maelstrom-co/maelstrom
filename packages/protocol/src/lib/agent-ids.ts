import { z } from 'zod';

import { type Brand, requireNonEmptyBrand } from './brand.ts';

/**
 * Identifies one Agent Run: a single pass of the agent loop from the input
 * that starts it to its `finished` event. Every event a run emits carries it,
 * so a client can group streamed text, UI changes and the outcome by run.
 */
export type RunId = Brand<string, 'RunId'>;

/**
 * Brands an existing string as a {@link RunId}. Smart constructor: the
 * identifier names both the type and this factory. Run ids are minted by the
 * host that runs the loop, so this only brands and never generates.
 *
 * @throws Error when `value` is empty or whitespace-only.
 *
 * @example
 * ```ts
 * const runId = RunId(crypto.randomUUID());
 * ```
 */
export const RunId = (value: string): RunId => {
  requireNonEmptyBrand(value, 'RunId');
  return value as RunId;
};

/**
 * Wire-format Zod parser for {@link RunId}. Rejects empty and whitespace-only
 * strings like {@link RunId} does and carries the brand on its output.
 */
export const RunIdSchema = z
  .string()
  .min(1, 'RunId must be a non-empty string')
  .refine((s) => s.trim().length > 0, {
    message: 'RunId must not be whitespace-only',
  })
  .transform((s) => s as RunId);

/**
 * Identifies one call the agent loop makes and expects an answer to, such as
 * a question for the user or an approval request. Deliberately distinct from
 * {@link ToolCallId}: a realtime provider's tool call ids and agent loop call
 * ids are separate id spaces that can meet in one session.
 */
export type CallId = Brand<string, 'CallId'>;

/**
 * Brands an existing string as a {@link CallId}. Smart constructor: the
 * identifier names both the type and this factory. Call ids are minted by the
 * agent loop, so this only brands and never generates.
 *
 * @throws Error when `value` is empty or whitespace-only.
 *
 * @example
 * ```ts
 * const callId = CallId(crypto.randomUUID());
 * ```
 */
export const CallId = (value: string): CallId => {
  requireNonEmptyBrand(value, 'CallId');
  return value as CallId;
};

/**
 * Wire-format Zod parser for {@link CallId}. Rejects empty and
 * whitespace-only strings like {@link CallId} does and carries the brand on
 * its output.
 */
export const CallIdSchema = z
  .string()
  .min(1, 'CallId must be a non-empty string')
  .refine((s) => s.trim().length > 0, {
    message: 'CallId must not be whitespace-only',
  })
  .transform((s) => s as CallId);

/**
 * Identifies one UI change the Engine asks the browser to apply. The browser
 * echoes it in its `ui_applied` acknowledgement so the loop can pair the
 * applied Chart state with the change that produced it.
 */
export type ChangeId = Brand<string, 'ChangeId'>;

/**
 * Brands an existing string as a {@link ChangeId}. Smart constructor: the
 * identifier names both the type and this factory. Change ids are minted by
 * the host that emits the UI change, so this only brands and never generates.
 *
 * @throws Error when `value` is empty or whitespace-only.
 *
 * @example
 * ```ts
 * const changeId = ChangeId(crypto.randomUUID());
 * ```
 */
export const ChangeId = (value: string): ChangeId => {
  requireNonEmptyBrand(value, 'ChangeId');
  return value as ChangeId;
};

/**
 * Wire-format Zod parser for {@link ChangeId}. Rejects empty and
 * whitespace-only strings like {@link ChangeId} does and carries the brand on
 * its output.
 */
export const ChangeIdSchema = z
  .string()
  .min(1, 'ChangeId must be a non-empty string')
  .refine((s) => s.trim().length > 0, {
    message: 'ChangeId must not be whitespace-only',
  })
  .transform((s) => s as ChangeId);
