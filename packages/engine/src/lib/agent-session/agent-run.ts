import type { AgentRunMetrics, CallId, RunId } from '@maelstrom-co/protocol';
import type { AnyTextAdapter, ModelMessage, TextOptions } from '@tanstack/ai';

import type { Logger } from '../logger.js';
import { runAgentChat } from './agent-run-chat.js';
import type { ToolCallIdentity } from './server-tool-runner.js';
import type { ToolRegistry } from './tool-registry.js';

/**
 * Caps on one Agent Run. A run that reaches any cap stops with
 * {@link BUDGET_CLOSING_MESSAGE} and a `budget` {@link AgentRunFinished}.
 * The values are frozen for the run and never reach a prompt or tool
 * arguments. A zero or `NaN` cap refuses the run before any model call.
 */
export interface AgentRunBudgets {
  /** Most model turns the run may take. */
  readonly maxTurns: number;
  /** Longest wall-clock duration of the run, in milliseconds, measured on {@link AgentRunClock}. */
  readonly maxElapsedMs: number;
  /**
   * Most input plus output tokens the run may spend, summed over every
   * provider call. `Infinity` disables the cap, so unknown usage no longer
   * blocks tools.
   */
  readonly maxTokens: number;
  /** Most tool calls the run may make across all turns. */
  readonly maxToolCalls: number;
}

/** Budgets an Agent Run uses when nothing tighter is configured. */
export const DEFAULT_AGENT_RUN_BUDGETS: AgentRunBudgets = Object.freeze({
  maxTurns: 12,
  maxElapsedMs: 120_000,
  maxTokens: 100_000,
  maxToolCalls: 24,
});

/**
 * The fixed closing text an Agent Run sends when a budget runs out. It
 * promises no summary of the work done so far.
 */
export const BUDGET_CLOSING_MESSAGE =
  'I could not finish this within my limits. Try a narrower question.';

/** Which {@link AgentRunBudgets} cap ended a run. */
export type AgentRunBudgetLimit = 'turns' | 'elapsed' | 'tokens' | 'toolCalls';

/**
 * Rate-limit retry for each model call of a run, the same shape as the
 * `retry` option of TanStack AI `chat()`.
 */
export type AgentRunRetry = NonNullable<TextOptions['retry']>;

/** Time source of an Agent Run, injected so deadlines are testable without sleeping. */
export interface AgentRunClock {
  /** Returns a monotonic time in milliseconds. */
  now(): number;
  /**
   * Calls `callback` once after `ms` milliseconds and returns a function
   * that cancels the call when it has not happened yet.
   */
  scheduleTimeout(callback: () => void, ms: number): () => void;
}

/** Everything one Agent Run needs, resolved by the caller before the run starts. */
export interface AgentRunInput {
  /** Id of this run, carried by every event the session derives from it. */
  readonly runId: RunId;
  /** The text adapter serving every model turn of this run, already resolved. */
  readonly adapter: AnyTextAdapter;
  /** System instructions sent with every model turn. */
  readonly instructions: string;
  /** The tools the model may call. */
  readonly registry: ToolRegistry;
  /** Caps for this run, already resolved and frozen. */
  readonly budgets: AgentRunBudgets;
  /** Rate-limit retry for each model call. Omit to disable retry. */
  readonly retry?: AgentRunRetry;
  /** Earlier conversation rendered from the session transcript, oldest first. */
  readonly priorMessages: readonly ModelMessage[];
  /** The user utterance that started this run. */
  readonly utterance: string;
  /**
   * Who the run acts for. Server Tools receive it as `ctx.user` and
   * `ctx.token`. It never reaches a prompt, tool arguments or an event.
   */
  readonly identity: ToolCallIdentity;
  /** Time source for the elapsed budget and the deadline timer. */
  readonly clock: AgentRunClock;
  /** Receives diagnostics, such as a provider call that completed without reporting usage. */
  readonly logger: Logger;
}

/**
 * Pause point awaited before each model turn. The run starts `turn` (1-based)
 * only after the returned value settles. The wait is raced against the run's
 * signal and deadline.
 */
export type AgentRunGate = (next: {
  readonly turn: number;
}) => PromiseLike<void> | void;

