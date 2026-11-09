import { CallId, type RunId } from '@maelstrom-co/protocol';
import {
  createUsageLedger,
  type ProviderCallRecord,
  withUsage,
} from '@maelstrom-co/telemetry/usage-adapter';
import {
  type AnyTextAdapter,
  chat,
  type ChatMiddleware,
  type StreamChunk,
  type TextOptions,
  type Tool,
  toolDefinition,
} from '@tanstack/ai';

import { assertNever } from '../assert-never.js';
import {
  type AgentRunEnding,
  type AgentRunPolicy,
  type AgentRunPolicyMetrics,
  createAgentRunPolicy,
  createAgentRunPolicyMiddleware,
  NOT_RUN_TOOL_SUMMARY,
  STOPPED_TOOL_SUMMARY,
  stoppedToolResult,
} from './agent-run-policy.js';
import {
  type AgentRunEvent,
  type AgentRunInput,
  type AgentRunOptions,
  type AgentRunToolPhaseResult,
  BUDGET_CLOSING_MESSAGE,
} from './agent-run.js';
import {
  executeToolCall,
  toModelToolPayload,
  type ToolCallResult,
  validateToolResultEnvelope,
} from './tool-executor.js';
import type { ToolRegistryEntry } from './tool-registry.js';

/**
 * Observation points of {@link runAgentChat} beyond the Agent Run
 * interface, for characterizing `chat()` in tests and for diagnostics.
 */
export interface AgentRunChatInstrumentation {
  /**
   * Extra `chat()` middleware, installed after the run's own middleware and
   * before its result guard. A `skip` or `replaceResult` from it must be a
   * tool result envelope that passes {@link validateToolResultEnvelope},
   * otherwise the model receives a sanitized failure instead.
   */
  readonly middleware?: readonly ChatMiddleware[];
  /** Receives every provider call record after the run's ledger stored it. */
  readonly onProviderCall?: (call: ProviderCallRecord) => void;
}

/**
 * The Agent Run loop on TanStack AI `chat()`, behind `runAgent`. The
 * returned iterable pulls one `chat()` chunk only when its consumer pulls,
 * ends with exactly one `finished` event and yields nothing after it.
 * To stop early, callers abort `options.signal` first and then call
 * `return()` on the iterator, because a pending pull (a held gate or a
 * running tool) only ends when the signal aborts. `return()` then closes
 * the adapter stream.
 */
export function runAgentChat(
  input: AgentRunInput,
  options: AgentRunOptions,
  instrumentation: AgentRunChatInstrumentation = {},
): AsyncIterable<AgentRunEvent> {
  return streamAgentRun(input, options, instrumentation);
}

const RUN_ABORTED = Symbol('run aborted');

const MODEL_FAILURE_MESSAGE = 'The model could not respond.';

async function* streamAgentRun(
  input: AgentRunInput,
  options: AgentRunOptions,
  instrumentation: AgentRunChatInstrumentation,
): AsyncGenerator<AgentRunEvent, void, undefined> {
  const policy = createAgentRunPolicy({
    runId: input.runId,
    budgets: input.budgets,
    clock: input.clock,
    logger: input.logger,
    ledger: createUsageLedger(),
    signal: options.signal,
    gate: options.gate,
  });
  const calls = createToolCallTracker(input.runId);
  let chunks: AsyncIterator<StreamChunk> | undefined;
  let reachedEnd = false;
  try {
    if (policy.start() === undefined) {
      chunks = startChat(input, policy, calls, instrumentation)[
        Symbol.asyncIterator
      ]();
      const runAborted = abortedPromise(policy.abortController.signal);
      let lastFinishReason: string | null | undefined;
      for (;;) {
        const pull = chunks.next();
        let step: IteratorResult<StreamChunk> | typeof RUN_ABORTED;
        try {
          step = await Promise.race([pull, runAborted]);
        } catch (error) {
          input.logger.error('Agent run model call failed', error, {
            runId: input.runId,
          });
          policy.latch({
            reason: 'error',
            code: 'adapter_error',
            error: MODEL_FAILURE_MESSAGE,
          });
          chunks = undefined;
          break;
        }
        yield* calls.drainQueued();
        if (step === RUN_ABORTED) {
          // A pending pull can wait on a tool that ignores the abort, so the
          // run ends without waiting for chat() to settle.
          pull.catch(() => undefined);
          chunks.return?.().catch(() => undefined);
          chunks = undefined;
          break;
        }
        if (step.done === true) {
          chunks = undefined;
          break;
        }
        const chunk = step.value;
        if (chunk.type === 'RUN_FINISHED') {
          lastFinishReason =
            chunk.finishReason ?? chunk.metadata?.tanstack?.finishReason;
        }
        if (chunk.type === 'RUN_ERROR') {
          input.logger.error(
            'Agent run model call failed',
            chunk.error ?? chunk.message,
            { runId: input.runId },
          );
          policy.latch({
            reason: 'error',
            code: 'provider_error',
            error: MODEL_FAILURE_MESSAGE,
          });
          // Pulling on lets chat() close the adapter stream, which writes
          // the failed call's usage record before metrics are read.
          continue;
        }
        yield* calls.mapChunk(chunk);
      }
      if (
        policy.ending === undefined &&
        (lastFinishReason === 'length' || lastFinishReason === 'content_filter')
      ) {
        input.logger.warn('Agent run final turn was cut off', {
          runId: input.runId,
          finishReason: lastFinishReason,
        });
      }
      if (policy.ending === undefined) {
        policy.latch(
          lastFinishReason !== undefined && lastFinishReason !== 'tool_calls'
            ? { reason: 'completed' }
            : {
                reason: 'error',
                code: 'run_incomplete',
                error: 'The run ended unexpectedly.',
              },
        );
      }
    }
    policy.finish();
    reachedEnd = true;
    yield* calls.closeQueue();
    yield* endingEvents(
      input.runId,
      policy.ending ?? { reason: 'cancelled', cause: undefined },
      policy.metrics(),
      calls.lastTurnText(),
    );
  } finally {
    if (!reachedEnd && !policy.abortController.signal.aborted) {
      policy.abortController.abort(
        new DOMException('Agent run closed by its consumer', 'AbortError'),
      );
    }
    policy.finish();
    await chunks?.return?.().catch(() => undefined);
  }
}

