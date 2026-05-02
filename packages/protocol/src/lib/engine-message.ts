import { z } from 'zod';

import type { Mutable } from './_drift-guards.js';
import { MessageId, MessageIdSchema } from './message.js';
import type { ChartRequest } from './request.js';
import { ChartRequestSchema } from './request.js';
import type { SessionId } from './session.js';
import { SessionIdSchema } from './session.js';

const resolveTimestamp = (
  value: number | undefined,
  source: string,
): number => {
  if (value === undefined) {
    return Date.now();
  }
  // `HistoryManager.getHistory` / `getLLMContext` sort by this field — a
  // non-finite value (NaN, ±Infinity) would make the sort non-deterministic
  // and silently corrupt session ordering. Reject at construction so the
  // invariant is established before the envelope enters the engine.
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${source}: timestamp must be a finite number, got ${String(value)}`,
    );
  }
  return value;
};

/**
 * Common metadata carried on every message sent to the engine.
 *
 * Identifies which conversation the message belongs to (`sessionId`) and gives
 * every message a stable identifier (`id`) used for response correlation,
 * dedup (assistant_message variants), and audit.
 */
export interface EngineMessageBase {
  readonly sessionId: SessionId;
  readonly id: MessageId;
  /** Client-set milliseconds since epoch. Used for audit/trace, not logic. */
  readonly timestamp: number;
}

/**
 * A chart_request envelope: the LLM is asked to produce a layout + execution
 * plan given the current chart state and accumulated update reasons.
 */
export interface ChartRequestMessage extends EngineMessageBase {
  readonly type: 'chart_request';
  readonly request: ChartRequest;
}

/**
 * An assistant_message envelope: developer-injected content recorded into
 * session history so subsequent LLM turns have it in context. Does not call
 * the LLM itself.
 */
export interface AssistantInjectionMessage extends EngineMessageBase {
  readonly type: 'assistant_message';
  readonly content: string;
}

/**
 * Tagged union of every input the engine knows how to handle. Adding a new
 * message kind (audio intent, system notification, etc.) means adding a
 * variant here and a new branch in the engine's router.
 */
export type EngineMessage = ChartRequestMessage | AssistantInjectionMessage;

/**
 * Smart constructor for {@link ChartRequestMessage}. Fills in `id` and
 * `timestamp` with sensible defaults when omitted so callers only have to
 * supply the session + payload in the common case.
 */
export const ChartRequestMessage = (args: {
  sessionId: SessionId;
  request: ChartRequest;
  id?: MessageId;
  timestamp?: number;
}): ChartRequestMessage => ({
  type: 'chart_request',
  sessionId: args.sessionId,
  id: args.id ?? MessageId(),
  timestamp: resolveTimestamp(args.timestamp, 'ChartRequestMessage'),
  request: args.request,
});

/**
 * Smart constructor for {@link AssistantInjectionMessage}. Fills in `id` and
 * `timestamp` with sensible defaults when omitted.
 */
export const AssistantInjectionMessage = (args: {
  sessionId: SessionId;
  content: string;
  id?: MessageId;
  timestamp?: number;
}): AssistantInjectionMessage => ({
  type: 'assistant_message',
  sessionId: args.sessionId,
  id: args.id ?? MessageId(),
  timestamp: resolveTimestamp(args.timestamp, 'AssistantInjectionMessage'),
  content: args.content,
});

// ---------------------------------------------------------------------------
// Wire-format Zod parsers
//
// Smart constructors above enforce envelope invariants on programmatic
// construction (timestamp finite, brand non-empty). Wire-deserialized
// envelopes (JSON.parse → object) bypass those constructors entirely.
// These schemas are the wire-ingress equivalent: `safeParse` an envelope and
// the same NaN-timestamp / missing-field cases the constructors reject are
// rejected here too.
// ---------------------------------------------------------------------------

const envelopeBaseShape = {
  sessionId: SessionIdSchema,
  id: MessageIdSchema,
  timestamp: z
    .number()
    .refine(Number.isFinite, { message: 'timestamp must be a finite number' }),
};

/**
 * Wire-format Zod parser for {@link ChartRequestMessage} envelopes.
 * Validates the discriminator, all envelope-level fields (sessionId, id,
 * timestamp), and the inner ChartRequest payload in a single pass.
 */
export const ChartRequestMessageSchema = z.object({
  ...envelopeBaseShape,
  type: z.literal('chart_request'),
  request: ChartRequestSchema,
});

/**
 * Wire-format Zod parser for {@link AssistantInjectionMessage} envelopes.
 * Validates the discriminator, all envelope-level fields, and requires
 * `content` to be a non-empty string.
 */
export const AssistantInjectionMessageSchema = z.object({
  ...envelopeBaseShape,
  type: z.literal('assistant_message'),
  content: z.string().min(1, 'assistant_message content must be non-empty'),
});

/**
 * Wire-format Zod parser for the {@link EngineMessage} discriminated union.
 * Dispatches on the `type` field and delegates to the appropriate envelope
 * schema. Unknown discriminators are rejected with a Zod issue.
 */
export const EngineMessageSchema = z.discriminatedUnion('type', [
  ChartRequestMessageSchema,
  AssistantInjectionMessageSchema,
]);

// ---------------------------------------------------------------------------
// Drift guards. `Mutable<T>` (from `./_drift-guards.js`) strips `readonly`
// because `z.infer` does not synthesize it, and short-circuits on primitives
// so branded types like `SessionId` (`string & { [brand]: ... }`) don't
// explode into a string-prototype mapped type.
// ---------------------------------------------------------------------------

type _InferredChartRequestMessage = z.infer<typeof ChartRequestMessageSchema>;

// Forward guard for ChartRequestMessage is omitted: `request: ChartRequestSchema`
// re-introduces the same branded-InstanceId asymmetry as the inner
// `ChartRequestSchema`'s drift guard in `request.ts`.
// `_InferredChartRequestMessage.request` holds plain `string` for
// InstanceId-bearing fields, while `Mutable<ChartRequestMessage>.request` holds
// branded `InstanceId`, so `string extends InstanceId` is always false.
// Branded-ID schemas are MAE-133's scope. The backward direction passes
// because `InstanceId extends string`.
const _crmBwd: Mutable<ChartRequestMessage> extends _InferredChartRequestMessage
  ? true
  : false = true;

type _InferredAssistantInjectionMessage = z.infer<
  typeof AssistantInjectionMessageSchema
>;
// AssistantInjectionMessage carries no branded fields beyond sessionId and id,
// both of which use SessionIdSchema/MessageIdSchema whose .transform() produces
// the branded type — so both directions pass.
const _aimFwd: _InferredAssistantInjectionMessage extends Mutable<AssistantInjectionMessage>
  ? true
  : false = true;
const _aimBwd: Mutable<AssistantInjectionMessage> extends _InferredAssistantInjectionMessage
  ? true
  : false = true;

type _InferredEngineMessage = z.infer<typeof EngineMessageSchema>;

// Forward guard for EngineMessage is omitted for the same reason as
// ChartRequestMessage — the union includes ChartRequestMessageSchema which
// carries the unbranded InstanceId issue.
const _emBwd: Mutable<EngineMessage> extends _InferredEngineMessage
  ? true
  : false = true;

void [_crmBwd, _aimFwd, _aimBwd, _emBwd];
