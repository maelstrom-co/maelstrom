import { describe, expect, test } from 'bun:test';

import { CallId, RunId } from '@maelstrom-co/protocol';
import {
  type ChatMiddleware,
  EventType,
  type StreamChunk,
  type TextOptions,
  type TokenUsage,
} from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';

import type { Logger } from '../logger.js';
import { summarizeAsTruncatedJson } from './__test-helpers__/summarize-as-truncated-json.js';
import { runAgentChat } from './agent-run-chat.js';
import {
  type AgentRunBudgets,
  type AgentRunEvent,
  type AgentRunFinished,
  type AgentRunInput,
  type AgentRunOptions,
  BUDGET_CLOSING_MESSAGE,
  DEFAULT_AGENT_RUN_BUDGETS,
  runAgent,
} from './agent-run.js';
import { serverTool, ToolError } from './server-tool.js';
import { createToolRegistry } from './tool-registry.js';

test('default budgets and the closing message keep their settled values', () => {
  expect(DEFAULT_AGENT_RUN_BUDGETS).toEqual({
    maxTurns: 12,
    maxElapsedMs: 120_000,
    maxTokens: 100_000,
    maxToolCalls: 24,
  });
  expect(Object.isFrozen(DEFAULT_AGENT_RUN_BUDGETS)).toBe(true);
  expect(BUDGET_CLOSING_MESSAGE).toBe(
    'I could not finish this within my limits. Try a narrower question.',
  );
});

test('the reserved inbox option accepts no value', () => {
  const signal = new AbortController().signal;
  const withoutInbox: AgentRunOptions = { signal };
  // @ts-expect-error inbox is reserved and not implemented
  const withInbox: AgentRunOptions = { signal, inbox: {} };
  expect(withoutInbox.inbox).toBeUndefined();
  expect(withInbox.signal).toBe(signal);
});