function startChat(
  input: AgentRunInput,
  policy: AgentRunPolicy,
  calls: ToolCallTracker,
  instrumentation: AgentRunChatInstrumentation,
): AsyncIterable<StreamChunk> {
  const adapter = refusingAbortedCalls(
    withUsage(input.adapter, 'agent', (call) => {
      policy.recordProviderCall(call);
      instrumentation.onProviderCall?.(call);
    }),
  );
  const policyMiddleware = createAgentRunPolicyMiddleware(policy, {
    registry: input.registry,
    onToolCallRefused: (refusal) => {
      calls.settle(refusal.callId, refusal.result);
    },
  });
  const rawArgsByCall = new Map<string, unknown>();
  const runEventsMiddleware: ChatMiddleware = {
    name: 'maelstrom-agent-run-events',
    onConfig: (ctx) => {
      if (ctx.phase === 'beforeModel') calls.startTurn(ctx.iteration + 1);
      return undefined;
    },
    onBeforeToolCall: async (ctx, hookCtx) => {
      const entry = input.registry.get(hookCtx.toolName);
      if (entry === undefined) return undefined;
      rawArgsByCall.set(hookCtx.toolCallId, hookCtx.args);
      // chat() would send its own validation message to the model, so
      // invalid arguments get the executor's sanitized failure instead.
      if (await acceptsInput(entry, hookCtx.args)) return undefined;
      const result = await executeToolCall(
        entry,
        hookCtx.args,
        input.identity,
        ctx.signal ?? policy.abortController.signal,
      );
      calls.settle(hookCtx.toolCallId, result);
      return { type: 'skip', result: toModelToolPayload(result) };
    },
    onToolPhaseComplete: (_ctx, info) => {
      calls.endToolPhase(info.toolCalls.map((call) => call.id));
    },
  };
  // Last in the array, so it sees every other middleware's substitution.
  const resultGuardMiddleware: ChatMiddleware = {
    name: 'maelstrom-agent-run-result-guard',
    onAfterToolCall: (_ctx, info) => {
      const entry = input.registry.get(info.toolName);
      if (entry === undefined) return undefined;
      if (!info.ok && info.result === undefined) return undefined;
      const own = calls.settledResult(info.toolCallId);
      if (
        own !== undefined &&
        isSameModelPayload(info.result, toModelToolPayload(own))
      ) {
        return undefined;
      }
      const validation = validateToolResultEnvelope(entry, info.result);
      if (!validation.valid) {
        input.logger.warn('Agent run replaced an invalid substituted result', {
          runId: input.runId,
          tool: entry.tool.name,
          reason: validation.reason,
        });
      }
      const result = validation.valid
        ? validation.result
        : invalidSubstitutionResult(entry);
      calls.settle(info.toolCallId, result);
      return { type: 'replaceResult', result: toModelToolPayload(result) };
    },
  };
  return chat({
    adapter,
    threadId: input.runId,
    systemPrompts: [input.instructions],
    messages: [
      ...input.priorMessages,
      { role: 'user', content: input.utterance },
    ],
    tools: input.registry
      .entries()
      .map((entry) =>
        toChatTool(entry, input, policy, calls, (callId) =>
          rawArgsByCall.get(callId),
        ),
      ),
    toolExecution: 'sequential',
    agentLoopStrategy: () => true,
    abortController: policy.abortController,
    middleware: [
      policyMiddleware,
      runEventsMiddleware,
      ...(instrumentation.middleware ?? []),
      resultGuardMiddleware,
    ],
    debug: false,
    ...(input.retry !== undefined && { retry: input.retry }),
  });
}

