import { z } from 'zod';

import { ChangeIdSchema, RunIdSchema } from './agent-ids.ts';
import { MaelstromResponseSchema } from './maelstrom-response-schema.ts';
import { MessageIdSchema } from './message.ts';
import { type ChartRequest, ChartRequestSchema } from './request.ts';
import type { MaelstromResponse } from './response.ts';

/**
 * Version of the agent wire contract that every {@link AgentInput} and
 * {@link AgentEvent} carries in its `version` field. An integer, not semver.
 * A new optional field on a member keeps the version, because decoders strip
 * keys they do not know. A new union member or enum value is rejected by an
 * older decoder as `invalid_envelope`, so such a change bumps the version.
 * Decoders reject any other version value.
 */
export const AGENT_WIRE_VERSION = 1 as const;

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
  /** Whether the Action ran without error. */
  ok: z.boolean(),
  /** Human-readable failure description when the Action failed. */
  error: z.string().optional(),
});

/** Outcome of one Action from an Execution Plan. */
export type AgentActionOutcome = z.infer<typeof AgentActionOutcomeSchema>;

/**
 * Counters describing the cost of one Agent Run. All values are non-negative
 * integers.
 */
export const AgentRunMetricsSchema = z.object({
  /** Loop model turns taken. */
  turns: z.number().int().nonnegative(),
  /** Tool calls made across all turns. */
  toolCalls: z.number().int().nonnegative(),
  /** Wall-clock duration of the run in milliseconds. */
  elapsedMs: z.number().int().nonnegative(),
  /** Model input tokens consumed. */
  inputTokens: z.number().int().nonnegative(),
  /** Model output tokens produced. */
  outputTokens: z.number().int().nonnegative(),
});

/** Counters describing the cost of one Agent Run. */
export type AgentRunMetrics = z.infer<typeof AgentRunMetricsSchema>;

/**
 * A user utterance sent to the agent. `chart` is the same Chart snapshot a
 * chart request carries. `inputId` lets the Engine ignore duplicates and
 * correlate the `placeholder`, `accepted` and `error` events it causes.
 */
export const AgentUtteranceInputSchema = z.object({
  /** Member discriminator. */
  type: z.literal('utterance'),
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: z.literal(AGENT_WIRE_VERSION),
  /** Client-assigned id for deduplication and correlation. */
  inputId: MessageIdSchema,
  /** What the user said or typed. */
  text: z.string(),
  /** Current Chart state when the user spoke. */
  chart: chartSnapshotSchema(),
  /** Whether the text was typed or transcribed from voice. */
  source: AgentInputSourceSchema,
});

/** A user utterance sent to the agent. */
export type AgentUtteranceInput = z.infer<typeof AgentUtteranceInputSchema>;

/**
 * The browser's acknowledgement that it applied a UI change. Carries the
 * resulting Chart state and one outcome per Action. `actionOutcomes` is
 * positional: entry i describes Action i of the Execution Plan.
 */
export const AgentUiAppliedInputSchema = z.object({
  /** Member discriminator. */
  type: z.literal('ui_applied'),
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: z.literal(AGENT_WIRE_VERSION),
  /** Echoes the `changeId` of the applied `ui_change`. */
  changeId: ChangeIdSchema,
  /** Chart state after the change was applied. */
  chart: chartSnapshotSchema(),
  /**
   * One outcome per Action in the Execution Plan. Positional: entry i
   * describes Action i of the Execution Plan.
   */
  actionOutcomes: z.array(AgentActionOutcomeSchema),
});

/** The browser's acknowledgement that it applied a UI change. */
export type AgentUiAppliedInput = z.infer<typeof AgentUiAppliedInputSchema>;

/**
 * Every input a client may send to the Agent Session, discriminated on
 * `type`. Each member carries `version` equal to {@link AGENT_WIRE_VERSION}.
 */
export const AgentInputSchema = z.discriminatedUnion('type', [
  AgentUtteranceInputSchema,
  AgentUiAppliedInputSchema,
]);

/** Every input a client may send to the Agent Session. */
export type AgentInput = z.infer<typeof AgentInputSchema>;

/**
 * Immediate feedback for an input, sent before the Engine has decided how to
 * handle it. Clients render `text` until a later event replaces it.
 */
export const AgentPlaceholderEventSchema = z.object({
  /** Member discriminator. */
  type: z.literal('placeholder'),
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: z.literal(AGENT_WIRE_VERSION),
  /** The input this placeholder answers. */
  inputId: MessageIdSchema,
  /** Text to show while the input is being handled. */
  text: z.string(),
});

/** Immediate feedback for an input. */
export type AgentPlaceholderEvent = z.infer<typeof AgentPlaceholderEventSchema>;

/**
 * The Engine's decision about an input: how it is handled and, when a run
 * handles it, which one. A non-null `runId` is followed by exactly one
 * `finished` event for that run. `ui_only` and `noise` start no run, so no
 * `finished` follows them. `ack` is a short acknowledgement the client may
 * show or speak.
 */