describe('runAgent on chat()', () => {
  test('a tool turn then a text turn completes with the last turn as reply', async () => {
    const tools = orderTools();
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['Your order ', 'is o-1.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(runInput({ adapter: model.adapter, registry: tools.registry }), {
        signal: new AbortController().signal,
      }),
    );

    expect(events).toEqual([
      {
        type: 'tool_call',
        turnId: 'run-1:t1',
        callId: CallId('c1'),
        name: 'latest_order',
        args: {},
      },
      {
        type: 'tool_result',
        turnId: 'run-1:t1',
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Order o-1',
      },
      {
        type: 'tool_phase_ended',
        turnId: 'run-1:t1',
        results: [
          {
            callId: CallId('c1'),
            name: 'latest_order',
            ok: true,
            summary: 'Order o-1',
            value: LATEST_ORDER,
          },
        ],
      },
      { type: 'message', turnId: 'run-1:t2', delta: 'Your order ' },
      { type: 'message', turnId: 'run-1:t2', delta: 'is o-1.' },
      {
        type: 'finished',
        reason: 'completed',
        reply: 'Your order is o-1.',
        metrics: {
          turns: 2,
          toolCalls: 1,
          elapsedMs: 0,
          inputTokens: 14,
          outputTokens: 3,
        },
        unreportedUsageCalls: 0,
      },
    ]);
    expect(toolMessageContents(model.requests[1])).toEqual([LATEST_ORDER]);
  });

  test('two calls in one turn are announced first, then run one after another in call order', async () => {
    const log: string[] = [];
    const tools = orderTools({ log });
    const model = scriptedAdapter([
      toolTurn(
        [
          { id: 'c1', name: 'latest_order', args: {} },
          { id: 'c2', name: 'order_status', args: { orderId: 'o-1' } },
        ],
        usage(10, 2),
      ),
      textTurn(['Done.'], usage(4, 1)),
    ]);

    for await (const event of runAgent(
      runInput({ adapter: model.adapter, registry: tools.registry }),
      { signal: new AbortController().signal },
    )) {
      if (event.type === 'tool_call' || event.type === 'tool_result') {
        log.push(`${event.type} ${event.callId}`);
      }
    }

    expect(log).toEqual([
      'tool_call c1',
      'tool_call c2',
      'start latest_order',
      'end latest_order',
      'start order_status',
      'end order_status',
      'tool_result c1',
      'tool_result c2',
    ]);
  });

  test('token metrics sum every provider call, not only the last turn', async () => {
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['Done.'], usage(4, 1)),
    ]);

    const finished = lastEvent(
      await collect(
        runAgent(
          runInput({ adapter: model.adapter, registry: orderTools().registry }),
          { signal: new AbortController().signal },
        ),
      ),
    );

    expect(finished.reason).toBe('completed');
    expect(totalOf(finished)).toBe(17);
  });

  test('a tool turn then a failing model call ends with one sanitized error and keeps the sent deltas', async () => {
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      failingTurn({
        deltas: ['Partial'],
        message: `upstream exploded with key ${SECRET}`,
        usage: usage(5, 2),
      }),
    ]);

    const events = await collect(
      runAgent(
        runInput({ adapter: model.adapter, registry: orderTools().registry }),
        { signal: new AbortController().signal },
      ),
    );

    const finished = lastEvent(events);
    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
    expect(finished).toMatchObject({
      reason: 'error',
      reply: '',
      code: 'provider_error',
    });
    expect(totalOf(finished)).toBe(19);
    expect(events).toContainEqual({
      type: 'message',
      turnId: 'run-1:t2',
      delta: 'Partial',
    });
    expect(
      events.some(
        (event) => event.type === 'message' && event.turnId.endsWith(':close'),
      ),
    ).toBe(false);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  test('a retried model call counts one turn and the tokens of both attempts', async () => {
    const model = scriptedAdapter([
      failingTurn({
        message: 'slow down',
        usage: usage(2, 1),
        retryAfterMs: 0,
      }),
      textTurn(['Hello.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: orderTools().registry,
          retry: { maxRetries: 1, maxWaitMs: 0 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    const finished = lastEvent(events);
    expect(model.requests).toHaveLength(2);
    expect(finished).toMatchObject({ reason: 'completed', reply: 'Hello.' });
    expect(finished.metrics.turns).toBe(1);
    expect(totalOf(finished)).toBe(8);
  });

  test('a policy abort mid-run, which chat() ends silently, still yields exactly one finished', async () => {
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['never sent'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({ adapter: model.adapter, registry: orderTools().registry }),
        {
          signal: new AbortController().signal,
          gate: ({ turn }) =>
            turn === 2 ? Promise.reject(new Error(SECRET)) : undefined,
        },
      ),
    );

    expect(model.requests).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      'tool_call',
      'tool_result',
      'tool_phase_ended',
      'finished',
    ]);
    expect(lastEvent(events)).toMatchObject({
      reason: 'error',
      code: 'gate_failed',
      reply: '',
    });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  test('a ToolError message reaches the model and the loop continues', async () => {
    const tools = orderTools({
      latestOrder: () => Promise.reject(new ToolError('No orders yet.')),
    });
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['You have no orders.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(runInput({ adapter: model.adapter, registry: tools.registry }), {
        signal: new AbortController().signal,
      }),
    );

    expect(toolMessageContents(model.requests[1])).toEqual([
      { ok: false, error: 'No orders yet.' },
    ]);
    expect(events).toContainEqual({
      type: 'tool_result',
      turnId: 'run-1:t1',
      callId: CallId('c1'),
      name: 'latest_order',
      ok: false,
      summary: 'No orders yet.',
    });
    expect(lastEvent(events)).toMatchObject({
      reason: 'completed',
      reply: 'You have no orders.',
    });
  });

  test('identity reaches the tool context and never a model request or an event', async () => {
    const tools = orderTools();
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['Done.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: tools.registry,
          identity: { user: { id: USER_SENTINEL }, token: TOKEN_SENTINEL },
          priorMessages: [{ role: 'assistant', content: 'Earlier answer.' }],
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(tools.contexts).toEqual([
      { user: { id: USER_SENTINEL }, token: TOKEN_SENTINEL },
    ]);
    expect(tools.args).toEqual([{}]);
    expect(model.requests).toHaveLength(2);
    for (const serialized of model.serializedRequests) {
      expect(serialized).toContain('Earlier answer.');
      expect(serialized).toContain('what was my last order?');
      expect(serialized).toContain(INSTRUCTIONS);
      expect(serialized).not.toContain(USER_SENTINEL);
      expect(serialized).not.toContain(TOKEN_SENTINEL);
    }
    expect(JSON.stringify(events)).not.toContain(USER_SENTINEL);
    expect(JSON.stringify(events)).not.toContain(TOKEN_SENTINEL);
  });

  test('pulls the adapter no further than the chunk behind the last event the consumer took', async () => {
    let adapterClosed = false;
    const model = scriptedAdapter([
      async function* (request) {
        try {
          yield* textTurn(['a', 'b', 'c', 'd'], usage(4, 1))(request);
        } finally {
          adapterClosed = true;
        }
      },
    ]);
    const iterator = runAgent(
      runInput({ adapter: model.adapter, registry: orderTools().registry }),
      { signal: new AbortController().signal },
    )[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: 'message', turnId: 'run-1:t1', delta: 'a' },
    });
    const afterFirst = model.pulledChunks();
    await flushMacrotask();
    expect(model.pulledChunks()).toBe(afterFirst);
    expect(afterFirst).toBe(3);

    await iterator.next();
    expect(model.pulledChunks()).toBe(4);

    expect(await iterator.return?.()).toEqual({
      done: true,
      value: undefined,
    });
    expect(adapterClosed).toBe(true);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test('an onConfig messages amend before turn 2 reaches that turn without restarting the run', async () => {
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['Done.'], usage(4, 1)),
    ]);
    const amend: ChatMiddleware = {
      name: 'test-amend',
      onConfig: (ctx, config) =>
        ctx.phase === 'beforeModel' && ctx.iteration === 1
          ? {
              messages: [
                ...config.messages,
                { role: 'user', content: 'Also check my returns.' },
              ],
            }
          : undefined,
    };

    const events = await collect(
      runAgentChat(
        runInput({ adapter: model.adapter, registry: orderTools().registry }),
        { signal: new AbortController().signal },
        { middleware: [amend] },
      ),
    );

    expect(model.requests).toHaveLength(2);
    expect(model.serializedRequests[0]).not.toContain('Also check my returns.');
    expect(model.serializedRequests[1]).toContain('Also check my returns.');
    expect(lastEvent(events)).toMatchObject({
      reason: 'completed',
      metrics: { turns: 2 },
    });
  });

  test('an adapter returned from onConfig does not serve the turn', async () => {
    const model = scriptedAdapter([textTurn(['Main.'], usage(4, 1))]);
    const other = scriptedAdapter([textTurn(['Other.'], usage(4, 1))]);
    const swap: ChatMiddleware = {
      name: 'test-adapter-swap',
      onConfig: () => ({ adapter: other.adapter }) as never,
    };

    const events = await collect(
      runAgentChat(
        runInput({ adapter: model.adapter, registry: orderTools().registry }),
        { signal: new AbortController().signal },
        { middleware: [swap] },
      ),
    );

    expect(other.requests).toHaveLength(0);
    expect(model.requests).toHaveLength(1);
    expect(lastEvent(events)).toMatchObject({ reply: 'Main.' });
  });

  test('a delegating adapter picks an inner adapter per call and the ledger records each inner model', async () => {
    const first = scriptedAdapter(
      [toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2))],
      'model-a',
    );
    const second = scriptedAdapter(
      [textTurn(['Done.'], usage(4, 1))],
      'model-b',
    );
    let calls = 0;
    const delegating = Object.assign(fakeText({ model: 'delegating' }), {
      chatStream: (options: TextOptions) =>
        (calls++ === 0 ? first : second).adapter.chatStream(options),
    });
    const models: string[] = [];

    const events = await collect(
      runAgentChat(
        runInput({ adapter: delegating, registry: orderTools().registry }),
        { signal: new AbortController().signal },
        { onProviderCall: (call) => models.push(call.model) },
      ),
    );

    expect(models).toEqual(['model-a', 'model-b']);
    expect(lastEvent(events)).toMatchObject({
      reason: 'completed',
      metrics: { turns: 2, inputTokens: 14, outputTokens: 3 },
    });
  });

  test('a completed provider call without usage logs one adapter bug warning', async () => {
    const warnings: { message: string; data?: Record<string, unknown> }[] = [];
    const model = scriptedAdapter([textTurn(['Hello.'], undefined)]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: orderTools().registry,
          logger: recordingLogger(warnings),
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data).toEqual({
      runId: 'run-1',
      role: 'agent',
      model: 'scripted-model',
    });
    expect(lastEvent(events)).toMatchObject({
      reason: 'completed',
      unreportedUsageCalls: 1,
    });
  });
});

