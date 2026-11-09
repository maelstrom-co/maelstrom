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

import { defer } from '../__test-helpers__/defer.js';
import type { Logger } from '../logger.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import { summarizeAsTruncatedJson } from './__test-helpers__/summarize-as-truncated-json.js';
import { runAgentChat } from './agent-run-chat.js';
import {
  NOT_RUN_TOOL_SUMMARY,
  STOPPED_TOOL_SUMMARY,
} from './agent-run-policy.js';
import {
  type AgentRunBudgets,
  type AgentRunEvent,
  type AgentRunFinished,
  type AgentRunInput,
  type AgentRunOptions,
  type AgentRunToolResultEvent,
  BUDGET_CLOSING_MESSAGE,
  DEFAULT_AGENT_RUN_BUDGETS,
  runAgent,
} from './agent-run.js';
import { serverTool, ToolError } from './server-tool.js';
import { validateToolResultEnvelope } from './tool-executor.js';
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

  test('a rate-limited attempt without usage does not block tools under a token cap', async () => {
    const model = scriptedAdapter([
      failingTurn({ message: 'slow down', retryAfterMs: 0 }),
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['Done.'], usage(4, 1)),
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
    expect(model.requests).toHaveLength(3);
    expect(events).toContainEqual({
      type: 'tool_result',
      turnId: 'run-1:t1',
      callId: CallId('c1'),
      name: 'latest_order',
      ok: true,
      summary: 'Order o-1',
    });
    expect(finished).toMatchObject({
      reason: 'completed',
      reply: 'Done.',
      unreportedUsageCalls: 0,
    });
    expect(finished.metrics.turns).toBe(2);
    expect(totalOf(finished)).toBe(17);
  });

  test('a policy abort mid-run, which chat() ends silently, still yields exactly one finished', async () => {
    const errors: { message: string; error?: unknown; data?: unknown }[] = [];
    const gateError = new Error(SECRET);
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
      textTurn(['never sent'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: orderTools().registry,
          logger: recordingLogger([], errors),
        }),
        {
          signal: new AbortController().signal,
          gate: ({ turn }) =>
            turn === 2 ? Promise.reject(gateError) : undefined,
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
    expect(errors).toEqual([
      {
        message: 'Agent run gate failed',
        error: gateError,
        data: { runId: 'run-1', turn: 2 },
      },
    ]);
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

  describe('substituted tool results', () => {
    const INVALID_RESULT_SUMMARY = 'latest_order returned an invalid result';

    test.each([
      {
        name: 'a skip whose result is not a tool result envelope',
        substitution: {
          name: 'test-malformed-skip',
          onBeforeToolCall: () => ({
            type: 'skip',
            result: { leaked: SECRET },
          }),
        } satisfies ChatMiddleware,
        toolRuns: [],
      },
      {
        name: 'a replaceResult whose value fails the output schema',
        substitution: {
          name: 'test-malformed-replace',
          onAfterToolCall: () => ({
            type: 'replaceResult',
            result: { ok: true, value: { orderId: SECRET }, summary: 'Order' },
          }),
        } satisfies ChatMiddleware,
        toolRuns: ['start latest_order', 'end latest_order'],
      },
    ])(
      '$name reaches the model as a sanitized failure and the run continues',
      async ({ substitution, toolRuns }) => {
        const log: string[] = [];
        const tools = orderTools({ log });
        const model = scriptedAdapter([
          toolTurn(
            [{ id: 'c1', name: 'latest_order', args: {} }],
            usage(10, 2),
          ),
          textTurn(['No order found.'], usage(4, 1)),
        ]);

        const events = await collect(
          runAgentChat(
            runInput({ adapter: model.adapter, registry: tools.registry }),
            { signal: new AbortController().signal },
            { middleware: [substitution] },
          ),
        );

        expect(log).toEqual([...toolRuns]);
        expect(toolMessageContents(model.requests[1])).toEqual([
          { ok: false, error: INVALID_RESULT_SUMMARY },
        ]);
        expect(serializeLoosely(model.requests)).not.toContain(SECRET);
        expect(events).toContainEqual({
          type: 'tool_result',
          turnId: 'run-1:t1',
          callId: CallId('c1'),
          name: 'latest_order',
          ok: false,
          summary: INVALID_RESULT_SUMMARY,
        });
        expect(serializeLoosely(events)).not.toContain(SECRET);
        expect(lastEvent(events)).toMatchObject({
          reason: 'completed',
          reply: 'No order found.',
        });
        expectEveryCallSettledOnce(events);
      },
    );

    test('a well-formed substituted envelope reaches the model as its value and the event as its summary', async () => {
      const tools = orderTools();
      const model = scriptedAdapter([
        toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(10, 2)),
        textTurn(['Your order is o-1.'], usage(4, 1)),
      ]);
      const cached: ChatMiddleware = {
        name: 'test-cached-skip',
        onBeforeToolCall: () => ({
          type: 'skip',
          result: { ok: true, value: LATEST_ORDER, summary: 'Cached order' },
        }),
      };

      const events = await collect(
        runAgentChat(
          runInput({ adapter: model.adapter, registry: tools.registry }),
          { signal: new AbortController().signal },
          { middleware: [cached] },
        ),
      );

      expect(toolMessageContents(model.requests[1])).toEqual([LATEST_ORDER]);
      expect(events).toContainEqual({
        type: 'tool_result',
        turnId: 'run-1:t1',
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Cached order',
      });
      expect(lastEvent(events)).toMatchObject({ reason: 'completed' });
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

describe('runAgent budgets and stops on chat()', () => {
  test.each([
    ['maxTurns', 'turns'],
    ['maxTokens', 'tokens'],
  ] as const)(
    'a zero %s ends with the closing message and zero metrics before any model call',
    async (budget, limit) => {
      const time = createFakeAgentRunTime();
      const model = scriptedAdapter([textTurn(['never sent'], usage(1, 1))]);

      const events = await collect(
        runAgent(
          runInput({
            adapter: model.adapter,
            budgets: { ...testBudgets, [budget]: 0 },
            clock: time.clock,
          }),
          { signal: new AbortController().signal },
        ),
      );

      expect(model.requests).toHaveLength(0);
      expect(time.scheduled()).toEqual([]);
      expect(events).toEqual([
        CLOSING_EVENT,
        {
          type: 'finished',
          reason: 'budget',
          limit,
          reply: BUDGET_CLOSING_MESSAGE,
          metrics: ZERO_METRICS,
          unreportedUsageCalls: 0,
        },
      ]);
    },
  );

  test('an already aborted signal ends cancelled before any model call', async () => {
    const model = scriptedAdapter([textTurn(['never sent'], usage(1, 1))]);
    const controller = new AbortController();
    controller.abort('caller left');

    const events = await collect(
      runAgent(runInput({ adapter: model.adapter }), {
        signal: controller.signal,
      }),
    );

    expect(model.requests).toHaveLength(0);
    expect(events).toEqual([
      {
        type: 'finished',
        reason: 'cancelled',
        cause: 'caller left',
        reply: '',
        metrics: ZERO_METRICS,
        unreportedUsageCalls: 0,
      },
    ]);
  });

  test('a turn cap of 3 with an always-tool model runs the tools of turns 1 and 2 and refuses turn 3', async () => {
    const tools = orderTools();
    const model = scriptedAdapter(
      [1, 2, 3, 4].map((turn) =>
        toolTurn(
          [{ id: `c${turn}`, name: 'latest_order', args: {} }],
          usage(10, 2),
        ),
      ),
    );

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: tools.registry,
          budgets: { ...testBudgets, maxTurns: 3 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(model.requests).toHaveLength(3);
    expect(tools.args).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      ...TOOL_TURN_TYPES,
      ...TOOL_TURN_TYPES,
      ...TOOL_TURN_TYPES,
      'message',
      'finished',
    ]);
    expect(events).toContainEqual(
      notRunResult('run-1:t3', 'c3', 'latest_order'),
    );
    expect(events.at(-2)).toEqual(CLOSING_EVENT);
    expect(lastEvent(events)).toEqual({
      type: 'finished',
      reason: 'budget',
      limit: 'turns',
      reply: BUDGET_CLOSING_MESSAGE,
      metrics: {
        turns: 3,
        toolCalls: 2,
        elapsedMs: 0,
        inputTokens: 30,
        outputTokens: 6,
      },
      unreportedUsageCalls: 0,
    });
    expectEveryCallSettledOnce(events);
  });

  test.each([
    ['at the deadline with its timer lagging', 1, false],
    ['after the deadline with its timer lagging', 26, false],
    ['when the deadline timer fires mid-turn', 1, true],
  ] as const)(
    'a tool requested at 99 ms runs and one requested %s is refused',
    async (_when, lateBy, fireTimer) => {
      const time = createFakeAgentRunTime();
      const tools = orderTools();
      const model = scriptedAdapter([
        beforeFinish(
          toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(4, 1)),
          () => time.advance(99),
        ),
        beforeFinish(
          toolTurn([{ id: 'c2', name: 'latest_order', args: {} }], usage(4, 1)),
          () =>
            fireTimer
              ? time.advance(lateBy)
              : time.advanceWithoutFiring(lateBy),
        ),
        textTurn(['never sent'], usage(4, 1)),
      ]);

      const events = await collect(
        runAgent(
          runInput({
            adapter: model.adapter,
            registry: tools.registry,
            budgets: { ...testBudgets, maxElapsedMs: 100 },
            clock: time.clock,
          }),
          { signal: new AbortController().signal },
        ),
      );

      expect(tools.args).toHaveLength(1);
      expect(model.requests).toHaveLength(2);
      expect(events).toContainEqual(
        notRunResult('run-1:t2', 'c2', 'latest_order'),
      );
      expect(events.at(-2)).toEqual(CLOSING_EVENT);
      expect(lastEvent(events)).toMatchObject({
        reason: 'budget',
        limit: 'elapsed',
        metrics: { turns: 2, toolCalls: 1, elapsedMs: 99 + lateBy },
      });
      expectEveryCallSettledOnce(events);
    },
  );

  test('the deadline aborts an in-flight model call, keeps its deltas and leaves the adapter usable', async () => {
    const time = createFakeAgentRunTime();
    const tools = orderTools();
    const stalled: { signal?: AbortSignal; closed: boolean } = {
      closed: false,
    };
    const model = scriptedAdapter([
      stallingTurn(['Looking ', 'it up'], stalled),
      textTurn(['Fresh run.'], usage(4, 1)),
    ]);
    const iterator = runAgent(
      runInput({
        adapter: model.adapter,
        registry: tools.registry,
        budgets: { ...testBudgets, maxElapsedMs: 100 },
        clock: time.clock,
      }),
      { signal: new AbortController().signal },
    )[Symbol.asyncIterator]();

    const events = [
      (await iterator.next()).value,
      (await iterator.next()).value,
    ];
    const pending = iterator.next();
    await flushMacrotask();
    expect(stalled.signal?.aborted).toBe(false);

    time.advance(100);
    events.push((await pending).value, ...(await drain(iterator)));
    await flushMacrotask();

    expect(events).toEqual([
      { type: 'message', turnId: 'run-1:t1', delta: 'Looking ' },
      { type: 'message', turnId: 'run-1:t1', delta: 'it up' },
      CLOSING_EVENT,
      expect.objectContaining({
        type: 'finished',
        reason: 'budget',
        limit: 'elapsed',
        metrics: expect.objectContaining({ turns: 1, toolCalls: 0 }),
      }),
    ]);
    expect(stalled.signal?.aborted).toBe(true);
    expect(stalled.closed).toBe(true);
    expect(tools.args).toEqual([]);
    expect(tools.statusCalls()).toBe(0);

    const fresh = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: tools.registry,
          budgets: { ...testBudgets, maxElapsedMs: 100 },
          clock: createFakeAgentRunTime().clock,
        }),
        { signal: new AbortController().signal },
      ),
    );
    expect(lastEvent(fresh)).toMatchObject({
      reason: 'completed',
      reply: 'Fresh run.',
    });
  });

  test('two turns of 6 tokens against a cap of 10 run the first mutation and refuse the second', async () => {
    const counter = counterTools();
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'increment', args: { by: 1 } }], usage(4, 2)),
      toolTurn([{ id: 'c2', name: 'increment', args: { by: 2 } }], usage(4, 2)),
      textTurn(['never sent'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: counter.registry,
          budgets: { ...testBudgets, maxTokens: 10 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(counter.balances).toEqual([1]);
    expect(events).toContainEqual(notRunResult('run-1:t2', 'c2', 'increment'));
    expect(lastEvent(events)).toEqual({
      type: 'finished',
      reason: 'budget',
      limit: 'tokens',
      reply: BUDGET_CLOSING_MESSAGE,
      metrics: {
        turns: 2,
        toolCalls: 1,
        elapsedMs: 0,
        inputTokens: 8,
        outputTokens: 4,
      },
      unreportedUsageCalls: 0,
    });
    expectEveryCallSettledOnce(events);
  });

  test('a turn without reported usage under a token cap refuses its tools with usageUnknown', async () => {
    const counter = counterTools();
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'increment', args: { by: 1 } }], undefined),
      textTurn(['never sent'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: counter.registry,
          budgets: { ...testBudgets, maxTokens: 10 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(counter.balances).toEqual([]);
    expect(model.requests).toHaveLength(1);
    expect(events).toContainEqual(notRunResult('run-1:t1', 'c1', 'increment'));
    expect(lastEvent(events)).toEqual({
      type: 'finished',
      reason: 'budget',
      limit: 'tokens',
      usageUnknown: true,
      reply: BUDGET_CLOSING_MESSAGE,
      metrics: { ...ZERO_METRICS, turns: 1 },
      unreportedUsageCalls: 1,
    });
    expectEveryCallSettledOnce(events);
  });

  test('a turn without reported usage and no token cap proceeds and metrics keep only the known sums', async () => {
    const counter = counterTools();
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'increment', args: { by: 1 } }], undefined),
      textTurn(['Added.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: counter.registry,
          budgets: { ...testBudgets, maxTokens: Infinity },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(counter.balances).toEqual([1]);
    expect(lastEvent(events)).toEqual({
      type: 'finished',
      reason: 'completed',
      reply: 'Added.',
      metrics: {
        turns: 2,
        toolCalls: 1,
        elapsedMs: 0,
        inputTokens: 4,
        outputTokens: 1,
      },
      unreportedUsageCalls: 1,
    });
  });

  test('a batch of three increments against two remaining tool calls runs none of them', async () => {
    const counter = counterTools();
    const model = scriptedAdapter([
      toolTurn(
        ['c1', 'c2', 'c3'].map((id) => ({
          id,
          name: 'increment',
          args: { by: 1 },
        })),
        usage(4, 1),
      ),
      textTurn(['never sent'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: counter.registry,
          budgets: { ...testBudgets, maxToolCalls: 2 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(counter.balances).toEqual([]);
    expect(model.requests).toHaveLength(1);
    for (const id of ['c1', 'c2', 'c3']) {
      expect(events).toContainEqual(notRunResult('run-1:t1', id, 'increment'));
    }
    expect(lastEvent(events)).toMatchObject({
      reason: 'budget',
      limit: 'toolCalls',
      metrics: { turns: 1, toolCalls: 0 },
    });
    expectEveryCallSettledOnce(events);
  });

  test('an unknown tool requested beside a real one takes no tool call reservation', async () => {
    const counter = counterTools();
    const model = scriptedAdapter([
      toolTurn(
        [
          { id: 'c1', name: 'increment', args: { by: 1 } },
          { id: 'c2', name: 'made_up_tool', args: {} },
        ],
        usage(4, 1),
      ),
      textTurn(['Balance is 1.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: counter.registry,
          budgets: { ...testBudgets, maxToolCalls: 1 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(counter.balances).toEqual([1]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        callId: CallId('c1'),
        name: 'increment',
        ok: true,
      }),
    );
    expect(lastEvent(events)).toMatchObject({
      reason: 'completed',
      reply: 'Balance is 1.',
      metrics: { turns: 2, toolCalls: 1 },
    });
  });

  test('a batch of two increments within two remaining tool calls runs them one after another', async () => {
    const counter = counterTools();
    const model = scriptedAdapter([
      toolTurn(
        [
          { id: 'c1', name: 'increment', args: { by: 1 } },
          { id: 'c2', name: 'increment', args: { by: 2 } },
        ],
        usage(4, 1),
      ),
      textTurn(['Balance is 3.'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({
          adapter: model.adapter,
          registry: counter.registry,
          budgets: { ...testBudgets, maxToolCalls: 2 },
        }),
        { signal: new AbortController().signal },
      ),
    );

    expect(counter.balances).toEqual([1, 3]);
    expect(counter.log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    expect(lastEvent(events)).toMatchObject({
      reason: 'completed',
      metrics: { turns: 2, toolCalls: 2 },
    });
  });

  test('an abort during a tool call reaches the tool signal, stops the call and drains to one cancelled', async () => {
    const controller = new AbortController();
    const observed: boolean[] = [];
    const counter = counterTools({
      beforeEffect: async (signal) => {
        controller.abort('user stopped');
        await Promise.resolve();
        observed.push(signal.aborted);
      },
    });
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'increment', args: { by: 1 } }], usage(4, 1)),
      textTurn(['never sent'], usage(4, 1)),
    ]);

    const events = await collect(
      runAgent(
        runInput({ adapter: model.adapter, registry: counter.registry }),
        { signal: controller.signal },
      ),
    );
    await flushMacrotask();

    expect(observed).toEqual([true]);
    expect(counter.balances).toEqual([]);
    expect(model.requests).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({ type: 'tool_call', callId: CallId('c1') }),
      stoppedResult('run-1:t1', 'c1', 'increment'),
      expect.objectContaining({
        type: 'finished',
        reason: 'cancelled',
        cause: 'user stopped',
        reply: '',
      }),
    ]);
  });

  test('a tool that ignores the abort and resolves later publishes nothing', async () => {
    const controller = new AbortController();
    const release = defer<void>();
    const counter = counterTools({
      beforeEffect: async () => {
        controller.abort('user stopped');
        await release.promise;
      },
      ignoresAbort: true,
    });
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'increment', args: { by: 1 } }], usage(4, 1)),
      textTurn(['never sent'], usage(4, 1)),
    ]);
    const iterator = runAgent(
      runInput({ adapter: model.adapter, registry: counter.registry }),
      { signal: controller.signal },
    )[Symbol.asyncIterator]();

    const events = await drain(iterator);
    release.resolve();
    await flushMacrotask();
    await flushMacrotask();

    expect(counter.balances).toEqual([1]);
    expect(model.requests).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      'tool_call',
      'tool_result',
      'finished',
    ]);
    expect(events[1]).toEqual(stoppedResult('run-1:t1', 'c1', 'increment'));
    expect(lastEvent(events)).toMatchObject({ reason: 'cancelled' });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test('return() mid-run aborts the run, closes the adapter stream and the tool signal, and ends the iterable', async () => {
    const counter = counterTools();
    const stalled: { signal?: AbortSignal; closed: boolean } = {
      closed: false,
    };
    const model = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'increment', args: { by: 1 } }], usage(4, 1)),
      stallingTurn(['Your balance '], stalled),
    ]);
    const iterator = runAgent(
      runInput({ adapter: model.adapter, registry: counter.registry }),
      { signal: new AbortController().signal },
    )[Symbol.asyncIterator]();

    const taken = await takeUntil(
      iterator,
      (event) => event.type === 'message',
    );
    expect(taken.at(-1)).toEqual({
      type: 'message',
      turnId: 'run-1:t2',
      delta: 'Your balance ',
    });
    expect(counter.signals[0]?.aborted).toBe(false);

    expect(await iterator.return?.()).toEqual({
      done: true,
      value: undefined,
    });
    await flushMacrotask();

    expect(stalled.signal?.aborted).toBe(true);
    expect(stalled.closed).toBe(true);
    expect(counter.signals[0]?.aborted).toBe(true);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(model.requests).toHaveLength(2);
  });

  describe('gate', () => {
    test('an unresolved gate before turn 2 holds the second model call until it resolves', async () => {
      const gate = defer<void>();
      const turns: number[] = [];
      const model = scriptedAdapter([
        toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(4, 1)),
        textTurn(['Done.'], usage(4, 1)),
      ]);
      const iterator = runAgent(runInput({ adapter: model.adapter }), {
        signal: new AbortController().signal,
        gate: ({ turn }) => {
          turns.push(turn);
          return turn === 2 ? gate.promise : undefined;
        },
      })[Symbol.asyncIterator]();

      const taken = await takeUntil(
        iterator,
        (event) => event.type === 'tool_phase_ended',
      );
      const held = settleState(iterator.next());
      await flushMacrotask();

      expect(taken.map((event) => event.type)).toEqual(TOOL_TURN_TYPES);
      expect(held.settled()).toBe(false);
      expect(model.requests).toHaveLength(1);
      expect(turns).toEqual([1, 2]);

      gate.resolve();
      const events = [(await held.promise).value, ...(await drain(iterator))];
      expect(model.requests).toHaveLength(2);
      expect(events).toEqual([
        { type: 'message', turnId: 'run-1:t2', delta: 'Done.' },
        expect.objectContaining({ reason: 'completed', reply: 'Done.' }),
      ]);
    });

    test.each([
      ['the deadline passes', 'budget'],
      ['the signal aborts', 'cancelled'],
    ] as const)(
      'when %s while gated the run ends %s without a second model call',
      async (_when, reason) => {
        const time = createFakeAgentRunTime();
        const controller = new AbortController();
        const model = scriptedAdapter([
          toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(4, 1)),
          textTurn(['never sent'], usage(4, 1)),
        ]);
        const iterator = runAgent(
          runInput({
            adapter: model.adapter,
            budgets: { ...testBudgets, maxElapsedMs: 100 },
            clock: time.clock,
          }),
          {
            signal: controller.signal,
            gate: ({ turn }) =>
              turn === 2 ? new Promise<void>(() => undefined) : undefined,
          },
        )[Symbol.asyncIterator]();

        await takeUntil(iterator, (event) => event.type === 'tool_phase_ended');
        const held = iterator.next();
        await flushMacrotask();
        if (reason === 'budget') time.advance(100);
        else controller.abort('user stopped');
        const events = [(await held).value, ...(await drain(iterator))];
        await flushMacrotask();

        expect(model.requests).toHaveLength(1);
        expect(events).toEqual(
          reason === 'budget'
            ? [
                CLOSING_EVENT,
                expect.objectContaining({ reason: 'budget', limit: 'elapsed' }),
              ]
            : [
                expect.objectContaining({
                  reason: 'cancelled',
                  cause: 'user stopped',
                }),
              ],
        );
      },
    );
  });

  describe('tools on the final allowed turn', () => {
    test('two tools requested on turn 3 of 3 are refused before they run', async () => {
      const log: string[] = [];
      const tools = orderTools({ log });
      const substituted: unknown[] = [];
      const model = scriptedAdapter([
        toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(4, 1)),
        toolTurn([{ id: 'c2', name: 'latest_order', args: {} }], usage(4, 1)),
        toolTurn(
          [
            { id: 'c3', name: 'latest_order', args: {} },
            { id: 'c4', name: 'order_status', args: { orderId: 'o-1' } },
          ],
          usage(4, 1),
        ),
        textTurn(['never sent'], usage(4, 1)),
      ]);
      const recordSubstitutions: ChatMiddleware = {
        name: 'test-record-substitutions',
        onAfterToolCall: (ctx, info) => {
          if (ctx.iteration === 2) substituted.push(info.result);
          return undefined;
        },
      };

      const events = await collect(
        runAgentChat(
          runInput({
            adapter: model.adapter,
            registry: tools.registry,
            budgets: { ...testBudgets, maxTurns: 3 },
          }),
          { signal: new AbortController().signal },
          { middleware: [recordSubstitutions] },
        ),
      );

      expect(log).toEqual([
        'start latest_order',
        'end latest_order',
        'start latest_order',
        'end latest_order',
      ]);
      expect(events.slice(6)).toEqual([
        expect.objectContaining({ type: 'tool_call', callId: CallId('c3') }),
        expect.objectContaining({ type: 'tool_call', callId: CallId('c4') }),
        notRunResult('run-1:t3', 'c3', 'latest_order'),
        notRunResult('run-1:t3', 'c4', 'order_status'),
        {
          type: 'tool_phase_ended',
          turnId: 'run-1:t3',
          results: [
            {
              callId: CallId('c3'),
              name: 'latest_order',
              ok: false,
              summary: NOT_RUN_TOOL_SUMMARY,
            },
            {
              callId: CallId('c4'),
              name: 'order_status',
              ok: false,
              summary: NOT_RUN_TOOL_SUMMARY,
            },
          ],
        },
        CLOSING_EVENT,
        expect.objectContaining({
          reason: 'budget',
          limit: 'turns',
          metrics: expect.objectContaining({ turns: 3, toolCalls: 2 }),
        }),
      ]);
      expect(substituted).toEqual([
        { ok: false, error: NOT_RUN_TOOL_SUMMARY },
        { ok: false, error: NOT_RUN_TOOL_SUMMARY },
      ]);
      for (const [index, name] of ['latest_order', 'order_status'].entries()) {
        const entry = tools.registry.get(name);
        if (entry === undefined) throw new Error(`missing ${name}`);
        expect(
          validateToolResultEnvelope(entry, {
            ok: false,
            code: 'cancelled',
            summary: (substituted[index] as { error: string }).error,
          }).valid,
        ).toBe(true);
      }
      expectEveryCallSettledOnce(events);
    });

    test('a text answer on turn 3 of 3 still completes', async () => {
      const model = scriptedAdapter([
        toolTurn([{ id: 'c1', name: 'latest_order', args: {} }], usage(4, 1)),
        toolTurn([{ id: 'c2', name: 'latest_order', args: {} }], usage(4, 1)),
        textTurn(['All done.'], usage(4, 1)),
      ]);

      const events = await collect(
        runAgent(
          runInput({
            adapter: model.adapter,
            budgets: { ...testBudgets, maxTurns: 3 },
          }),
          { signal: new AbortController().signal },
        ),
      );

      expect(lastEvent(events)).toMatchObject({
        reason: 'completed',
        reply: 'All done.',
        metrics: { turns: 3, toolCalls: 2 },
      });
    });

    test('the default budgets with an always-one-tool model take 12 turns and 11 tool calls', async () => {
      const tools = orderTools();
      const model = scriptedAdapter(
        Array.from({ length: 13 }, (_, index) =>
          toolTurn(
            [{ id: `c${index + 1}`, name: 'latest_order', args: {} }],
            usage(10, 2),
          ),
        ),
      );

      const events = await collect(
        runAgent(
          runInput({
            adapter: model.adapter,
            registry: tools.registry,
            budgets: DEFAULT_AGENT_RUN_BUDGETS,
            clock: createFakeAgentRunTime().clock,
          }),
          { signal: new AbortController().signal },
        ),
      );

      expect(model.requests).toHaveLength(12);
      expect(tools.args).toHaveLength(11);
      expect(lastEvent(events)).toMatchObject({
        reason: 'budget',
        limit: 'turns',
        metrics: { turns: 12, toolCalls: 11 },
      });
      expectEveryCallSettledOnce(events);
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

const ZERO_METRICS = {
  turns: 0,
  toolCalls: 0,
  elapsedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
};

const CLOSING_EVENT: AgentRunEvent = {
  type: 'message',
  turnId: 'run-1:close',
  delta: BUDGET_CLOSING_MESSAGE,
};

const TOOL_TURN_TYPES: AgentRunEvent['type'][] = [
  'tool_call',
  'tool_result',
  'tool_phase_ended',
];

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
  readonly usage?: TokenUsage;
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
      ...(options.usage !== undefined && { usage: options.usage }),
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

function beforeFinish(call: ModelCall, effect: () => void): ModelCall {
  return async function* (request) {
    for await (const chunk of call(request)) {
      if (isTerminal(chunk)) effect();
      yield chunk;
    }
  };
}

function stallingTurn(
  deltas: readonly string[],
  observed: { signal?: AbortSignal; closed: boolean },
): ModelCall {
  return async function* (request) {
    const signal =
      request.request instanceof Request ? undefined : request.request?.signal;
    observed.signal = signal ?? undefined;
    try {
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
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'c-half',
        toolCallName: 'order_status',
        timestamp: 0,
      };
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: 'c-half',
        delta: '{"orderId":',
        timestamp: 0,
      };
      await new Promise<void>((resolve) => {
        if (signal?.aborted === true) resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally {
      observed.closed = true;
    }
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
  let statusCalls = 0;
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
      execute: () => {
        statusCalls += 1;
        return traced('order_status', () =>
          Promise.resolve({ status: 'shipped' }),
        );
      },
      summarize: summarizeAsTruncatedJson,
    }),
  ]);
  return { registry, contexts, args, statusCalls: () => statusCalls };
}

function counterTools(
  options: {
    readonly beforeEffect?: (signal: AbortSignal) => Promise<void>;
    readonly ignoresAbort?: boolean;
  } = {},
) {
  let balance = 0;
  const balances: number[] = [];
  const log: string[] = [];
  const signals: AbortSignal[] = [];
  const registry = createToolRegistry([
    serverTool({
      name: 'increment',
      description: 'Adds to the balance',
      input: z.object({ by: z.number() }),
      output: z.object({ balance: z.number() }),
      sideEffect: 'non_idempotent',
      execute: async (input, ctx) => {
        signals.push(ctx.signal);
        log.push(`start ${input.by}`);
        await options.beforeEffect?.(ctx.signal);
        if (options.beforeEffect === undefined) await Promise.resolve();
        if (options.ignoresAbort !== true) ctx.signal.throwIfAborted();
        balance += input.by;
        balances.push(balance);
        log.push(`end ${input.by}`);
        return { balance };
      },
      summarize: (output) => `Balance ${output.balance}`,
    }),
  ]);
  return { registry, balances, log, signals };
}

function recordingLogger(
  warnings: { message: string; data?: Record<string, unknown> }[],
  errors: { message: string; error?: unknown; data?: unknown }[] = [],
): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, data) => {
      warnings.push({ message, data });
    },
    error: (message, error, data) => {
      errors.push({ message, error, data });
    },
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

