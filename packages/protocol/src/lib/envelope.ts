import { z } from 'zod';
import type { Mutable } from './_drift-guards.ts';
import {
  type AgentEvent,
  AgentEventSchema,
  type AgentInput,
  AgentInputSchema,
} from './agent-wire.ts';
import {
  type DiagnosticMessage,
  DiagnosticMessageSchema,
  type DiagnosticSubscription,
  DiagnosticSubscriptionSchema,
} from './diagnostics.ts';
import {
  AssistantInjectionMessage,
  AssistantInjectionMessageSchema,
  type ChartRequestMessage,
  EngineMessageSchema,
} from './engine-message.ts';
import { MaelstromError } from './errors/index.ts';
import { MaelstromResponseSchema } from './maelstrom-response-schema.ts';
import { MessageId, MessageIdSchema } from './message.ts';
import type { MaelstromResponse } from './response.ts';
import { err, ok, type Result } from './result.ts';
import { type SessionId, SessionIdSchema } from './session.ts';
import type { SessionHistoryEntry } from './session-history-entry.ts';
import { SessionHistoryEntryArraySchema } from './session-history-entry.ts';

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
 * An opt-in assistant-history injection that requests a correlated
 * {@link AssistantMessageResultMessage}. It carries the same payload and
 * validation invariants as the legacy `assistant_message` envelope, but its
 * distinct transport-only discriminator lets legacy injections remain
 * fire-and-forget.
 */
export interface AcknowledgedAssistantMessage
  extends Omit<AssistantInjectionMessage, 'type'> {
  /** Selects the opt-in, correlated assistant-injection wire path. */
  readonly type: 'client.assistant_message.acknowledged';
}

/**
 * Constructs an acknowledged assistant-history injection.
 *
 * Defaults `id` and `timestamp` exactly like {@link AssistantInjectionMessage},
 * then validates the complete wire value. Empty or whitespace-only ids and
 * session ids, empty content, and non-finite timestamps throw synchronously.
 * The host echoes the generated or supplied id in either the result or a
 * correlated error. Unlike the legacy constructor, this discriminator opts in
 * to that response.
 */
export const AcknowledgedAssistantMessage = (args: {
  /** Session whose history receives the assistant entry. */
  sessionId: SessionId;
  /** Non-empty assistant text persisted without invoking the LLM. */
  content: string;
  /** Correlation and deduplication id; generated when omitted. */
  id?: MessageId;
  /** Finite event time in milliseconds; defaults to `Date.now()`. */
  timestamp?: number;
}): AcknowledgedAssistantMessage =>
  AcknowledgedAssistantMessageSchema.parse({
    ...AssistantInjectionMessage(args),
    type: 'client.assistant_message.acknowledged',
  });

/**
 * Wire parser for {@link AcknowledgedAssistantMessage}. Reuses the legacy
 * assistant payload schema so both request forms enforce branded non-empty ids,
 * a finite timestamp, and non-empty content identically.
 */
export const AcknowledgedAssistantMessageSchema =
  AssistantInjectionMessageSchema.extend({
    type: z.literal('client.assistant_message.acknowledged'),
  });

/**
 * Wire-format Zod parser for {@link AgentInputMessage}. Validates the
 * discriminator, the branded `id` / `sessionId`, and the inner
 * {@link AgentInput}, including its `version`.
 */
export const AgentInputMessageSchema = z.object({
  type: z.literal('client.agent.input'),
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  input: AgentInputSchema,
});

/**
 * A `client.agent.input` frame: carries one {@link AgentInput} from a client
 * to the Agent Session of `sessionId`. The inner input keeps its own `type`
 * discriminator, which cannot collide with transport frame types.
 */
export interface AgentInputMessage {
  /** Frame discriminator. */
  type: 'client.agent.input';
  /**
   * Identifies this frame on the transport. Agent correlation uses the inner
   * `inputId` and `changeId` fields.
   */
  id: MessageId;
  /** Session whose Agent Session receives the input. */
  sessionId: SessionId;
  /** The agent input carried by this frame. */
  input: AgentInput;
}

/**
 * Smart constructor for {@link AgentInputMessage}. Generates a fresh `id` via
 * `MessageId()` when omitted.
 *
 * @example
 * ```ts
 * ws.send(encodeEnvelope(AgentInputMessage({ sessionId, input: utterance })));
 * ```
 */