const SECRET = 'sk-SECRET-123';
const USER_SENTINEL = 'USER-SENTINEL-42';
const TOKEN_SENTINEL = 'TOKEN-SENTINEL-42';
const INSTRUCTIONS = 'You help pet shop customers.';
const LATEST_ORDER = { orderId: 'o-1', total: 42 };

const testBudgets: AgentRunBudgets = {
  maxTurns: 6,
  maxElapsedMs: 60_000,
  maxTokens: 1_000,
  maxToolCalls: 6,
};

type ModelCall = (request: TextOptions) => AsyncGenerator<StreamChunk>;

interface ScriptedToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

function runInput(overrides: Partial<AgentRunInput>): AgentRunInput {
  return {
    runId: RunId('run-1'),
    adapter: scriptedAdapter([]).adapter,
    instructions: INSTRUCTIONS,
    registry: orderTools().registry,
    budgets: testBudgets,
    priorMessages: [],
    utterance: 'what was my last order?',
    identity: { user: { id: 'user-1' } },
    clock: { now: () => 0, scheduleTimeout: () => () => undefined },
    logger: recordingLogger([]),
    ...overrides,
  };
}

function scriptedAdapter(
  calls: readonly ModelCall[],
  model = 'scripted-model',
) {
  const requests: TextOptions[] = [];
  const serializedRequests: string[] = [];
  let pulled = 0;
  const adapter = Object.assign(fakeText({ model }), {
    async *chatStream(request: TextOptions): AsyncGenerator<StreamChunk> {
      requests.push(request);
      serializedRequests.push(serializeLoosely(request));
      const call = calls[requests.length - 1];
      if (call === undefined) throw new Error('script exhausted');
      for await (const chunk of call(request)) {
        pulled += 1;
        yield { ...chunk, ...(isTerminal(chunk) ? { model } : {}) };
      }
    },
  });
  return { adapter, requests, serializedRequests, pulledChunks: () => pulled };
}

