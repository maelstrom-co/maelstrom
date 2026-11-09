import type { AgentRunMetrics, RunId } from '@maelstrom-co/protocol';
import {
  totalTokens,
  type ProviderCallRecord,
  type UsageLedger,
} from '@maelstrom-co/telemetry/usage-adapter';
import type { ChatMiddleware } from '@tanstack/ai';

import type { Logger } from '../logger.js';
import type {
  AgentRunBudgetLimit,
  AgentRunBudgets,
  AgentRunClock,
  AgentRunFinished,
  AgentRunGate,
} from './agent-run.js';
import {
  toModelToolPayload,
  validateToolResultEnvelope,
  type ToolCallResult,
} from './tool-executor.js';
import type { ToolRegistry, ToolRegistryEntry } from './tool-registry.js';

/** Summary of a tool call the policy refused before it ran. */
export const NOT_RUN_TOOL_SUMMARY = 'Not run';

/** Summary of a tool call that was running when the run ended. */
export const STOPPED_TOOL_SUMMARY = 'Stopped';

/**
 * Why an Agent Run ended, without the fields the caller adds when it builds
 * the {@link AgentRunFinished} event: `type`, `reply`, `metrics` and
 * `unreportedUsageCalls`.
 */
export type AgentRunEnding = WithoutFinishedEventFields<AgentRunFinished>;

/** Whether one tool call may run. A refusal carries the ending that stopped it. */
export type AgentRunToolCallAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly ending: AgentRunEnding };

/** Usage and cost counters of a run so far. */
export interface AgentRunPolicyMetrics {
  /** Counters for `finished.metrics`, with tokens as the known sums. */
  readonly metrics: AgentRunMetrics;
  /** Provider calls that reported no usage, so are missing from the token counters. */
  readonly unreportedUsageCalls: number;
}

/** Inputs of {@link createAgentRunPolicy}. */
export interface AgentRunPolicyOptions {
  /** The run the policy governs, named in diagnostics. */
  readonly runId: RunId;
  /** Caps for the run, already resolved. */
  readonly budgets: AgentRunBudgets;
  /** Time source for the elapsed budget and the deadline timer. */
  readonly clock: AgentRunClock;
  /** Receives the adapter bug warning. */
  readonly logger: Logger;
  /** Ledger of the run's provider calls, the only source of token counts. */
  readonly ledger: UsageLedger;
  /** The caller's cancel signal. Aborting it latches a `cancelled` ending. */
  readonly signal: AbortSignal;
  /** Optional pause awaited before each model turn. */
  readonly gate?: AgentRunGate;
}

/**
 * Budget, deadline, gate and terminal state of one Agent Run. It knows
 * nothing about `chat()`: {@link createAgentRunPolicyMiddleware} maps its
 * methods onto middleware hooks.
 */
export interface AgentRunPolicy {
  /**
   * The run's own controller. Pass it to `chat()`. The policy aborts it when
   * the caller's signal aborts, when the deadline passes and when it refuses
   * a model turn. The adapter wrapper must refuse to call the provider when
   * its request signal is already aborted, because aborting in `onConfig`
   * does not stop that turn's adapter call.
   */
  readonly abortController: AbortController;
  /** The first terminal cause latched, or `undefined` while the run goes on. */
  readonly ending: AgentRunEnding | undefined;
  /**
   * Admits the run before `chat()` is called. An aborted signal ends it
   * `cancelled` and any zero budget ends it `budget` with that limit. When
   * admitted, starts the run clock, listens to the caller's signal, arms the
   * deadline timer and returns `undefined`.
   */
  start(): AgentRunEnding | undefined;
  /**
   * Runs before each model turn. Refuses a turn past `maxTurns`, a passed
   * deadline and a spent or unknown token budget, then awaits the gate
   * raced against the signal and the deadline. Resolves `true` when the turn
   * may start and counts it, `false` after latching an ending and aborting
   * {@link abortController}.
   */
  beforeModelTurn(): Promise<boolean>;
  /**
   * Decides after a tool phase whether another model turn may start. When
   * the last turn requested no tools the run is completing, so nothing is
   * latched. Otherwise refuses when `maxTurns` turns are used, the deadline
   * passed or the token budget is spent or unknown.
   */
  shouldStartNextTurn(lastTurn: { readonly requestedTools: boolean }): boolean;
  /** Records that the current model turn requested `callId`, so the whole batch is reserved at once. */
  noteToolCallRequested(callId: string): void;
  /**
   * Runs before each tool call. Refuses when an ending is latched, the
   * deadline passed, the token budget is spent or unknown, or the call was
   * requested on the final allowed turn. On a turn's first call, reserves
   * the whole batch against `maxToolCalls` and refuses every call of a batch
   * that does not fit. Each refusal latches its ending.
   */
  beforeToolCall(callId: string): AgentRunToolCallAdmission;
  /**
   * Sink for `withUsage`: appends `call` to the ledger and warns through the
   * logger when a completed call reported no usage, which points at an
   * adapter that drops its provider's usage.
   */
  recordProviderCall(call: ProviderCallRecord): void;
  /** Latches `ending` when no ending is latched yet. Returns whether it won. */
  latch(ending: AgentRunEnding): boolean;
  /**
   * Counters for the `finished` event. Only `elapsedMs` freezes once
   * {@link finish} is called. The other counters reflect the state at the
   * time of the call.
   */
  metrics(): AgentRunPolicyMetrics;
  /** Cancels the deadline timer and stops listening to the caller's signal. */
  finish(): void;
}

