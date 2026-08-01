import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';
import { ActionName } from './action-name.ts';
import {
  type AssistantInjectionMessage,
  type ChartRequestMessage,
  EngineMessageSchema,
} from './engine-message.ts';
import { MaelstromError } from './errors/index.ts';
import { InstanceId } from './instance.ts';
import { MessageId, MessageIdSchema } from './message.ts';
import type {
  ActionExecution,
  GridLayout,
  MaelstromResponse,
  TilingLayout,
} from './response.ts';
import { err, ok, type Result } from './result.ts';
import { GridLayoutSchema, TilingLayoutSchema } from './schemas.ts';
import { type SessionId, SessionIdSchema } from './session.ts';
import type { SessionHistoryEntry } from './session-history-entry.ts';
import { SessionHistoryEntryArraySchema } from './session-history-entry.ts';

// ---------------------------------------------------------------------------
// MaelstromResponse wire parser
//
// `MaelstromResponse` (the engine's output contract) ships only as a
// hand-written interface — the engine builds it programmatically and no
// schema validates it. The envelope module is the first wire boundary that
// carries it *inbound* (engine host → client), so the parser is defined here.
// It differs from the LLM-output schemas in `request.ts`: the parsed form
// carries the layout `type` discriminator and `params` as a decoded object
// (not the LLM's `paramsJson` string). A canonical home in `response.ts` /
// `schemas.ts` is a future concern — kept local so this phase touches one file.
// ---------------------------------------------------------------------------

const ActionExecutionParsedSchema = z.object({
  instanceId: z.string().min(1, 'instanceId is required').transform(InstanceId),
  action: z.string().min(1, 'action is required').transform(ActionName),
  params: z.record(z.string(), z.unknown()).optional(),
});

const GridLayoutParsedSchema = GridLayoutSchema.extend({
  type: z.literal('grid'),
});

const TilingLayoutParsedSchema = TilingLayoutSchema.extend({
  type: z.literal('tiling'),
});

const MaelstromLayoutSchema = z.discriminatedUnion('type', [
  GridLayoutParsedSchema,
  TilingLayoutParsedSchema,
]);

/**
 * Wire-format Zod parser for {@link MaelstromResponse}. Validates the engine's
 * decision output as it crosses back to the client: the discriminator, the
 * correlation `requestId`, the user-facing/debug text, the parsed execution
 * plan (`params` as an object, not a JSON string), and the layout — whose
 * `type` must be `'grid'` or `'tiling'` and whose shape must match that arm.
 */
const MaelstromResponseSchema = z.object({
  type: z.literal('maelstrom_response'),
  requestId: MessageIdSchema,
  userMessage: z.string(),
  rationale: z.string(),
  executionPlan: z.array(ActionExecutionParsedSchema),
  layout: MaelstromLayoutSchema,
});

// ---------------------------------------------------------------------------
// Client → engine-host envelopes
// ---------------------------------------------------------------------------

/**
 * A `client.history.get` request: asks the engine host to replay the recorded
 * {@link SessionHistoryEntry} list for a session so a resuming client can
 * rehydrate its chat. The host answers with a {@link HistoryResponseMessage}
 * correlated on `id`. Transport-only — it never reaches the LLM, which is why
 * it lives in the envelope module rather than alongside the `EngineMessage`
 * variants.
 */
export interface HistoryGetMessage {
  readonly type: 'client.history.get';
  readonly id: MessageId;
  readonly sessionId: SessionId;
}

/**
 * Smart constructor for {@link HistoryGetMessage}. Generates a fresh `id` via
 * `MessageId()` when omitted so callers usually pass only the session; the
 * generated id is what the correlated {@link HistoryResponseMessage} echoes in
 * its `requestId`.
 */
export const HistoryGetMessage = (args: {
  sessionId: SessionId;
  id?: MessageId;
}): HistoryGetMessage => ({
  type: 'client.history.get',
  id: args.id ?? MessageId(),
  sessionId: args.sessionId,
});