function toChatTool(
  entry: ToolRegistryEntry,
  input: AgentRunInput,
  policy: AgentRunPolicy,
  calls: ToolCallTracker,
  rawArgsOf: (callId: string) => unknown,
): Tool {
  return toolDefinition({
    name: entry.tool.name,
    description: entry.tool.description,
    inputSchema: entry.tool.input,
  }).server(async (validatedArgs, context) => {
    const callId = context?.toolCallId;
    // The executor parses the model's own arguments, so a schema transform
    // never runs twice.
    const rawArgs =
      callId === undefined
        ? validatedArgs
        : (rawArgsOf(callId) ?? validatedArgs);
    if (callId !== undefined) calls.markStarted(callId);
    const result = await executeToolCall(
      entry,
      rawArgs,
      input.identity,
      context?.abortSignal ?? policy.abortController.signal,
    );
    const settled =
      policy.ending === undefined ? result : stoppedToolResult(entry);
    if (callId !== undefined) calls.settle(callId, settled);
    return toModelToolPayload(settled);
  }) as Tool;
}

interface StreamingToolCall {
  readonly name: string;
  readonly turnId: string;
  argsText: string;
}

interface AnnouncedToolCall {
  readonly callId: CallId;
  readonly name: string;
  readonly turnId: string;
  started: boolean;
}

type ToolCallTracker = ReturnType<typeof createToolCallTracker>;

function createToolCallTracker(runId: RunId) {
  let turn = 0;
  let textTurn = 0;
  let text = '';
  let accepting = true;
  const queued: AgentRunEvent[] = [];
  const streaming = new Map<string, StreamingToolCall>();
  const announced = new Map<string, AnnouncedToolCall>();
  const settled = new Map<string, ToolCallResult>();
  const turnId = () => `${runId}:t${turn}`;

  const settleAnnounced = (
    call: AnnouncedToolCall,
  ): { event: AgentRunEvent; phaseResult: AgentRunToolPhaseResult } => {
    const result = settled.get(call.callId) ?? unsettledResult(call);
    announced.delete(call.callId);
    return {
      event: {
        type: 'tool_result',
        turnId: call.turnId,
        callId: call.callId,
        name: call.name,
        ok: result.ok,
        summary: result.summary,
      },
      phaseResult: result.ok
        ? {
            callId: call.callId,
            name: call.name,
            ok: true,
            summary: result.summary,
            value: result.value,
          }
        : {
            callId: call.callId,
            name: call.name,
            ok: false,
            summary: result.summary,
          },
    };
  };

  function* drainQueued(): Generator<AgentRunEvent> {
    for (let event = queued.shift(); event; event = queued.shift()) {
      yield event;
    }
  }

  return {
    drainQueued,
    startTurn(next: number) {
      turn = next;
    },
    settle(callId: string, result: ToolCallResult) {
      settled.set(callId, result);
    },
    settledResult(callId: string): ToolCallResult | undefined {
      return settled.get(callId);
    },
    markStarted(callId: string) {
      const call = announced.get(callId);
      if (call !== undefined) call.started = true;
    },
    endToolPhase(callIds: readonly string[]) {
      if (!accepting) return;
      const results: AgentRunToolPhaseResult[] = [];
      for (const callId of callIds) {
        const call = announced.get(callId);
        if (call === undefined) continue;
        const { event, phaseResult } = settleAnnounced(call);
        queued.push(event);
        results.push(phaseResult);
      }
      if (results.length > 0) {
        queued.push({ type: 'tool_phase_ended', turnId: turnId(), results });
      }
    },
    *closeQueue(): Generator<AgentRunEvent> {
      accepting = false;
      yield* drainQueued();
      for (const call of [...announced.values()]) {
        yield settleAnnounced(call).event;
      }
    },
    *mapChunk(chunk: StreamChunk): Generator<AgentRunEvent> {
      switch (chunk.type) {
        case 'TEXT_MESSAGE_CONTENT':
          if (textTurn !== turn) {
            textTurn = turn;
            text = '';
          }
          text += chunk.delta;
          yield { type: 'message', turnId: turnId(), delta: chunk.delta };
          return;
        case 'TOOL_CALL_START':
          streaming.set(chunk.toolCallId, {
            name: chunk.toolCallName,
            turnId: turnId(),
            argsText: '',
          });
          return;
        case 'TOOL_CALL_ARGS': {
          const call = streaming.get(chunk.toolCallId);
          if (call !== undefined) call.argsText += chunk.delta;
          return;
        }
        case 'TOOL_CALL_END': {
          const call = streaming.get(chunk.toolCallId);
          const callId = toCallId(chunk.toolCallId);
          if (call === undefined || callId === undefined) return;
          streaming.delete(chunk.toolCallId);
          announced.set(callId, {
            callId,
            name: call.name,
            turnId: call.turnId,
            started: false,
          });
          yield {
            type: 'tool_call',
            turnId: call.turnId,
            callId,
            name: call.name,
            args:
              chunk.input !== undefined
                ? chunk.input
                : parseArgsText(call.argsText),
          };
          return;
        }
        default:
          return;
      }
    },
    lastTurnText(): string {
      return textTurn === turn ? text : '';
    },
  };
}