async function drain(
  iterator: AsyncIterator<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for (let step = await iterator.next(); step.done !== true;) {
    events.push(step.value);
    step = await iterator.next();
  }
  return events;
}

async function takeUntil(
  iterator: AsyncIterator<AgentRunEvent>,
  matches: (event: AgentRunEvent) => boolean,
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for (;;) {
    const step = await iterator.next();
    if (step.done === true) throw new Error('run ended before the match');
    events.push(step.value);
    if (matches(step.value)) return events;
  }
}

function settleState<T>(promise: Promise<T>) {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return { promise, settled: () => settled };
}

function notRunResult(
  turnId: string,
  callId: string,
  name: string,
): AgentRunToolResultEvent {
  return {
    type: 'tool_result',
    turnId,
    callId: CallId(callId),
    name,
    ok: false,
    summary: NOT_RUN_TOOL_SUMMARY,
  };
}

function stoppedResult(
  turnId: string,
  callId: string,
  name: string,
): AgentRunToolResultEvent {
  return {
    type: 'tool_result',
    turnId,
    callId: CallId(callId),
    name,
    ok: false,
    summary: STOPPED_TOOL_SUMMARY,
  };
}

function expectEveryCallSettledOnce(events: readonly AgentRunEvent[]): void {
  expect(events.findIndex((event) => event.type === 'finished')).toBe(
    events.length - 1,
  );
  const settledAfterCall = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'tool_call') settledAfterCall.set(event.callId, 0);
    if (event.type === 'tool_result') {
      settledAfterCall.set(
        event.callId,
        (settledAfterCall.get(event.callId) ?? Number.NaN) + 1,
      );
    }
  }
  for (const [callId, results] of settledAfterCall) {
    expect({ callId, results }).toEqual({ callId, results: 1 });
  }
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