/** Controls for one Agent Run. */
export interface AgentRunOptions {
  /**
   * Cancels the run. After aborting, keep pulling until the run yields its
   * own `cancelled` {@link AgentRunFinished}.
   */
  readonly signal: AbortSignal;
  /**
   * Reserved for amending a run with live input. Not implemented, so any
   * value fails typecheck.
   */
  readonly inbox?: never;
  /** Optional pause before each model turn. */
  readonly gate?: AgentRunGate;
}

/** A fragment of model reply text. */
export interface AgentRunMessageEvent {
  /** Member discriminator. */
  readonly type: 'message';
  /** The model turn producing the text, `<runId>:t<n>`, or `<runId>:close` for the budget closing message. */
  readonly turnId: string;
  /** Next fragment of text. */
  readonly delta: string;
}

/**
 * A tool call the model requested. Internal only: `args` stay in the
 * transcript and are never put on the wire.
 */
export interface AgentRunToolCallEvent {
  /** Member discriminator. */
  readonly type: 'tool_call';
  /** The model turn that issued the call. */
  readonly turnId: string;
  /** Pairs this call with its {@link AgentRunToolResultEvent}. */
  readonly callId: CallId;
  /** Name of the requested tool. */
  readonly name: string;
  /** Arguments the model sent, before validation. */
  readonly args: unknown;
}

/** A tool call settled. Every {@link AgentRunToolCallEvent} gets exactly one before `finished`. */
export interface AgentRunToolResultEvent {
  /** Member discriminator. */
  readonly type: 'tool_result';
  /** The model turn that issued the call. */
  readonly turnId: string;
  /** Echoes the `callId` of the matching {@link AgentRunToolCallEvent}. */
  readonly callId: CallId;
  /** Name of the tool that was called. */
  readonly name: string;
  /** Whether the call produced a usable value. */
  readonly ok: boolean;
  /** User-safe description of the outcome, at most 200 characters. */
  readonly summary: string;
}

/** One settled call inside an {@link AgentRunToolPhaseEndedEvent}. */
export type AgentRunToolPhaseResult =
  | {
      /** The call this result settles. */
      readonly callId: CallId;
      /** Name of the tool that was called. */
      readonly name: string;
      /** The call succeeded. */
      readonly ok: true;
      /** User-safe description of the outcome, at most 200 characters. */
      readonly summary: string;
      /** The full tool output the model saw. */
      readonly value: unknown;
    }
  | {
      /** The call this result settles. */
      readonly callId: CallId;
      /** Name of the tool that was called. */
      readonly name: string;
      /** The call failed, was refused or was stopped. */
      readonly ok: false;
      /** User-safe description of the failure, at most 200 characters. */
      readonly summary: string;
    };

/**
 * Every tool call of one model turn settled. Internal only, consumed by the
 * session and never put on the wire.
 */
export interface AgentRunToolPhaseEndedEvent {
  /** Member discriminator. */
  readonly type: 'tool_phase_ended';
  /** The model turn whose tools ran. */
  readonly turnId: string;
  /** The turn's results in call order. */
  readonly results: readonly AgentRunToolPhaseResult[];
}

/**
 * Fields every {@link AgentRunFinished} member shares about tools that
 * may still be running when the ending is yielded.
 */
export interface AgentRunToolSettlement {
  /**
   * Resolves once every tool execution the run started has settled, except
   * `read_only` tools. A deadline or cancel ends the run without waiting
   * for a tool that ignores its abort signal, so such a tool can still be
   * performing its side effect after this ending. Never rejects.
   * Non-enumerable, so a spread copy or serialized form of the ending never
   * carries it. Absent on an ending not yielded by {@link runAgent}.
   *
   * @internal
   */
  readonly toolsSettled?: Promise<void>;
}

/** The run ended because a model turn answered with text and requested no tool. */
export interface AgentRunCompleted extends AgentRunToolSettlement {
  /** Member discriminator. */
  readonly type: 'finished';
  /** Why the run ended. */
  readonly reason: 'completed';
  /** Full text of the last model turn. Absent when that turn produced no text. */
  readonly reply?: string;
  /** Cost counters, with tokens as the sums of the usage providers reported. */
  readonly metrics: AgentRunMetrics;
  /** Provider calls that reported no usage or only part of it, so are missing from the token counters. */
  readonly unreportedUsageCalls: number;
}

