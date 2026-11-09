import { describe, expect, mock, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  type AgentUtteranceInput,
  CallId,
  MessageId,
  type RunId,
  SessionId,
} from '@maelstrom-co/protocol';
import { EventType, type StreamChunk } from '@tanstack/ai';
import { z } from 'zod';

import { createEngine, serverTool, ToolError } from '../../index.js';
import { defer } from '../__test-helpers__/defer.js';
import {
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import {
  createFakeAgentRunTime,
  type FakeAgentRunTime,
} from './__test-helpers__/fake-agent-run-time.js';
import {
  type ScriptedModelCall,
  scriptedFailingTurn,
  scriptedTextAdapter,
  scriptedTextTurn,
  scriptedToolTurn,
  scriptedUsage,
} from './__test-helpers__/scripted-text-adapter.js';
import type { AgentConfig } from './agent-config.js';
import { NOT_RUN_TOOL_SUMMARY } from './agent-run-policy.js';
import * as agentRunQueueModule from './agent-run-queue.js';
import type { AgentRunQueue, AgentRunQueueOptions } from './agent-run-queue.js';
import { type AgentRunBudgets, BUDGET_CLOSING_MESSAGE } from './agent-run.js';
import {
  createToolResultStore,
  type ToolResultStore,
} from './tool-result-store.js';
import {
  createTranscript,
  toolCallRef,
  type Transcript,
} from './transcript.js';

const USER_SENTINEL = 'user-sentinel-7f3a';
const TOKEN_SENTINEL = 'token-sentinel-91c2';

const LATEST_ORDER = {
  orderId: 'o-1',
  total: 42,
  items: ['squeaky bone', 'catnip mouse'],
};

const TEST_BUDGETS: AgentRunBudgets = {
  maxTurns: 6,
  maxElapsedMs: 60_000,
  maxTokens: 10_000,
  maxToolCalls: 6,
};

const realCreateAgentRunQueue = agentRunQueueModule.createAgentRunQueue;
const sessionInternals: SessionInternals[] = [];

void mock.module('./agent-run-queue.js', () => ({
  ...agentRunQueueModule,
  createAgentRunQueue: (options: AgentRunQueueOptions): AgentRunQueue => {
    const transcript = options.transcript ?? createTranscript();
    const toolResults = options.toolResults ?? createToolResultStore();
    const queue = realCreateAgentRunQueue({
      ...options,
      transcript,
      toolResults,
    });
    sessionInternals.push({ queue, transcript, toolResults });
    return queue;
  },
}));

describe('agent route through the Engine handle', () => {
  describe('a single utterance', () => {
    test('streams its opening, tool breadcrumbs and reply in wire order, each decodable, with no internal events', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(10, 2),
        ),
        scriptedTextTurn(['Your last order ', 'was o-1.'], scriptedUsage(4, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'what was my last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(session.received.map((event) => event.type)).toEqual([
        'placeholder',
        'accepted',
        'started',
        'tool_call',
        'tool_result',
        'message',
        'message',
        'finished',
      ]);
      expect(session.received[1]).toMatchObject({
        type: 'accepted',
        disposition: 'agent',
        runId,
      });
      expect(runId).not.toBeNull();
      expect(session.received[3]).toEqual({
        type: 'tool_call',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
      });
      expect(session.received[3]).not.toHaveProperty('args');
      expect(session.received[4]).toEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Order o-1 for 42',
      });
      expect(lastFinished(session.received)).toMatchObject({
        runId,
        reason: 'completed',
        ok: true,
        reply: 'Your last order was o-1.',
      });
      for (const event of session.received) {
        expect(AgentEventSchema.safeParse(event).success).toBe(true);
      }
      expect(JSON.stringify(session.received)).not.toContain(
        'tool_phase_ended',
      );
      expect(session.plannerCalls()).toBe(0);
    });

    test('identity reaches the tool context exactly and never a model request, tool arguments, the wire or the transcript', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Done.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'last order?'));

      expect(order.contexts).toHaveLength(1);
      expect(order.contexts[0]?.user).toBe(session.user);
      expect(order.contexts[0]?.token).toBe(TOKEN_SENTINEL);
      const surfaces = [
        ...model.requests.map(serializeLoosely),
        JSON.stringify(order.args),
        JSON.stringify(session.received),
        JSON.stringify(session.internals().transcript.renderPriorMessages()),
      ];
      for (const surface of surfaces) {
        expect(surface).not.toContain(USER_SENTINEL);
        expect(surface).not.toContain(TOKEN_SENTINEL);
      }
    });
  });

  describe('budget endings', () => {
    test('a turn cap of 2 runs the first turn tools, refuses the second turn tools and closes with the budget message', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedToolTurn(
          [{ id: 'c2', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxTurns: 2 },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toHaveLength(1);
      expect(model.requests).toHaveLength(2);
      expect(session.received).toContainEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t2`,
        callId: CallId('c2'),
        name: 'latest_order',
        ok: false,
        summary: NOT_RUN_TOOL_SUMMARY,
      });
      expectBudgetEnding(session.received, runId);
    });

    test('the deadline passing mid model call keeps the sent deltas and closes with the budget message', async () => {
      const time = createFakeAgentRunTime();
      const stalled: StalledCall = { closed: false };
      const model = scriptedTextAdapter([
        stallingTurn(['Looking ', 'it up'], stalled),
      ]);
      const session = openAgentSession({
        time,
        model: model.adapter,
        tools: [orderTool().tool],
        budgets: { maxElapsedMs: 100 },
      });

      const sent = session.send(utterance('input-1', 'last order?'));
      await waitUntil(
        () =>
          session.received.filter((event) => event.type === 'message')
            .length === 2,
      );
      expect(stalled.signal?.aborted).toBe(false);
      time.advance(100);
      await sent;

      const runId = runIdOf(session.received, 'input-1');
      expect(
        session.received
          .filter((event) => event.type === 'message')
          .map((event) => event.delta),
      ).toEqual(['Looking ', 'it up', BUDGET_CLOSING_MESSAGE]);
      expect(stalled.signal?.aborted).toBe(true);
      expectBudgetEnding(session.received, runId);
    });

    test('a token cap reached after the first tool turn refuses the second turn tools and closes with the budget message', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(4, 2),
        ),
        scriptedToolTurn(
          [{ id: 'c2', name: 'latest_order', args: {} }],
          scriptedUsage(4, 2),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxTokens: 10 },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toHaveLength(1);
      expectBudgetEnding(session.received, runId);
    });

    test('a batch larger than the remaining tool calls runs none of them and closes with the budget message', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          ['c1', 'c2', 'c3'].map((id) => ({
            id,
            name: 'latest_order',
            args: {},
          })),
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never sent'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxToolCalls: 2 },
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(order.args).toEqual([]);
      expect(model.requests).toHaveLength(1);
      expectBudgetEnding(session.received, runId);
    });
  });

  describe('failures', () => {
    test('a tool throwing ToolError reports its summary and the run continues to completion', async () => {
      const order = orderTool({
        latestOrder: () => Promise.reject(new ToolError('No orders yet.')),
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['You have no orders yet.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(session.received).toContainEqual({
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
        ok: false,
        summary: 'No orders yet.',
      });
      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
        ok: true,
        reply: 'You have no orders yet.',
      });
    });

    test('a model failing after some deltas keeps them and ends as error with an empty reply and no closing message', async () => {
      const secret = 'provider-secret-5d1e';
      const model = scriptedTextAdapter([
        scriptedFailingTurn(
          ['Let me ', 'check'],
          `upstream exploded with key ${secret}`,
        ),
      ]);
      const session = openAgentSession({ model: model.adapter });

      await session.send(utterance('input-1', 'last order?'));

      const runId = runIdOf(session.received, 'input-1');
      expect(
        session.received
          .filter((event) => event.type === 'message')
          .map((event) => [event.turnId, event.delta]),
      ).toEqual([
        [`${runId}:t1`, 'Let me '],
        [`${runId}:t1`, 'check'],
      ]);
      const finished = lastFinished(session.received);
      expect(finished).toMatchObject({
        runId,
        reason: 'error',
        ok: false,
        reply: '',
        code: expect.any(String),
        error: expect.any(String),
      });
      expect(JSON.stringify(session.received)).not.toContain(secret);
    });
  });

  describe('session transcript across runs', () => {
    test('a second utterance sees the first run as summaries with run-qualified refs while the store keeps the full result', async () => {
      const order = orderTool();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['It cost 42.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.send(utterance('input-1', 'what was my last order?'));
      await session.send(utterance('input-2', 'how much was it?'));

      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      expect(secondRun).not.toBe(firstRun);
      const secondPrompt = serializeLoosely(model.requests[2]?.messages);
      expect(secondPrompt).toContain('what was my last order?');
      expect(secondPrompt).toContain('It was o-1.');
      expect(secondPrompt).toContain(`[tool call ${firstRun}:c1] latest_order`);
      expect(secondPrompt).toContain(
        `[tool result ${firstRun}:c1] ok: Order o-1 for 42`,
      );
      expect(secondPrompt).not.toContain('squeaky bone');
      expect(
        session
          .internals()
          .toolResults.get(toolCallRef(firstRun, CallId('c1'))),
      ).toEqual({
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Order o-1 for 42',
        value: LATEST_ORDER,
      });
    });

    test('a budget ending shows the closing message and its limit in the next run prompt', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Sorry about that.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [orderTool().tool],
        budgets: { maxTurns: 1 },
      });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'what happened?'));

      const firstRun = runIdOf(session.received, 'input-1');
      const nextPrompt = serializeLoosely(model.requests[1]?.messages);
      expect(nextPrompt).toContain(
        `[closing message ${firstRun}] ${BUDGET_CLOSING_MESSAGE}`,
      );
      expect(nextPrompt).toContain(
        `[run ${firstRun} ended: budget, limit turns]`,
      );
    });

    test('an error ending shows the partial text marked as ended with error in the next run prompt', async () => {
      const model = scriptedTextAdapter([
        scriptedFailingTurn(['Let me ', 'check'], 'upstream exploded'),
        scriptedTextTurn(['Here it is.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({ model: model.adapter });

      await session.send(utterance('input-1', 'last order?'));
      await session.send(utterance('input-2', 'try again'));

      const firstRun = runIdOf(session.received, 'input-1');
      const failed = lastFinishedOf(session.received, firstRun);
      const nextPrompt = serializeLoosely(model.requests[1]?.messages);
      expect(nextPrompt).toContain('Let me check');
      expect(nextPrompt).toContain(
        `[run ${firstRun} ended: error ${failed.code}, ${failed.error}, reply above is partial]`,
      );
    });
  });

  describe('serial queue', () => {
    test('a second utterance during an active run is accepted at once and starts after the first finishes, building on its transcript', async () => {
      const release = defer<void>();
      const toolStarted = defer<void>();
      const order = orderTool({
        latestOrder: async () => {
          toolStarted.resolve();
          await release.promise;
          return LATEST_ORDER;
        },
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['It cost 42.'], scriptedUsage(1, 1)),
      ]);
      const session = openAgentSession({
        model: model.adapter,
        tools: [order.tool],
      });

      const first = session.send(utterance('input-1', 'last order?'));
      await toolStarted.promise;
      const second = session.send(utterance('input-2', 'how much was it?'));

      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      expect(session.received.map((event) => event.type)).toEqual([
        'placeholder',
        'accepted',
        'started',
        'tool_call',
        'placeholder',
        'accepted',
      ]);
      expect(session.received[5]).toMatchObject({
        type: 'accepted',
        disposition: 'agent',
        runId: secondRun,
      });

      release.resolve();
      await Promise.all([first, second]);

      const finishedFirst = session.received.findIndex(
        (event) => event.type === 'finished' && event.runId === firstRun,
      );
      const startedSecond = session.received.findIndex(
        (event) => event.type === 'started' && event.runId === secondRun,
      );
      expect(finishedFirst).toBeGreaterThan(-1);
      expect(startedSecond).toBeGreaterThan(finishedFirst);
      expect(lastFinished(session.received)).toMatchObject({
        runId: secondRun,
        reason: 'completed',
        reply: 'It cost 42.',
      });
      const secondPrompt = serializeLoosely(model.requests[2]?.messages);
      expect(secondPrompt).toContain('last order?');
      expect(secondPrompt).toContain('It was o-1.');
      expect(secondPrompt).toContain(
        `[tool result ${firstRun}:c1] ok: Order o-1 for 42`,
      );
    });
  });

  describe('run control and resolution', () => {
    test.todo(
      'cancelling the active run finishes it as cancelled, drops its late output and starts the queued run',
    );
    test.todo(
      'an agent run needs no ui_applied and a stray one changes nothing',
    );
    test.todo(
      'closing the connection mid-run aborts the tool signal and emits nothing further',
    );
    test.todo(
      'a budget resolver runs once per run before started and a per-run override only tightens',
    );
    test.todo(
      'a model factory runs once per run and its adapter serves every turn',
    );
    test.todo(
      'a throwing resolver or factory ends the run as error without started and the queue continues',
    );
    test.todo(
      'finished metrics and the observed metadata match the scripted usage',
    );
    test.todo('without an agent slot the UI-only route is unchanged');
  });
});

interface SessionInternals {
  readonly queue: AgentRunQueue;
  readonly transcript: Transcript;
  readonly toolResults: ToolResultStore;
}

interface StalledCall {
  signal?: AbortSignal;
  closed: boolean;
}

function openAgentSession(
  overrides: {
    readonly time?: FakeAgentRunTime;
    readonly model?: AgentConfig['model'];
    readonly tools?: AgentConfig['tools'];
    readonly budgets?: Partial<AgentRunBudgets>;
  } = {},
) {
  const time = overrides.time ?? createFakeAgentRunTime();
  const received: AgentEvent[] = [];
  const user = { id: USER_SENTINEL };
  let plannerCalls = 0;
  const createdBefore = sessionInternals.length;
  const engine = createEngine({
    logger: silentLogger,
    retry: false,
    planner: () => {
      plannerCalls += 1;
      return Promise.reject(new Error('the chart planner must not run'));
    },
    agent: {
      model: overrides.model ?? scriptedTextAdapter([]).adapter,
      instructions: 'You help pet shop customers.',
      tools: overrides.tools ?? [],
      budgets: { ...TEST_BUDGETS, ...overrides.budgets },
    },
  });
  const connection = engine.openConnection({
    sessionId: SessionId('agent-route'),
    user,
    token: TOKEN_SENTINEL,
    clock: time.clock.now,
    scheduleTimeout: time.clock.scheduleTimeout,
  });
  connection.subscribe((event) => {
    received.push(event);
  });
  const internals = sessionInternals[createdBefore];
  if (internals === undefined || sessionInternals.length !== createdBefore + 1)
    throw new Error('the connection did not create one agent run queue');
  return {
    connection,
    received,
    user,
    send: (input: AgentUtteranceInput) => connection.send(input),
    plannerCalls: () => plannerCalls,
    internals: () => internals,
  };
}

function orderTool(
  options: {
    readonly latestOrder?: (
      signal: AbortSignal,
    ) => Promise<typeof LATEST_ORDER>;
  } = {},
) {
  const contexts: { user: unknown; token?: string }[] = [];
  const args: unknown[] = [];
  const tool = serverTool({
    name: 'latest_order',
    description: 'Returns the latest order of the user',
    input: z.object({}),
    output: z.object({
      orderId: z.string(),
      total: z.number(),
      items: z.array(z.string()),
    }),
    sideEffect: 'read_only',
    execute: (input, ctx) => {
      args.push(input);
      contexts.push({ user: ctx.user, token: ctx.token });
      return (options.latestOrder ?? (() => Promise.resolve(LATEST_ORDER)))(
        ctx.signal,
      );
    },
    summarize: (output) => `Order ${output.orderId} for ${output.total}`,
  });
  return { tool, contexts, args };
}

function utterance(inputId: string, text: string): AgentUtteranceInput {
  return {
    type: 'utterance',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId(inputId),
    text,
    source: 'text',
    chart: makeTilingRequest(),
  };
}

function expectBudgetEnding(events: readonly AgentEvent[], runId: RunId) {
  const own = events.filter(
    (event) => 'runId' in event && event.runId === runId,
  );
  expect(own.slice(-2)).toEqual([
    {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId,
      turnId: `${runId}:close`,
      delta: BUDGET_CLOSING_MESSAGE,
    },
    expect.objectContaining({
      type: 'finished',
      runId,
      reason: 'budget',
      ok: false,
      reply: BUDGET_CLOSING_MESSAGE,
    }),
  ]);
  for (const event of own) {
    expect(AgentEventSchema.safeParse(event).success).toBe(true);
  }
}

function runIdOf(events: readonly AgentEvent[], inputId: string): RunId {
  for (const event of events) {
    if (
      event.type === 'accepted' &&
      event.inputId === inputId &&
      event.runId !== null
    ) {
      return event.runId;
    }
  }
  throw new Error(`no accepted event for ${inputId}`);
}

function lastFinished(events: readonly AgentEvent[]) {
  const last = events.filter((event) => event.type === 'finished').at(-1);
  if (last === undefined) throw new Error('no finished event');
  return last;
}

function lastFinishedOf(events: readonly AgentEvent[], runId: RunId) {
  return lastFinished(
    events.filter((event) => 'runId' in event && event.runId === runId),
  );
}

function stallingTurn(
  deltas: readonly string[],
  observed: StalledCall,
): ScriptedModelCall {
  return async function* (request) {
    const signal =
      request.request instanceof Request ? undefined : request.request?.signal;
    observed.signal = signal ?? undefined;
    try {
      yield {
        type: EventType.RUN_STARTED,
        runId: 'provider-run',
        threadId: 'provider-thread',
        timestamp: 0,
      } satisfies StreamChunk;
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
      await new Promise<void>((resolve) => {
        if (signal?.aborted === true) resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally {
      observed.closed = true;
    }
  };
}

function serializeLoosely(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'function') return undefined;
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return undefined;
        seen.add(item);
      }
      return item;
    }) ?? ''
  );
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error('condition never held');
}