export const AgentInputMessage = (args: {
  /** Session whose Agent Session receives the input. */
  sessionId: SessionId;
  /** The agent input to carry. */
  input: AgentInput;
  /** Frame id; generated when omitted. */
  id?: MessageId;
}): AgentInputMessage => ({
  type: 'client.agent.input',
  id: args.id ?? MessageId(),
  sessionId: args.sessionId,
  input: args.input,
});

/**
 * Every message a client may send to an engine host over the duplex stream.
 *
 * Every {@link ChartRequestMessage} / {@link AssistantInjectionMessage} —
 * i.e. every `EngineMessage` — is a valid ClientEnvelope; the envelope module
 * adds the transport-only {@link HistoryGetMessage},
 * {@link AcknowledgedAssistantMessage} and {@link DiagnosticSubscription},
 * which the LLM never sees, and the {@link AgentInputMessage} that feeds the
 * Agent Session. The legacy assistant arm remains fire-and-forget; only the
 * acknowledged arm requests a response. Discriminated on `type`, so a host
 * router can use one switch.
 */
export type ClientEnvelope =
  | ChartRequestMessage
  | AssistantInjectionMessage
  | AcknowledgedAssistantMessage
  | HistoryGetMessage
  | DiagnosticSubscription
  | AgentInputMessage;

/**
 * Wire-format Zod parser for the {@link ClientEnvelope} union. Reuses
 * {@link EngineMessageSchema}'s members by reference and adds the transport
 * arms, so the `chart_request` / `assistant_message` contracts stay defined in
 * exactly one place.
 */