function textTurn(
  deltas: readonly string[],
  reported: TokenUsage | undefined,
): ModelCall {
  return async function* () {
    yield runStarted();
    yield {
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'm',
      role: 'assistant',
      timestamp: 0,
    };
    for (const delta of deltas) {
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm',
        delta,
        timestamp: 0,
      };
    }
    yield { type: EventType.TEXT_MESSAGE_END, messageId: 'm', timestamp: 0 };
    yield runFinished('stop', reported);
  };
}

function toolTurn(
  calls: readonly ScriptedToolCall[],
  reported: TokenUsage | undefined,
): ModelCall {
  return async function* () {
    yield runStarted();
    for (const call of calls) {
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId: call.id,
        toolCallName: call.name,
        timestamp: 0,
      };
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: call.id,
        delta: JSON.stringify(call.args),
        timestamp: 0,
      };
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId: call.id,
        timestamp: 0,
      };
    }
    yield runFinished('tool_calls', reported);
  };
}

function failingTurn(options: {
  readonly deltas?: readonly string[];
  readonly message: string;
  readonly usage: TokenUsage;
  readonly retryAfterMs?: number;
}): ModelCall {
  return async function* () {
    yield runStarted();
    if (options.deltas !== undefined) {
      yield {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'm',
        role: 'assistant',
        timestamp: 0,
      };
      for (const delta of options.deltas) {
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'm',
          delta,
          timestamp: 0,
        };
      }
    }
    yield {
      type: EventType.RUN_ERROR,
      message: options.message,
      code: 'upstream',
      usage: options.usage,
      ...(options.retryAfterMs !== undefined && {
        retryAfterMs: options.retryAfterMs,
      }),
      timestamp: 0,
    } as StreamChunk;
  };
}