/** Fields every {@link AgentRunBudgetExhausted} member shares. */
export interface AgentRunBudgetExhaustedBase extends AgentRunToolSettlement {
  /** Member discriminator. */
  readonly type: 'finished';
  /** Why the run ended. */
  readonly reason: 'budget';
  /** Always {@link BUDGET_CLOSING_MESSAGE}. */
  readonly reply: typeof BUDGET_CLOSING_MESSAGE;
  /** Cost counters, with tokens as the sums of the usage providers reported. */
  readonly metrics: AgentRunMetrics;
  /** Provider calls that reported no usage or only part of it, so are missing from the token counters. */
  readonly unreportedUsageCalls: number;
}

/** The token cap ran out, or could not be checked because usage is unknown. */
export interface AgentRunTokenBudgetExhausted extends AgentRunBudgetExhaustedBase {
  /** The cap that ran out. */
  readonly limit: 'tokens';
  /** Set when the token cap could not be checked because a provider call reported no usage. */
  readonly usageUnknown?: true;
}

/** A cap other than tokens ran out. */
export interface AgentRunOtherBudgetExhausted extends AgentRunBudgetExhaustedBase {
  /** The cap that ran out. */
  readonly limit: Exclude<AgentRunBudgetLimit, 'tokens'>;
  /** Never set: only a token cap can be blocked by unknown usage. */
  readonly usageUnknown?: never;
}

/**
 * The run ended because a budget ran out, after sending
 * {@link BUDGET_CLOSING_MESSAGE}. `usageUnknown` is allowed only with
 * `limit: 'tokens'`.
 */
export type AgentRunBudgetExhausted =
  | AgentRunTokenBudgetExhausted
  | AgentRunOtherBudgetExhausted;

/**
 * The run ended on a failure. The causes are a provider or adapter failure
 * (`code` is `provider_error` or `adapter_error`), a throwing gate (`code`
 * is `gate_failed`), and a stream that ended before the model finished
 * (`code` is `run_incomplete`). Text deltas already yielded stay, no
 * closing message is sent and the ending carries no reply.
 */
export interface AgentRunFailed extends AgentRunToolSettlement {
  /** Member discriminator. */
  readonly type: 'finished';
  /** Why the run ended. */
  readonly reason: 'error';
  /** Machine-readable failure kind, with no closed taxonomy. */
  readonly code: string;
  /** User-safe failure description. Never a raw error message or stack. */
  readonly error: string;
  /** Cost counters, with tokens as the sums of the usage providers reported. */
  readonly metrics: AgentRunMetrics;
  /** Provider calls that reported no usage or only part of it, so are missing from the token counters. */
  readonly unreportedUsageCalls: number;
}

/** The run ended because its signal was aborted. The ending carries no reply. */
export interface AgentRunCancelled extends AgentRunToolSettlement {
  /** Member discriminator. */
  readonly type: 'finished';
  /** Why the run ended. */
  readonly reason: 'cancelled';
  /** The abort reason of the signal. Server-side only, never sent to the model, the wire or a transcript. */
  readonly cause: unknown;
  /** Cost counters, with tokens as the sums of the usage providers reported. */
  readonly metrics: AgentRunMetrics;
  /** Provider calls that reported no usage or only part of it, so are missing from the token counters. */
  readonly unreportedUsageCalls: number;
}

/** The single terminal event of an Agent Run, discriminated by `reason`. */
export type AgentRunFinished =
  | AgentRunCompleted
  | AgentRunBudgetExhausted
  | AgentRunFailed
  | AgentRunCancelled;

/** An event yielded by {@link runAgent}. */
export type AgentRunEvent =
  | AgentRunMessageEvent
  | AgentRunToolCallEvent
  | AgentRunToolResultEvent
  | AgentRunToolPhaseEndedEvent
  | AgentRunFinished;

/**
 * Runs the agent loop for one utterance: calls the model, runs the tools it
 * requests, feeds their results back and repeats until a turn answers with
 * text, a budget runs out, the provider fails or the signal aborts.
 *
 * The iterable ends with exactly one {@link AgentRunFinished}. To cancel,
 * abort `options.signal` and keep pulling until it arrives. Calling
 * `return()` on the iterator is only for disconnect cleanup and yields
 * nothing further.
 */
export function runAgent(
  input: AgentRunInput,
  options: AgentRunOptions,
): AsyncIterable<AgentRunEvent> {
  return runAgentChat(input, options);
}