/**
 * Wire-format Zod parser for {@link HistoryGetMessage}. Validates the
 * discriminator and the branded `id` / `sessionId` (both rejected when empty
 * or whitespace-only).
 */
export const HistoryGetMessageSchema = z.object({
  type: z.literal('client.history.get'),
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
});

/**
 * Every message a client may send to an engine host over the duplex stream.
 *
 * Every {@link ChartRequestMessage} / {@link AssistantInjectionMessage} —
 * i.e. every `EngineMessage` — is a valid ClientEnvelope; the envelope module
 * adds the transport-only messages ({@link HistoryGetMessage}) that the LLM
 * never sees. Discriminated on `type`, so a host router can dispatch with a
 * single switch.
 */
export type ClientEnvelope =
  | ChartRequestMessage
  | AssistantInjectionMessage
  | HistoryGetMessage;

/**
 * Wire-format Zod parser for the {@link ClientEnvelope} union. Reuses
 * {@link EngineMessageSchema}'s members by reference and adds the transport
 * arms, so the `chart_request` / `assistant_message` contracts stay defined in
 * exactly one place.
 */
export const ClientEnvelopeSchema = z.discriminatedUnion('type', [
  ...EngineMessageSchema.options,
  HistoryGetMessageSchema,
]);

// ---------------------------------------------------------------------------
// Engine-host → client envelopes
// ---------------------------------------------------------------------------

/**
 * The engine host's answer to a `chart_request`: the LLM's decision output.
 * `requestId` echoes the originating message `id` for correlation; `sessionId`
 * is optional because a stateless host may not thread it back. The `response`
 * payload is a full {@link MaelstromResponse}.
 */
export interface MaelstromResponseMessage {
  readonly type: 'engine.maelstrom.response';
  readonly requestId: MessageId;
  readonly sessionId?: SessionId;
  readonly response: MaelstromResponse;
}

/**
 * Smart constructor for {@link MaelstromResponseMessage}. Omits `sessionId`
 * from the constructed object when not supplied so an absent optional never
 * survives as an explicit `undefined` across encode/decode.
 */
export const MaelstromResponseMessage = (args: {
  requestId: MessageId;
  response: MaelstromResponse;
  sessionId?: SessionId;
}): MaelstromResponseMessage => ({
  type: 'engine.maelstrom.response',
  requestId: args.requestId,
  ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
  response: args.response,
});

/**
 * Wire-format Zod parser for {@link MaelstromResponseMessage}. Validates the
 * discriminator, the branded `requestId`, the optional `sessionId`, and the
 * inner {@link MaelstromResponse} payload in one pass.
 */
export const MaelstromResponseMessageSchema = z.object({
  type: z.literal('engine.maelstrom.response'),
  requestId: MessageIdSchema,
  sessionId: SessionIdSchema.optional(),
  response: MaelstromResponseSchema,
});

/**
 * The engine host's answer to a {@link HistoryGetMessage}: the recorded
 * {@link SessionHistoryEntry} list for the requested session. `requestId`
 * echoes the request `id` for correlation.
 */
export interface HistoryResponseMessage {
  readonly type: 'engine.history.response';
  readonly requestId: MessageId;
  readonly entries: readonly SessionHistoryEntry[];
}

/**
 * Smart constructor for {@link HistoryResponseMessage}.
 */
export const HistoryResponseMessage = (args: {
  requestId: MessageId;
  entries: readonly SessionHistoryEntry[];
}): HistoryResponseMessage => ({
  type: 'engine.history.response',
  requestId: args.requestId,
  entries: args.entries,
});

/**
 * Wire-format Zod parser for {@link HistoryResponseMessage}. `entries` is
 * validated with {@link SessionHistoryEntryArraySchema} so a malformed replay
 * is rejected at the boundary rather than surfacing deep in a render tree.
 */
