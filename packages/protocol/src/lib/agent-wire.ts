import { z } from 'zod';

import {
  type ChangeId,
  ChangeIdSchema,
  type RunId,
  RunIdSchema,
} from './agent-ids.ts';
import { MaelstromResponseSchema } from './maelstrom-response-schema.ts';
import { type MessageId, MessageIdSchema } from './message.ts';
import { type ChartRequest, ChartRequestSchema } from './request.ts';
import type { MaelstromResponse } from './response.ts';

/**
 * Version of the agent wire contract that every {@link AgentInput} and
 * {@link AgentEvent} carries in its `version` field. An integer, not semver.
 * A new optional field on a member keeps the version, because decoders strip
 * keys they do not know. A new union member or enum value is rejected by an
 * older decoder as `invalid_envelope`, so such a change bumps the version.
 * A changed run lifecycle also bumps the version.
 * Decoders reject any other version value.
 */
export const AGENT_WIRE_VERSION = 2 as const;

/** Where an utterance came from: typed text or transcribed voice. */
export const AgentInputSourceSchema = z.enum(['text', 'voice']);

/** Where an utterance came from: typed text or transcribed voice. */
export type AgentInputSource = z.infer<typeof AgentInputSourceSchema>;

/**
 * How the Engine decided to handle an accepted input: route it to the Planner
 * only (`ui_only`), start or continue the agent loop (`agent`), fold it into
 * the running goal (`amend`), queue it as a separate goal (`independent`),
 * treat it as the answer to an open question (`answer`), replace the running
 * goal (`supersede`), or ignore it (`noise`).
 */
export const AgentDispositionSchema = z.enum([
  'ui_only',
  'agent',
  'amend',
  'independent',
  'answer',
  'supersede',
  'noise',
]);

/** How the Engine decided to handle an accepted input. */
export type AgentDisposition = z.infer<typeof AgentDispositionSchema>;

/**
 * Why an Agent Run ended: it replied (`completed`), it is waiting on the
 * client (`waiting`), it was superseded (`cancelled`), it exhausted a budget
 * (`budget`), or it failed (`error`).
 */
export const AgentFinishReasonSchema = z.enum([
  'completed',
  'waiting',
  'cancelled',
  'budget',
  'error',
]);

/** Why an Agent Run ended. */
export type AgentFinishReason = z.infer<typeof AgentFinishReasonSchema>;

/**
 * Outcome of one Action from an Execution Plan, reported by the browser after
 * it applied a UI change. Outcomes are positional: entry i of
 * `ui_applied.actionOutcomes` describes Action i of the Execution Plan.
 * `error` describes the failure when `ok` is `false`.
 */
export const AgentActionOutcomeSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

/** Outcome of one Action from an Execution Plan. */
export interface AgentActionOutcome {
  /** Whether the Action ran without error. */
  ok: boolean;
  /** Human-readable failure description when the Action failed. */
  error?: string;
}

/**
 * Counters describing the cost of one Agent Run. All values are non-negative
 * integers.
 */