export const AgentAcceptedEventSchema = z
  .object({
    /** Member discriminator. */
    type: z.literal('accepted'),
    /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
    version: z.literal(AGENT_WIRE_VERSION),
    /** The input that was accepted. */
    inputId: MessageIdSchema,
    /**
     * The Agent Run that handles the input, or `null` when the disposition
     * starts no run (`ui_only`, `noise`).
     */
    runId: RunIdSchema.nullable(),
    /** How the input is handled. */
    disposition: AgentDispositionSchema,
    /** Short acknowledgement text. */
    ack: z.string(),
  })
  .refine(
    (e) =>
      (e.runId === null) ===
      (e.disposition === 'ui_only' || e.disposition === 'noise'),
    {
      message: 'runId must be null exactly for ui_only and noise',
      path: ['runId'],
    },
  );

/** The Engine's decision about an input. */
export type AgentAcceptedEvent = z.infer<typeof AgentAcceptedEventSchema>;

/**
 * A streamed fragment of the loop model's text for one model turn. Clients
 * concatenate `delta` values sharing a `turnId` in arrival order.
 */
export const AgentMessageEventSchema = z.object({
  /** Member discriminator. */
  type: z.literal('message'),
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: z.literal(AGENT_WIRE_VERSION),
  /** The Agent Run producing the text. */
  runId: RunIdSchema,
  /** The model turn this fragment belongs to. */
  turnId: z.string().min(1),
  /** Next fragment of text. */
  delta: z.string(),
});

/** A streamed fragment of the loop model's text. */
export type AgentMessageEvent = z.infer<typeof AgentMessageEventSchema>;

/**
 * A UI change for the browser to apply: the layout first, then the Execution
 * Plan. The browser answers with a `ui_applied` input echoing `changeId`.
 */
export const AgentUiChangeEventSchema = z.object({
  /** Member discriminator. */
  type: z.literal('ui_change'),
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: z.literal(AGENT_WIRE_VERSION),
  /** The Agent Run that caused the change, or `null` outside any run. */
  runId: RunIdSchema.nullable(),
  /** Id the browser echoes when it acknowledges the change. */
  changeId: ChangeIdSchema,
  /**
   * The {@link MaelstromResponse} to apply: layout first, then the Execution
   * Plan.
   */
  response: maelstromResponseSchema(),
});

/** A UI change for the browser to apply. */
export type AgentUiChangeEvent = z.infer<typeof AgentUiChangeEventSchema>;

/**
 * The end of an Agent Run with its structured outcome. `ok` is determined by
 * `reason`, so consumers may branch on either. `reply` is the last turn's full
 * text for clients that do not assemble `message` deltas. `error` and `code`
 * carry the cause when the run did not end as intended.
 */
export const AgentFinishedEventSchema = z
  .object({
    /** Member discriminator. */
    type: z.literal('finished'),
    /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
    version: z.literal(AGENT_WIRE_VERSION),
    /** The Agent Run that ended. */
    runId: RunIdSchema,
    /**
     * `true` when the run ended as intended (`completed`, `waiting`), `false`
     * for `cancelled`, `budget` and `error`.
     */
    ok: z.boolean(),
    /** Why the run ended. */
    reason: AgentFinishReasonSchema,
    /**
     * Full text of the final reply, empty when the run ended before producing
     * one.
     */
    reply: z.string(),
    /** Cost counters for the run. */
    metrics: AgentRunMetricsSchema,
    /** Human-readable failure description when `ok` is `false`. */
    error: z.string().optional(),
    /**
     * Optional machine-readable failure kind with no closed taxonomy, same
     * meaning as on the `error` event.
     */
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
export type AgentFinishedEvent = z.infer<typeof AgentFinishedEventSchema>;

/**
 * A failure outside any Agent Run that the Engine detects after the frame
 * decoded, such as a `ui_applied` echoing an unknown `changeId`. A frame that
 * does not decode is reported by the `engine.error` frame instead, never by
 * this event. Failures inside a run are reported by `finished` with reason
 * `error`. `error` and `code` have the same meaning as on the `engine.error`
 * frame.
 */
export const AgentErrorEventSchema = z.object({
  /** Member discriminator. */
  type: z.literal('error'),
  /** Agent wire version, always {@link AGENT_WIRE_VERSION}. */
  version: z.literal(AGENT_WIRE_VERSION),
  /** The offending input, when there is one. */
  inputId: MessageIdSchema.optional(),
  /** Human-readable failure description. */
  error: z.string(),
  /** Optional machine-readable failure kind with no closed taxonomy. */
  code: z.string().optional(),
});

/** A failure outside any Agent Run. */
export type AgentErrorEvent = z.infer<typeof AgentErrorEventSchema>;

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
export type AgentEvent = z.infer<typeof AgentEventSchema>;

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