export const HistoryResponseMessageSchema = z.object({
  type: z.literal('engine.history.response'),
  requestId: MessageIdSchema,
  entries: SessionHistoryEntryArraySchema,
});

/**
 * A failure the engine host reports for a request (or for a stream-level fault
 * with no recoverable request).
 *
 * `requestId` is optional: a host may fail before it can recover a correlatable
 * id (e.g. the inbound frame was unparseable), in which case there is no
 * request to reject and the error is informational. `code` is reserved for a
 * machine-readable error kind — there is deliberately no closed taxonomy yet,
 * so consumers must treat an unknown `code` (or its absence) gracefully and
 * fall back to `error` for display.
 */
export interface EngineErrorMessage {
  readonly type: 'engine.error';
  readonly requestId?: MessageId;
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly code?: string;
}

/**
 * Smart constructor for {@link EngineErrorMessage}. Omits each optional field
 * (`requestId`, `sessionId`, `code`) when not supplied so absent optionals do
 * not survive as explicit `undefined` across encode/decode.
 */
export const EngineErrorMessage = (args: {
  error: string;
  requestId?: MessageId;
  sessionId?: SessionId;
  code?: string;
}): EngineErrorMessage => ({
  type: 'engine.error',
  ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
  ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
  error: args.error,
  ...(args.code !== undefined ? { code: args.code } : {}),
});

/**
 * Wire-format Zod parser for {@link EngineErrorMessage}. `requestId` /
 * `sessionId` / `code` are all optional; `error` is a required string.
 */
export const EngineErrorMessageSchema = z.object({
  type: z.literal('engine.error'),
  requestId: MessageIdSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  error: z.string(),
  code: z.string().optional(),
});

/**
 * Every message an engine host may send to a client over the duplex stream:
 * a decision {@link MaelstromResponseMessage}, a {@link HistoryResponseMessage},
 * or an {@link EngineErrorMessage}. Discriminated on `type`.
 */
export type ServerEnvelope =
  | MaelstromResponseMessage
  | HistoryResponseMessage
  | EngineErrorMessage;

/**
 * Wire-format Zod parser for the {@link ServerEnvelope} union, dispatching on
 * `type`.
 */
export const ServerEnvelopeSchema = z.discriminatedUnion('type', [
  MaelstromResponseMessageSchema,
  HistoryResponseMessageSchema,
  EngineErrorMessageSchema,
]);

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/** Discriminates the two ways an envelope decode can fail. */
export type EnvelopeErrorKind = 'invalid_json' | 'invalid_envelope';

/**
 * Error returned (never thrown) by {@link decodeClientEnvelope} /
 * {@link decodeServerEnvelope} when a frame cannot be turned into a typed
 * envelope. Extends {@link MaelstromError} so it is catchable alongside every
 * other Maelstrom failure; `kind` (mirrored onto the base `code`) lets callers
 * distinguish a transport-level JSON fault from a contract violation, and
 * `message` names the offending discriminator and the first schema issue.
 */
export class EnvelopeError extends MaelstromError {
  readonly kind: EnvelopeErrorKind;

  constructor(kind: EnvelopeErrorKind, message: string, cause?: unknown) {
    super(kind, message, cause);
    this.name = 'EnvelopeError';
    this.kind = kind;
  }
}

/**
 * Serializes any envelope to the wire string. The inverse of the `decode*`
 * functions; a plain JSON encode, isolated here so the contract has one
 * encode/decode pair callers can reach for.
 *
 * @example
 * ```ts
 * // connector side (client → engine host)
 * ws.send(encodeEnvelope(ChartRequestMessage({ sessionId, request })));
 * // host side (engine host → client)
 * ws.send(encodeEnvelope(EngineErrorMessage({ error: 'boom', requestId })));
 * ```
 */
export const encodeEnvelope = (env: ClientEnvelope | ServerEnvelope): string =>
  JSON.stringify(env);