export const AgentRunMetricsSchema = z.object({
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

/** Counters describing the cost of one Agent Run. */
export interface AgentRunMetrics {
  /** Loop model turns taken. */
  turns: number;
  /** Tool calls made across all turns. */
  toolCalls: number;
  /** Wall-clock duration of the run in milliseconds. */
  elapsedMs: number;
  /** Model input tokens consumed. */
  inputTokens: number;
  /** Model output tokens produced. */
  outputTokens: number;
}

/**
 * A user utterance sent to the agent. `chart` is the same Chart snapshot a
 * chart request carries. `inputId` lets the Engine ignore duplicates and
 * correlate the `placeholder`, `accepted` and `error` events it causes.
 */
export const AgentUtteranceInputSchema = z.object({
  type: z.literal('utterance'),
  version: z.literal(AGENT_WIRE_VERSION),
  inputId: MessageIdSchema,
  text: z.string(),
  chart: chartSnapshotSchema(),
  source: AgentInputSourceSchema,
});

/** A user utterance sent to the agent. */
export interface AgentUtteranceInput {
  /** Member discriminator. */
  type: 'utterance';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** Client-assigned id for deduplication and correlation. */
  inputId: MessageId;
  /** What the user said or typed. */
  text: string;
  /** Current Chart state when the user spoke. */
  chart: ChartRequest;
  /** Whether the text was typed or transcribed from voice. */
  source: AgentInputSource;
}

/**
 * The browser's acknowledgement that it applied a UI change. Carries the
 * resulting Chart state and one outcome per Action. `actionOutcomes` is
 * positional: entry i describes Action i of the Execution Plan.
 */
export const AgentUiAppliedInputSchema = z.object({
  type: z.literal('ui_applied'),
  version: z.literal(AGENT_WIRE_VERSION),
  changeId: ChangeIdSchema,
  chart: chartSnapshotSchema(),
  actionOutcomes: z.array(AgentActionOutcomeSchema),
});

/** The browser's acknowledgement that it applied a UI change. */
export interface AgentUiAppliedInput {
  /** Member discriminator. */
  type: 'ui_applied';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** Echoes the `changeId` of the applied `ui_change`. */
  changeId: ChangeId;
  /** Chart state after the change was applied. */
  chart: ChartRequest;
  /**
   * One outcome per Action in the Execution Plan. Positional: entry i
   * describes Action i of the Execution Plan.
   */
  actionOutcomes: AgentActionOutcome[];
}

/**
 * Every input a client may send to the Agent Session, discriminated on
 * `type`. Each member carries `version` equal to {@link AGENT_WIRE_VERSION}.
 */
export const AgentInputSchema = z.discriminatedUnion('type', [
  AgentUtteranceInputSchema,
  AgentUiAppliedInputSchema,
]);

/** Every input a client may send to the Agent Session. */
export type AgentInput = AgentUtteranceInput | AgentUiAppliedInput;

/**
 * Immediate feedback for an input, sent before the Engine has decided how to
 * handle it. Clients render `text` until a later event replaces it.
 */
export const AgentPlaceholderEventSchema = z.object({
  type: z.literal('placeholder'),
  version: z.literal(AGENT_WIRE_VERSION),
  inputId: MessageIdSchema,
  text: z.string(),
});

/** Immediate feedback for an input. */
export interface AgentPlaceholderEvent {
  /** Member discriminator. */
  type: 'placeholder';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** The input this placeholder answers. */
  inputId: MessageId;
  /** Text to show while the input is being handled. */
  text: string;
}

/**
 * The Engine's decision about an input: how it is handled and, when a run
 * handles it, which one. A non-null `runId` is followed by exactly one
 * `finished` event for that run. `ui_only` starts a run without a model loop;
 * `noise` starts no run. `ack` is a short acknowledgement the client may
 * show or speak.
 */
export const AgentAcceptedEventSchema = z
  .object({
    type: z.literal('accepted'),
    version: z.literal(AGENT_WIRE_VERSION),
    inputId: MessageIdSchema,
    runId: RunIdSchema.nullable(),
    disposition: AgentDispositionSchema,
    ack: z.string(),
  })
  .refine((e) => (e.runId === null) === (e.disposition === 'noise'), {
    message: 'runId must be null exactly for noise',
    path: ['runId'],
  });

/** The Engine's decision about an input. */
export interface AgentAcceptedEvent {
  /** Member discriminator. */
  type: 'accepted';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** The input that was accepted. */
  inputId: MessageId;
  /**
   * The Agent Run that handles the input, or `null` when the disposition
   * starts no run (`noise`).
   */
  runId: RunId | null;
  /** How the input is handled. */
  disposition: AgentDisposition;
  /** Short acknowledgement text. */
  ack: string;
}

/**
 * A streamed fragment of the loop model's text for one model turn. Clients
 * concatenate `delta` values sharing a `turnId` in arrival order.
 */
export const AgentMessageEventSchema = z.object({
  type: z.literal('message'),
  version: z.literal(AGENT_WIRE_VERSION),
  runId: RunIdSchema,
  turnId: z.string().min(1),
  delta: z.string(),
});

/** A streamed fragment of the loop model's text. */
export interface AgentMessageEvent {
  /** Member discriminator. */
  type: 'message';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** The Agent Run producing the text. */
  runId: RunId;
  /** The model turn this fragment belongs to. */
  turnId: string;
  /** Next fragment of text. */
  delta: string;
}

/**
 * A UI change for the browser to apply: the layout first, then the Execution
 * Plan. The browser answers with a `ui_applied` input echoing `changeId`.
 */
export const AgentUiChangeEventSchema = z.object({
  type: z.literal('ui_change'),
  version: z.literal(AGENT_WIRE_VERSION),
  runId: RunIdSchema.nullable(),
  changeId: ChangeIdSchema,
  response: maelstromResponseSchema(),
});

/** A UI change for the browser to apply. */
export interface AgentUiChangeEvent {
  /** Member discriminator. */
  type: 'ui_change';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** The Agent Run that caused the change, or `null` outside any run. */
  runId: RunId | null;
  /** Id the browser echoes when it acknowledges the change. */
  changeId: ChangeId;
  /**
   * The {@link MaelstromResponse} to apply: layout first, then the Execution
   * Plan.
   */
  response: MaelstromResponse;
}

/**
 * The end of an Agent Run with its structured outcome. `ok` is determined by
 * `reason`, so consumers may branch on either. `reply` is the last turn's full
 * text for clients that do not assemble `message` deltas. `error` and `code`
 * carry the cause when the run did not end as intended.
 */
export const AgentFinishedEventSchema = z
  .object({
    type: z.literal('finished'),
    version: z.literal(AGENT_WIRE_VERSION),
    runId: RunIdSchema,
    ok: z.boolean(),
    reason: AgentFinishReasonSchema,
    reply: z.string(),
    metrics: AgentRunMetricsSchema,
    error: z.string().optional(),
    code: z.string().optional(),
  })
  .refine(
    (e) => e.ok === (e.reason === 'completed' || e.reason === 'waiting'),
    {
      message: 'ok must be true exactly for completed and waiting',
      path: ['ok'],
    },
  );

/** The end of an Agent Run with its structured outcome. */
export interface AgentFinishedEvent {
  /** Member discriminator. */
  type: 'finished';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** The Agent Run that ended. */
  runId: RunId;
  /**
   * `true` when the run ended as intended (`completed`, `waiting`), `false`
   * for `cancelled`, `budget` and `error`.
   */
  ok: boolean;
  /** Why the run ended. */
  reason: AgentFinishReason;
  /**
   * Full text of the final reply, empty when the run ended before producing
   * one.
   */
  reply: string;
  /** Cost counters for the run. */
  metrics: AgentRunMetrics;
  /** Human-readable failure description when `ok` is `false`. */
  error?: string;
  /**
   * Optional machine-readable failure kind with no closed taxonomy, same
   * meaning as on the `error` event.
   */
  code?: string;
}

/**
 * A failure outside any Agent Run that the Engine detects after the frame
 * decoded, such as a `ui_applied` echoing an unknown `changeId`. `inputId`
 * names the offending input and `changeId` the UI change a failed
 * `ui_applied` refers to. A frame that does not decode is reported by the
 * `engine.error` frame instead, never by this event. Failures inside a run are
 * reported by `finished` with reason `error`. `error` and `code` have the same
 * meaning as on the `engine.error` frame.
 */
export const AgentErrorEventSchema = z.object({
  type: z.literal('error'),
  version: z.literal(AGENT_WIRE_VERSION),
  inputId: MessageIdSchema.optional(),
  changeId: ChangeIdSchema.optional(),
  error: z.string(),
  code: z.string().optional(),
});

/** A failure outside any Agent Run. */
export interface AgentErrorEvent {
  /** Member discriminator. */
  type: 'error';
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: typeof AGENT_WIRE_VERSION;
  /** The offending input, when there is one. */
  inputId?: MessageId;
  /**
   * The UI change the failure belongs to. Set for failures of a `ui_applied`
   * input, such as an unknown or stale `changeId`, because that input carries
   * no `inputId`.
   */
  changeId?: ChangeId;
  /** Human-readable failure description. */
  error: string;
  /** Optional machine-readable failure kind with no closed taxonomy. */
  code?: string;
}

/**
 * Every event the Engine may send on the agent event stream, discriminated on
 * `type`. Each member carries `version` equal to {@link AGENT_WIRE_VERSION}.
 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  AgentPlaceholderEventSchema,
  AgentAcceptedEventSchema,
  AgentMessageEventSchema,
  AgentUiChangeEventSchema,
  AgentFinishedEventSchema,
  AgentErrorEventSchema,
]);

/** Every event the Engine may send on the agent event stream. */
export type AgentEvent =
  | AgentPlaceholderEvent
  | AgentAcceptedEvent
  | AgentMessageEvent
  | AgentUiChangeEvent
  | AgentFinishedEvent
  | AgentErrorEvent;

// The reused schemas infer mutable arrays, so values typed with the read-only
// `ChartRequest` / `MaelstromResponse` interfaces would not be assignable.
// Widening the declared output to the interface keeps validation unchanged;
// the drift guards in `request.ts` and `maelstrom-response-schema.ts` keep the
// shapes equal apart from `readonly`.
function chartSnapshotSchema(): z.ZodType<ChartRequest> {
  return ChartRequestSchema;
}

function maelstromResponseSchema(): z.ZodType<MaelstromResponse> {
  return MaelstromResponseSchema;
}

// ---------------------------------------------------------------------------
// Drift guards. The hand-written types match `z.infer` exactly, mutability
// included, so each pair is compared directly. `Mutable<T>` from
// `./_drift-guards.js` would strip `readonly` from the `ChartRequest` and
// `MaelstromResponse` payloads, which the schemas output as those read-only
// interfaces, and fail.
// ---------------------------------------------------------------------------

type _InferredAgentActionOutcome = z.infer<typeof AgentActionOutcomeSchema>;
const _actionOutcomeFwd: _InferredAgentActionOutcome extends AgentActionOutcome
  ? true
  : false = true;
const _actionOutcomeBwd: AgentActionOutcome extends _InferredAgentActionOutcome
  ? true
  : false = true;

type _InferredAgentRunMetrics = z.infer<typeof AgentRunMetricsSchema>;
const _runMetricsFwd: _InferredAgentRunMetrics extends AgentRunMetrics
  ? true
  : false = true;
const _runMetricsBwd: AgentRunMetrics extends _InferredAgentRunMetrics
  ? true
  : false = true;

type _InferredAgentUtteranceInput = z.infer<typeof AgentUtteranceInputSchema>;
const _utteranceInputFwd: _InferredAgentUtteranceInput extends AgentUtteranceInput
  ? true
  : false = true;
const _utteranceInputBwd: AgentUtteranceInput extends _InferredAgentUtteranceInput
  ? true
  : false = true;

type _InferredAgentUiAppliedInput = z.infer<typeof AgentUiAppliedInputSchema>;
const _uiAppliedInputFwd: _InferredAgentUiAppliedInput extends AgentUiAppliedInput
  ? true
  : false = true;
const _uiAppliedInputBwd: AgentUiAppliedInput extends _InferredAgentUiAppliedInput
  ? true
  : false = true;

type _InferredAgentInput = z.infer<typeof AgentInputSchema>;
const _inputFwd: _InferredAgentInput extends AgentInput ? true : false = true;
const _inputBwd: AgentInput extends _InferredAgentInput ? true : false = true;

type _InferredAgentPlaceholderEvent = z.infer<
  typeof AgentPlaceholderEventSchema
>;
const _placeholderEventFwd: _InferredAgentPlaceholderEvent extends AgentPlaceholderEvent
  ? true
  : false = true;
const _placeholderEventBwd: AgentPlaceholderEvent extends _InferredAgentPlaceholderEvent
  ? true
  : false = true;

type _InferredAgentAcceptedEvent = z.infer<typeof AgentAcceptedEventSchema>;
const _acceptedEventFwd: _InferredAgentAcceptedEvent extends AgentAcceptedEvent
  ? true
  : false = true;
const _acceptedEventBwd: AgentAcceptedEvent extends _InferredAgentAcceptedEvent
  ? true
  : false = true;

type _InferredAgentMessageEvent = z.infer<typeof AgentMessageEventSchema>;
const _messageEventFwd: _InferredAgentMessageEvent extends AgentMessageEvent
  ? true
  : false = true;
const _messageEventBwd: AgentMessageEvent extends _InferredAgentMessageEvent
  ? true
  : false = true;

type _InferredAgentUiChangeEvent = z.infer<typeof AgentUiChangeEventSchema>;
const _uiChangeEventFwd: _InferredAgentUiChangeEvent extends AgentUiChangeEvent
  ? true
  : false = true;
const _uiChangeEventBwd: AgentUiChangeEvent extends _InferredAgentUiChangeEvent
  ? true
  : false = true;

type _InferredAgentFinishedEvent = z.infer<typeof AgentFinishedEventSchema>;
const _finishedEventFwd: _InferredAgentFinishedEvent extends AgentFinishedEvent
  ? true
  : false = true;
const _finishedEventBwd: AgentFinishedEvent extends _InferredAgentFinishedEvent
  ? true
  : false = true;

type _InferredAgentErrorEvent = z.infer<typeof AgentErrorEventSchema>;
const _errorEventFwd: _InferredAgentErrorEvent extends AgentErrorEvent
  ? true
  : false = true;
const _errorEventBwd: AgentErrorEvent extends _InferredAgentErrorEvent
  ? true
  : false = true;

type _InferredAgentEvent = z.infer<typeof AgentEventSchema>;
const _eventFwd: _InferredAgentEvent extends AgentEvent ? true : false = true;
const _eventBwd: AgentEvent extends _InferredAgentEvent ? true : false = true;

void [
  _actionOutcomeFwd,
  _actionOutcomeBwd,
  _runMetricsFwd,
  _runMetricsBwd,
  _utteranceInputFwd,
  _utteranceInputBwd,
  _uiAppliedInputFwd,
  _uiAppliedInputBwd,
  _inputFwd,
  _inputBwd,
  _placeholderEventFwd,
  _placeholderEventBwd,
  _acceptedEventFwd,
  _acceptedEventBwd,
  _messageEventFwd,
  _messageEventBwd,
  _uiChangeEventFwd,
  _uiChangeEventBwd,
  _finishedEventFwd,
  _finishedEventBwd,
  _errorEventFwd,
  _errorEventBwd,
  _eventFwd,
  _eventBwd,
];