export const ClientEnvelopeSchema = z.discriminatedUnion('type', [
  ...EngineMessageSchema.options,
  AcknowledgedAssistantMessageSchema,
  HistoryGetMessageSchema,
  DiagnosticSubscriptionSchema,
  AgentInputMessageSchema,
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
 * Engine acknowledgement that an assistant-message injection finished.
 *
 * `requestId` echoes the originating {@link AcknowledgedAssistantMessage} `id`
 * so clients can correlate the result to a waiter. Legacy
 * {@link AssistantInjectionMessage} requests remain fire-and-forget and do not
 * receive this frame. `outcome` is load-bearing: `'inserted'` means the engine
 * stored a new history entry; `'deduped'` means an entry with that id already
 * existed and nothing was appended. Greeting and other idempotent injectors
 * branch on that distinction before running side effects such as speech.
 */
export interface AssistantMessageResultMessage {
  /** Identifies the correlated assistant-injection result frame. */
  readonly type: 'engine.assistant_message.result';
  /** Echoes the acknowledged request id. */
  readonly requestId: MessageId;
  /** Echoes the session whose history was targeted. */
  readonly sessionId: SessionId;
  /** Whether history grew or already contained the request id. */
  readonly outcome: 'inserted' | 'deduped';
}

/**
 * Smart constructor for {@link AssistantMessageResultMessage}.
 *
 * `requestId` must be the acknowledged injection message id.
 * `outcome` is `'inserted'` when history grew and `'deduped'` when the engine
 * already held that id.
 */
export const AssistantMessageResultMessage = (args: {
  /** Id of the acknowledged request being answered. */
  requestId: MessageId;
  /** Session whose history was targeted. */
  sessionId: SessionId;
  /** Engine-reported insertion or deduplication result. */
  outcome: 'inserted' | 'deduped';
}): AssistantMessageResultMessage => ({
  type: 'engine.assistant_message.result',
  ...args,
});

/**
 * Wire-format Zod parser for {@link AssistantMessageResultMessage}.
 *
 * Validates the discriminator, branded `requestId` / `sessionId`, and the
 * closed `'inserted' | 'deduped'` outcome so consumers can trust correlation
 * and branching semantics at the decode boundary.
 */
export const AssistantMessageResultMessageSchema = z.object({
  type: z.literal('engine.assistant_message.result'),
  requestId: MessageIdSchema,
  sessionId: SessionIdSchema,
  outcome: z.union([z.literal('inserted'), z.literal('deduped')]),
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
 * Wire-format Zod parser for {@link AgentEventMessage}. Validates the
 * discriminator, the branded `id` / `sessionId`, and the inner
 * {@link AgentEvent}, including its `version`.
 */
export const AgentEventMessageSchema = z.object({
  type: z.literal('engine.agent.event'),
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  event: AgentEventSchema,
});

/**
 * An `engine.agent.event` frame: carries one {@link AgentEvent} from the Agent
 * Session of `sessionId` to its client. Events are streamed and correlate to
 * inputs through the inner event's `inputId` or `changeId`, not to a request,
 * so the frame carries its own `id` rather than a `requestId`.
 */
export interface AgentEventMessage {
  /** Frame discriminator. */
  type: 'engine.agent.event';
  /**
   * Identifies this frame on the transport. Agent correlation uses the inner
   * `inputId` and `changeId` fields.
   */
  id: MessageId;
  /** Session whose Agent Session emitted the event. */
  sessionId: SessionId;
  /** The agent event carried by this frame. */
  event: AgentEvent;
}

/**
 * Smart constructor for {@link AgentEventMessage}. Generates a fresh `id` via
 * `MessageId()` when omitted.
 *
 * @example
 * ```ts
 * ws.send(encodeEnvelope(AgentEventMessage({ sessionId, event: finished })));
 * ```
 */
export const AgentEventMessage = (args: {
  /** Session whose Agent Session emitted the event. */
  sessionId: SessionId;
  /** The agent event to carry. */
  event: AgentEvent;
  /** Frame id; generated when omitted. */
  id?: MessageId;
}): AgentEventMessage => ({
  type: 'engine.agent.event',
  id: args.id ?? MessageId(),
  sessionId: args.sessionId,
  event: args.event,
});

/**
 * Every message an engine host may send to a client over the duplex stream,
 * discriminated on `type`. See the union members below.
 */
export type ServerEnvelope =
  | MaelstromResponseMessage
  | HistoryResponseMessage
  | AssistantMessageResultMessage
  | EngineErrorMessage
  | DiagnosticMessage
  | AgentEventMessage;

/**
 * Wire-format Zod parser for the {@link ServerEnvelope} union, dispatching on
 * `type`.
 */
export const ServerEnvelopeSchema = z.discriminatedUnion('type', [
  MaelstromResponseMessageSchema,
  HistoryResponseMessageSchema,
  AssistantMessageResultMessageSchema,
  EngineErrorMessageSchema,
  DiagnosticMessageSchema,
  AgentEventMessageSchema,
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
// `engine-message.ts` and the `MaelstromResponse` payload in
// `maelstrom-response-schema.ts`; guarded here are only the interfaces this
// module owns.
// ---------------------------------------------------------------------------

type _InferredHistoryGet = z.infer<typeof HistoryGetMessageSchema>;
const _hgFwd: _InferredHistoryGet extends Mutable<HistoryGetMessage>
  ? true
  : false = true;
const _hgBwd: Mutable<HistoryGetMessage> extends _InferredHistoryGet
  ? true
  : false = true;

type _InferredAcknowledgedAssistantMessage = z.infer<
  typeof AcknowledgedAssistantMessageSchema
>;
const _aamFwd: _InferredAcknowledgedAssistantMessage extends Mutable<AcknowledgedAssistantMessage>
  ? true
  : false = true;
const _aamBwd: Mutable<AcknowledgedAssistantMessage> extends _InferredAcknowledgedAssistantMessage
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

// The agent frames match `z.infer` exactly, mutability included, so they are
// compared without `Mutable<T>`, which would fail on the read-only
// `ChartRequest` and `MaelstromResponse` payloads they carry.
type _InferredAgentInputMessage = z.infer<typeof AgentInputMessageSchema>;
const _agentInputMessageFwd: _InferredAgentInputMessage extends AgentInputMessage
  ? true
  : false = true;
const _agentInputMessageBwd: AgentInputMessage extends _InferredAgentInputMessage
  ? true
  : false = true;

type _InferredAgentEventMessage = z.infer<typeof AgentEventMessageSchema>;
const _agentEventMessageFwd: _InferredAgentEventMessage extends AgentEventMessage
  ? true
  : false = true;
const _agentEventMessageBwd: AgentEventMessage extends _InferredAgentEventMessage
  ? true
  : false = true;

void [
  _hgFwd,
  _hgBwd,
  _aamFwd,
  _aamBwd,
  _mrmFwd,
  _mrmBwd,
  _hrmFwd,
  _hrmBwd,
  _eemFwd,
  _eemBwd,
  _agentInputMessageFwd,
  _agentInputMessageBwd,
  _agentEventMessageFwd,
  _agentEventMessageBwd,
];