const decodeJson = (text: string): Result<unknown, EnvelopeError> => {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (cause) {
    return err(
      new EnvelopeError(
        'invalid_json',
        `envelope JSON.parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      ),
    );
  }
};

// A string or binary frame is JSON first; a pre-parsed object validates
// directly. Buffer is a Uint8Array subclass, so the one check covers both
// binary shapes WS runtimes deliver.
const toValidatable = (raw: unknown): Result<unknown, EnvelopeError> => {
  if (typeof raw === 'string') return decodeJson(raw);
  if (raw instanceof Uint8Array)
    return decodeJson(new TextDecoder().decode(raw));
  return ok(raw);
};

const discriminatorOf = (value: unknown): string => {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const t = (value as { type: unknown }).type;
    return typeof t === 'string' ? t : String(t);
  }
  return '<missing>';
};

function decodeEnvelope<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  direction: string,
): Result<z.output<S>, EnvelopeError> {
  const validatable = toValidatable(raw);
  if (!validatable.ok) return validatable;

  const parsed = schema.safeParse(validatable.value);
  if (parsed.success) return ok(parsed.data);

  const issue = parsed.error.issues[0];
  const path = issue?.path.join('.');
  const where = path ? ` at "${path}"` : '';
  return err(
    new EnvelopeError(
      'invalid_envelope',
      `${direction}: invalid envelope (type="${discriminatorOf(validatable.value)}")${where}: ${issue?.message ?? 'schema validation failed'}`,
    ),
  );
}

/**
 * Decodes a client → engine-host frame into a typed {@link ClientEnvelope}.
 *
 * Accepts a JSON string, a `Uint8Array`/`Buffer`, or an already-parsed object.
 * Owns the two failure modes: a malformed JSON string yields an
 * `invalid_json` {@link EnvelopeError}; an unknown `type` or any schema
 * violation yields an `invalid_envelope` one whose message names the offending
 * discriminator and the first issue. Returns a {@link Result} — it never
 * throws — so a host message loop can branch without a try/catch.
 *
 * @example
 * ```ts
 * // engine-host message handler
 * const decoded = decodeClientEnvelope(rawFrame);
 * if (isErr(decoded)) { ws.send(encodeEnvelope(EngineErrorMessage({ error: decoded.error.message }))); return; }
 * switch (decoded.value.type) {
 *   case 'chart_request': ...; break;
 *   case 'client.history.get': ...; break;
 * }
 * ```
 */
export const decodeClientEnvelope = (
  raw: unknown,
): Result<ClientEnvelope, EnvelopeError> => {
  const decoded = decodeEnvelope(
    ClientEnvelopeSchema,
    raw,
    'decodeClientEnvelope',
  );
  return decoded.ok ? ok(decoded.value as ClientEnvelope) : decoded;
};

/**
 * Decodes an engine-host → client frame into a typed {@link ServerEnvelope}.
 *
 * Same input handling and failure semantics as {@link decodeClientEnvelope},
 * validated against the {@link ServerEnvelopeSchema} direction. Returns a
 * {@link Result}; never throws.
 *
 * @example
 * ```ts
 * // connector onmessage handler
 * const decoded = decodeServerEnvelope(event.data);
 * if (isErr(decoded)) { console.error(decoded.error.message); return; }
 * switch (decoded.value.type) {
 *   case 'engine.maelstrom.response': resolve(decoded.value.requestId, decoded.value.response); break;
 *   case 'engine.history.response': ...; break;
 *   case 'engine.error': reject(decoded.value.requestId, decoded.value.error); break;
 * }
 * ```
 */
export const decodeServerEnvelope = (
  raw: unknown,
): Result<ServerEnvelope, EnvelopeError> => {
  const decoded = decodeEnvelope(
    ServerEnvelopeSchema,
    raw,
    'decodeServerEnvelope',
  );
  return decoded.ok ? ok(decoded.value as ServerEnvelope) : decoded;
};

// ---------------------------------------------------------------------------
// Drift guards. `Mutable<T>` (from `./_drift-guards.js`) strips `readonly`
// because `z.infer` does not synthesize it, and short-circuits on primitives
// so branded ids don't expand into a string-prototype mapped type. The
// `EngineMessage` arms of `ClientEnvelope` are already guarded in
// `engine-message.ts`; guarded here are only the interfaces this module owns.
// ---------------------------------------------------------------------------

type _InferredMaelstromResponse = z.infer<typeof MaelstromResponseSchema>;
// Full-shape check including `layout`: like `ChartRequest` in `request.ts`, the
// tiling arm's `vesselId` / `variant` / instance ids are branded by the shared
// schema transforms, matching the hand-written interface end-to-end, so no
// per-field carve-out is needed.
const _mrFwd: _InferredMaelstromResponse extends Mutable<MaelstromResponse>
  ? true
  : false = true;
const _mrBwd: Mutable<MaelstromResponse> extends _InferredMaelstromResponse
  ? true
  : false = true;

type _InferredActionExecution = z.infer<typeof ActionExecutionParsedSchema>;
const _aeFwd: _InferredActionExecution extends Mutable<ActionExecution>
  ? true
  : false = true;
const _aeBwd: Mutable<ActionExecution> extends _InferredActionExecution
  ? true
  : false = true;

type _InferredGridLayout = z.infer<typeof GridLayoutParsedSchema>;
const _glFwd: _InferredGridLayout extends Mutable<GridLayout> ? true : false =
  true;
const _glBwd: Mutable<GridLayout> extends _InferredGridLayout ? true : false =
  true;

type _InferredTilingLayout = z.infer<typeof TilingLayoutParsedSchema>;
const _tlFwd: _InferredTilingLayout extends Mutable<TilingLayout>
  ? true
  : false = true;
const _tlBwd: Mutable<TilingLayout> extends _InferredTilingLayout
  ? true
  : false = true;

type _InferredHistoryGet = z.infer<typeof HistoryGetMessageSchema>;
const _hgFwd: _InferredHistoryGet extends Mutable<HistoryGetMessage>
  ? true
  : false = true;
const _hgBwd: Mutable<HistoryGetMessage> extends _InferredHistoryGet
  ? true
  : false = true;

type _InferredMaelstromResponseMessage = z.infer<
  typeof MaelstromResponseMessageSchema
>;
const _mrmFwd: _InferredMaelstromResponseMessage extends Mutable<MaelstromResponseMessage>
  ? true
  : false = true;
const _mrmBwd: Mutable<MaelstromResponseMessage> extends _InferredMaelstromResponseMessage
  ? true
  : false = true;

type _InferredHistoryResponseMessage = z.infer<
  typeof HistoryResponseMessageSchema
>;
const _hrmFwd: _InferredHistoryResponseMessage extends Mutable<HistoryResponseMessage>
  ? true
  : false = true;
const _hrmBwd: Mutable<HistoryResponseMessage> extends _InferredHistoryResponseMessage
  ? true
  : false = true;

type _InferredEngineErrorMessage = z.infer<typeof EngineErrorMessageSchema>;
const _eemFwd: _InferredEngineErrorMessage extends Mutable<EngineErrorMessage>
  ? true
  : false = true;
const _eemBwd: Mutable<EngineErrorMessage> extends _InferredEngineErrorMessage
  ? true
  : false = true;

void [
  _mrFwd,
  _mrBwd,
  _aeFwd,
  _aeBwd,
  _glFwd,
  _glBwd,
  _tlFwd,
  _tlBwd,
  _hgFwd,
  _hgBwd,
  _mrmFwd,
  _mrmBwd,
  _hrmFwd,
  _hrmBwd,
  _eemFwd,
  _eemBwd,
];