function runStarted(): StreamChunk {
  return {
    type: EventType.RUN_STARTED,
    runId: 'provider-run',
    threadId: 'provider-thread',
    timestamp: 0,
  };
}

function runFinished(
  finishReason: 'stop' | 'tool_calls',
  reported: TokenUsage | undefined,
): StreamChunk {
  return {
    type: EventType.RUN_FINISHED,
    runId: 'provider-run',
    threadId: 'provider-thread',
    finishReason,
    ...(reported !== undefined && { usage: reported }),
    timestamp: 0,
  };
}

function isTerminal(chunk: StreamChunk): boolean {
  return chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR';
}

function usage(promptTokens: number, completionTokens: number): TokenUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function orderTools(
  options: {
    readonly log?: string[];
    readonly latestOrder?: () => Promise<typeof LATEST_ORDER>;
  } = {},
) {
  const contexts: { user: unknown; token?: string }[] = [];
  const args: unknown[] = [];
  const traced = async <T>(name: string, run: () => Promise<T>) => {
    options.log?.push(`start ${name}`);
    await Promise.resolve();
    try {
      return await run();
    } finally {
      options.log?.push(`end ${name}`);
    }
  };
  const registry = createToolRegistry([
    serverTool({
      name: 'latest_order',
      description: 'Returns the latest order of the user',
      input: z.object({}),
      output: z.object({ orderId: z.string(), total: z.number() }),
      sideEffect: 'read_only',
      execute: (input, ctx) => {
        args.push(input);
        contexts.push(
          ctx.token === undefined
            ? { user: ctx.user }
            : { user: ctx.user, token: ctx.token },
        );
        return traced(
          'latest_order',
          options.latestOrder ?? (() => Promise.resolve(LATEST_ORDER)),
        );
      },
      summarize: (output) => `Order ${output.orderId}`,
    }),
    serverTool({
      name: 'order_status',
      description: 'Returns the status of an order',
      input: z.object({ orderId: z.string() }),
      output: z.object({ status: z.string() }),
      sideEffect: 'read_only',
      execute: () =>
        traced('order_status', () => Promise.resolve({ status: 'shipped' })),
      summarize: summarizeAsTruncatedJson,
    }),
  ]);
  return { registry, contexts, args };
}

function recordingLogger(
  warnings: { message: string; data?: Record<string, unknown> }[],
): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, data) => {
      warnings.push({ message, data });
    },
    error: () => undefined,
  };
}

async function collect(
  run: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for await (const event of run) events.push(event);
  return events;
}

function lastEvent(events: readonly AgentRunEvent[]): AgentRunFinished {
  const last = events.at(-1);
  if (last?.type !== 'finished') throw new Error('run did not finish');
  return last;
}

function totalOf(finished: AgentRunFinished): number {
  return finished.metrics.inputTokens + finished.metrics.outputTokens;
}

function toolMessageContents(request: TextOptions | undefined): unknown[] {
  return (request?.messages ?? [])
    .filter((message) => message.role === 'tool')
    .map((message) =>
      typeof message.content === 'string'
        ? JSON.parse(message.content)
        : message.content,
    );
}

function serializeLoosely(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'function') return undefined;
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) return undefined;
      seen.add(item);
    }
    return item;
  });
}

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