/** A tool call the policy middleware refused, reported so the run can emit its result. */
export interface AgentRunPolicyRefusal {
  /** The refused call. */
  readonly callId: string;
  /** Name of the refused tool. */
  readonly name: string;
  /** The `Not run` result the model received. */
  readonly result: ToolCallResult;
  /** The latched ending behind the refusal. */
  readonly ending: AgentRunEnding;
}

/** Inputs of {@link createAgentRunPolicyMiddleware}. */
export interface AgentRunPolicyMiddlewareOptions {
  /** The run's tools, used to validate refusal results. */
  readonly registry: ToolRegistry;
  /** Called for each refused call, before the model receives its result. */
  readonly onToolCallRefused?: (refusal: AgentRunPolicyRefusal) => void;
}

/** Creates the policy for one Agent Run. Call {@link AgentRunPolicy.start} before `chat()`. */
export function createAgentRunPolicy(
  options: AgentRunPolicyOptions,
): AgentRunPolicy {
  const { runId, budgets, clock, logger, ledger, signal, gate } = options;
  const abortController = new AbortController();
  let ending: AgentRunEnding | undefined;
  let startedAt: number | undefined;
  let finishedAt: number | undefined;
  let cancelDeadline: (() => void) | undefined;
  let turnsStarted = 0;
  let toolCallsAdmitted = 0;
  let toolCallsReserved = 0;
  let reservedTurn = 0;
  let requestedThisTurn = new Set<string>();

  const latch = (next: AgentRunEnding): boolean => {
    if (ending !== undefined) return false;
    ending = next;
    return true;
  };

  const abortRun = (reason: unknown): void => {
    if (!abortController.signal.aborted) abortController.abort(reason);
  };

  const onCallerAbort = (): void => {
    latch({ reason: 'cancelled', cause: signal.reason });
    abortRun(signal.reason);
  };

  const elapsedOrTokenRefusal = (): AgentRunEnding | undefined => {
    if (
      startedAt !== undefined &&
      clock.now() - startedAt >= budgets.maxElapsedMs
    ) {
      return { reason: 'budget', limit: 'elapsed' };
    }
    if (!Number.isFinite(budgets.maxTokens)) return undefined;
    const total = totalTokens(ledger.snapshot());
    if (total === undefined) {
      return { reason: 'budget', limit: 'tokens', usageUnknown: true };
    }
    return total >= budgets.maxTokens
      ? { reason: 'budget', limit: 'tokens' }
      : undefined;
  };

  const refuseTurn = (refusal?: AgentRunEnding): false => {
    if (refusal !== undefined) latch(refusal);
    abortRun(new DOMException('Agent run stopped by its policy', 'AbortError'));
    return false;
  };

  const refuseToolCall = (
    refusal: AgentRunEnding,
  ): AgentRunToolCallAdmission => {
    latch(refusal);
    return { admitted: false, ending: ending ?? refusal };
  };

  const awaitGate = async (turnGate: AgentRunGate, turn: number) => {
    const runSignal = abortController.signal;
    if (runSignal.aborted) return;
    let onAbort = (): void => undefined;
    const interrupted = new Promise<void>((resolve) => {
      onAbort = () => resolve();
      runSignal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([
        new Promise<void>((resolve) => resolve(turnGate({ turn }))),
        interrupted,
      ]);
    } catch (error) {
      logger.error('Agent run gate failed', error, { runId, turn });
      latch({
        reason: 'error',
        code: 'gate_failed',
        error: 'The run could not continue.',
      });
    } finally {
      runSignal.removeEventListener('abort', onAbort);
    }
  };

  return {
    abortController,
    get ending() {
      return ending;
    },
    start() {
      if (signal.aborted) {
        latch({ reason: 'cancelled', cause: signal.reason });
        return ending;
      }
      const exhausted = zeroBudgetLimit(budgets);
      if (exhausted !== undefined) {
        latch({ reason: 'budget', limit: exhausted });
        return ending;
      }
      startedAt = clock.now();
      signal.addEventListener('abort', onCallerAbort, { once: true });
      if (Number.isFinite(budgets.maxElapsedMs)) {
        cancelDeadline = clock.scheduleTimeout(() => {
          latch({ reason: 'budget', limit: 'elapsed' });
          abortRun(
            new DOMException('Agent run deadline reached', 'TimeoutError'),
          );
        }, budgets.maxElapsedMs);
      }
      return undefined;
    },
    async beforeModelTurn() {
      if (ending !== undefined) return refuseTurn();
      const turn = turnsStarted + 1;
      const refusal =
        turn > budgets.maxTurns ? turnsExhausted() : elapsedOrTokenRefusal();
      if (refusal !== undefined) return refuseTurn(refusal);
      if (gate !== undefined) await awaitGate(gate, turn);
      if (ending !== undefined) return refuseTurn();
      turnsStarted = turn;
      requestedThisTurn = new Set();
      return true;
    },
    shouldStartNextTurn({ requestedTools }) {
      if (ending !== undefined) return false;
      if (!requestedTools) return true;
      const refusal =
        turnsStarted >= budgets.maxTurns
          ? turnsExhausted()
          : elapsedOrTokenRefusal();
      if (refusal === undefined) return true;
      latch(refusal);
      return false;
    },
    noteToolCallRequested(callId) {
      requestedThisTurn.add(callId);
    },
    beforeToolCall(callId) {
      if (ending !== undefined) return { admitted: false, ending };
      const refusal =
        elapsedOrTokenRefusal() ??
        (turnsStarted >= budgets.maxTurns ? turnsExhausted() : undefined);
      if (refusal !== undefined) return refuseToolCall(refusal);
      if (reservedTurn !== turnsStarted) {
        requestedThisTurn.add(callId);
        const batch = requestedThisTurn.size;
        if (toolCallsReserved + batch > budgets.maxToolCalls) {
          return refuseToolCall(toolCallsExhausted());
        }
        toolCallsReserved += batch;
        reservedTurn = turnsStarted;
      }
      if (toolCallsAdmitted >= toolCallsReserved) {
        return refuseToolCall(toolCallsExhausted());
      }
      toolCallsAdmitted += 1;
      return { admitted: true };
    },
    recordProviderCall(call) {
      ledger.record(call);
      if (call.completed && call.usage === undefined) {
        logger.warn(
          'Agent run provider call completed without reporting usage. The adapter likely drops provider usage.',
          { runId, role: call.role, model: call.model },
        );
      }
    },
    latch,
    metrics() {
      const snapshot = ledger.snapshot();
      const endedAt = finishedAt ?? clock.now();
      return {
        metrics: {
          turns: turnsStarted,
          toolCalls: toolCallsAdmitted,
          elapsedMs:
            startedAt === undefined
              ? 0
              : Math.max(0, Math.round(endedAt - startedAt)),
          inputTokens: snapshot.usage.inputTokens ?? 0,
          outputTokens: snapshot.usage.outputTokens ?? 0,
        },
        unreportedUsageCalls: snapshot.unreportedCalls,
      };
    },
    finish() {
      cancelDeadline?.();
      cancelDeadline = undefined;
      signal.removeEventListener('abort', onCallerAbort);
      if (startedAt !== undefined && finishedAt === undefined) {
        finishedAt = clock.now();
      }
    },
  };
}

/**
 * Adapts `policy` to TanStack AI `chat()` middleware. Install it first in
 * the middleware array, and pass `toolExecution: 'sequential'` so each
 * refusal happens before the next call starts.
 *
 * - `onConfig` at the `beforeModel` phase runs
 *   {@link AgentRunPolicy.beforeModelTurn} and aborts the chat on refusal.
 *   The `init` phase is ignored, so turn one is gated once.
 * - `onShouldContinue` runs {@link AgentRunPolicy.shouldStartNextTurn}, the
 *   hook that stops the loop without starting another adapter call.
 * - `onChunk` reports each `TOOL_CALL_START` for a tool in `registry` to
 *   {@link AgentRunPolicy.noteToolCallRequested}. `chat()` rejects an
 *   unknown tool before `onBeforeToolCall`, so it never takes a reservation.
 * - `onBeforeToolCall` runs {@link AgentRunPolicy.beforeToolCall} and turns
 *   a refusal into a `skip` whose result is the validated {@link notRunToolResult}.
 *   A tool missing from `registry` is left to `chat()`, which cannot run it.
 */
export function createAgentRunPolicyMiddleware(
  policy: AgentRunPolicy,
  options: AgentRunPolicyMiddlewareOptions,
): ChatMiddleware {
  return {
    name: 'maelstrom-agent-run-policy',
    onConfig: async (ctx) => {
      if (ctx.phase !== 'beforeModel') return undefined;
      if (!(await policy.beforeModelTurn())) {
        ctx.abort('Agent run stopped by its policy');
      }
      return undefined;
    },
    onShouldContinue: (_ctx, state) =>
      policy.shouldStartNextTurn({
        requestedTools: state.lastTurnToolCallCount > 0,
      }),
    onChunk: (_ctx, chunk) => {
      if (
        chunk.type === 'TOOL_CALL_START' &&
        options.registry.get(chunk.toolCallName) !== undefined
      ) {
        policy.noteToolCallRequested(chunk.toolCallId);
      }
      return undefined;
    },
    onBeforeToolCall: (_ctx, hookCtx) => {
      const admission = policy.beforeToolCall(hookCtx.toolCallId);
      if (admission.admitted) return undefined;
      const entry = options.registry.get(hookCtx.toolName);
      if (entry === undefined) return undefined;
      const result = notRunToolResult(entry);
      options.onToolCallRefused?.({
        callId: hookCtx.toolCallId,
        name: hookCtx.toolName,
        result,
        ending: admission.ending,
      });
      return { type: 'skip', result: toModelToolPayload(result) };
    },
  };
}

/** The result of a call refused before it ran, checked with {@link validateToolResultEnvelope}. */
export function notRunToolResult(entry: ToolRegistryEntry): ToolCallResult {
  return validatedCancellation(entry, NOT_RUN_TOOL_SUMMARY);
}

/** The result of a call that was running when the run ended, checked with {@link validateToolResultEnvelope}. */
export function stoppedToolResult(entry: ToolRegistryEntry): ToolCallResult {
  return validatedCancellation(entry, STOPPED_TOOL_SUMMARY);
}

type WithoutFinishedEventFields<Finished> = Finished extends unknown
  ? Omit<Finished, 'type' | 'reply' | 'metrics' | 'unreportedUsageCalls'>
  : never;

const ZERO_BUDGET_LIMITS: readonly (readonly [
  keyof AgentRunBudgets,
  AgentRunBudgetLimit,
])[] = [
  ['maxTurns', 'turns'],
  ['maxElapsedMs', 'elapsed'],
  ['maxTokens', 'tokens'],
  ['maxToolCalls', 'toolCalls'],
];

function zeroBudgetLimit(
  budgets: AgentRunBudgets,
): AgentRunBudgetLimit | undefined {
  return ZERO_BUDGET_LIMITS.find(([budget]) => budgets[budget] <= 0)?.[1];
}

function turnsExhausted(): AgentRunEnding {
  return { reason: 'budget', limit: 'turns' };
}

function toolCallsExhausted(): AgentRunEnding {
  return { reason: 'budget', limit: 'toolCalls' };
}

function validatedCancellation(
  entry: ToolRegistryEntry,
  summary: string,
): ToolCallResult {
  const validation = validateToolResultEnvelope(entry, {
    ok: false,
    code: 'cancelled',
    summary,
  });
  if (!validation.valid) {
    throw new Error(`Invalid refusal result: ${validation.reason}`);
  }
  return validation.result;
}