function* endingEvents(
  runId: RunId,
  ending: AgentRunEnding,
  measured: AgentRunPolicyMetrics,
  lastTurnText: string,
): Generator<AgentRunEvent> {
  const counters = {
    metrics: measured.metrics,
    unreportedUsageCalls: measured.unreportedUsageCalls,
  };
  switch (ending.reason) {
    case 'completed':
      yield { type: 'finished', ...ending, reply: lastTurnText, ...counters };
      return;
    case 'budget':
      yield {
        type: 'message',
        turnId: `${runId}:close`,
        delta: BUDGET_CLOSING_MESSAGE,
      };
      yield {
        type: 'finished',
        ...ending,
        reply: BUDGET_CLOSING_MESSAGE,
        ...counters,
      };
      return;
    case 'error':
    case 'cancelled':
      yield { type: 'finished', ...ending, reply: '', ...counters };
      return;
    default:
      assertNever(ending, 'Unknown agent run ending');
  }
}

function refusingAbortedCalls(adapter: AnyTextAdapter): AnyTextAdapter {
  return new Proxy(adapter, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property !== 'chatStream' || typeof value !== 'function') {
        return value;
      }
      return (options: TextOptions) =>
        isAborted(options.request) ? NO_CHUNKS : value.call(target, options);
    },
  });
}

const NO_CHUNKS: AsyncIterable<StreamChunk> = {
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.resolve({ done: true, value: undefined }),
  }),
};

function isAborted(request: TextOptions['request']): boolean {
  return (
    request !== undefined &&
    !(request instanceof Request) &&
    request.signal?.aborted === true
  );
}

function abortedPromise(signal: AbortSignal): Promise<typeof RUN_ABORTED> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(RUN_ABORTED);
      return;
    }
    signal.addEventListener('abort', () => resolve(RUN_ABORTED), {
      once: true,
    });
  });
}

async function acceptsInput(
  entry: ToolRegistryEntry,
  args: unknown,
): Promise<boolean> {
  try {
    return (await entry.tool.input.safeParseAsync(args)).success;
  } catch {
    return false;
  }
}

function invalidSubstitutionResult(entry: ToolRegistryEntry): ToolCallResult {
  return {
    ok: false,
    code: 'invalid_output',
    summary: `${entry.tool.name} returned an invalid result`,
  };
}

// chat() parses a string result as JSON and turns undefined into null
// before middleware sees it.
function isSameModelPayload(received: unknown, own: unknown): boolean {
  if (received === own) return true;
  const normalized =
    typeof own === 'string' ? parseJsonOrKeep(own) : (own ?? null);
  if (received === normalized) return true;
  try {
    return JSON.stringify(received) === JSON.stringify(normalized);
  } catch {
    return false;
  }
}

function parseJsonOrKeep(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function unsettledResult(call: AnnouncedToolCall): ToolCallResult {
  return {
    ok: false,
    code: 'cancelled',
    summary: call.started ? STOPPED_TOOL_SUMMARY : NOT_RUN_TOOL_SUMMARY,
  };
}

function toCallId(value: string): CallId | undefined {
  return value.trim().length > 0 ? CallId(value) : undefined;
}

function parseArgsText(argsText: string): unknown {
  if (argsText.trim().length === 0) return {};
  try {
    return JSON.parse(argsText);
  } catch {
    return argsText;
  }
}
