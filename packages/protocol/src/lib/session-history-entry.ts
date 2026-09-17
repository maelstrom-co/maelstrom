import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';
import type { MessageId } from './message.ts';
import { MessageIdSchema } from './message.ts';
import type { SessionId } from './session.ts';
import { SessionIdSchema } from './session.ts';

/**
 * Wire-format projection of a single recorded history entry, returned by
 * `Engine.getHistory` and surfaced to clients through the connector and
 * orchestrator layers.
 *
 * Intentionally smaller than the engine's internal storage record: the
 * engine persists the full `ChartRequestMessage` (vessel definitions,
 * instances, prior layout) and `ChartResponseOutput` (execution plan, full
 * layout grid) to support cache replay and prompt assembly. Clients
 * resuming a conversation only need enough to render the chat — the user's
 * intent and the assistant's reply — so the wire DTO carries those
 * directly and lets the engine evolve its internal storage shape without
 * breaking the contract.
 *
 * `kind` discriminates a chart_request round-trip (`turn`) from a
 * developer-supplied assistant message (`injection`).
 *
 *  - `turn`: `userIntent` is the user-facing text the engine derived from
 *    the originating request's `user_intent` UpdateReasons. May be `''` when
 *    the turn carried no user-intent reasons (e.g. a layout-only update from
 *    a resize) — empty is a legal value with semantic meaning ("no user input
 *    on this turn"). `assistantMessage` is the assistant's reply.
 *  - `injection`: `content` is the injected assistant text verbatim.
 *
 * The exact derivation of `userIntent` is the engine's choice — the reference
 * engine concatenates every `user_intent` UpdateReason with a single-space
 * separator. Other engines may project differently; clients SHOULD treat the
 * field as opaque text suitable for direct rendering.
 *
 * `id`, `sessionId`, and `timestamp` come straight from the originating
 * envelope — `id` is the engine-input MessageId so callers can dedupe
 * against locally-known requests, and `timestamp` is the wall-clock the
 * client originally stamped (guaranteed finite by the wire schema).
 */
export type SessionHistoryEntry =
  | {
      readonly kind: 'turn';
      readonly id: MessageId;
      readonly sessionId: SessionId;
      readonly timestamp: number;
      readonly userIntent: string;
      /** Optional assistant prose; omitted for accepted text-free plans. */
      readonly assistantMessage?: string;
    }
  | {
      readonly kind: 'injection';
      readonly id: MessageId;
      readonly sessionId: SessionId;
      readonly timestamp: number;
      readonly content: string;
    };

// ---------------------------------------------------------------------------
// Wire-format Zod parsers
//
// Engine.getHistory returns these to clients via the connector layer; the
// connectors must safeParse the array on ingress so a malformed server
// response surfaces at the boundary rather than as a TypeError deep in the
// consumer's render tree. Mirrors the EngineMessage schema treatment.
// ---------------------------------------------------------------------------

const baseShape = {
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  timestamp: z
    .number()
    .refine(Number.isFinite, { message: 'timestamp must be a finite number' }),
};

const TurnEntrySchema = z
  .object({
    ...baseShape,
    kind: z.literal('turn'),
    userIntent: z.string(),
    assistantMessage: z
      .string()
      .optional()
      .transform((value) => (value?.trim().length ? value : undefined)),
  })
  .transform(({ assistantMessage, ...entry }) => ({
    ...entry,
    ...(assistantMessage !== undefined && { assistantMessage }),
  }));

const InjectionEntrySchema = z.object({
  ...baseShape,
  kind: z.literal('injection'),
  content: z.string(),
});

/**
 * Wire-format Zod parser for {@link SessionHistoryEntry}. Dispatches on
 * `kind` and validates the per-variant payload.
 *
 * Empty `userIntent` and `content` are allowed where their enclosing
 * contracts permit them. Missing or blank `assistantMessage` normalizes to
 * absence, so clients do not render a blank assistant bubble.
 */
export const SessionHistoryEntrySchema = z.discriminatedUnion('kind', [
  TurnEntrySchema,
  InjectionEntrySchema,
]);

/**
 * Wire-format Zod parser for an array of {@link SessionHistoryEntry}. The
 * shape returned by `Engine.getHistory` and the connector layer's `getHistory`
 * methods. Co-located with the singular schema so wire-shape definitions stay
 * in one place — connectors `safeParse` against this directly instead of
 * each declaring its own `z.array(SessionHistoryEntrySchema)`.
 */
export const SessionHistoryEntryArraySchema = z.array(
  SessionHistoryEntrySchema,
);

// ---------------------------------------------------------------------------
// Drift guards. `Mutable<T>` (from `./_drift-guards.js`) strips `readonly`
// because `z.infer` does not synthesize it, and short-circuits on primitives
// so branded ids don't expand into a string-prototype mapped type.
// ---------------------------------------------------------------------------

type _InferredSessionHistoryEntry = z.infer<typeof SessionHistoryEntrySchema>;
const _sheFwd: _InferredSessionHistoryEntry extends Mutable<SessionHistoryEntry>
  ? true
  : false = true;
const _sheBwd: Mutable<SessionHistoryEntry> extends _InferredSessionHistoryEntry
  ? true
  : false = true;

void [_sheFwd, _sheBwd];
