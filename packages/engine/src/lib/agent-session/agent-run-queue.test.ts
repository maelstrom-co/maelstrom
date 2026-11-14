import { describe, expect, test } from 'bun:test';

import {
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  type AgentUiAppliedInput,
  type AgentUtteranceInput,
  CallId,
  type ChangeId,
  type DiagnosticMetadata,
  InstanceId,
  type JsonValue,
  type MaelstromResponse,
  MessageId,
  ok,
  type RunId,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import { defer } from '../__test-helpers__/defer.js';
import { makeTilingRequest } from '../__test-helpers__/fixtures.js';
import type { Logger } from '../logger.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import {
  scriptedFailingTurn,
  scriptedTextAdapter,
  scriptedTextTurn,
  scriptedToolTurn,
  scriptedUsage,
} from './__test-helpers__/scripted-text-adapter.js';
import { type AgentConfig, resolveAgentConfig } from './agent-config.js';
import {
  type AgentRunStarter,
  createAgentRunQueue,
} from './agent-run-queue.js';
import {
  type AgentRunBudgets,
  type AgentRunEvent,
  BUDGET_CLOSING_MESSAGE,
  DEFAULT_AGENT_RUN_BUDGETS,
  runAgent,
} from './agent-run.js';
import { createOrderedEmitter } from './ordered-emitter.js';
import type { ShowPlanInput, ShowPlanner } from './planner-show-queue.js';
import { serverTool, ToolError } from './server-tool.js';
import { createToolResultStore } from './tool-result-store.js';
import { createTranscript, toolCallRef } from './transcript.js';

describe('agent run queue', () => {
  test('an utterance streams its opening, tool breadcrumbs, reply and real metrics in order', async () => {
    const time = createFakeAgentRunTime();
    const order = orderTool({
      latestOrder: () => {
        time.advance(250);
        return Promise.resolve(LATEST_ORDER);
      },
    });
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'c1', name: 'latest_order', args: {} }],
        scriptedUsage(10, 2),
      ),
      scriptedTextTurn(['Your order ', 'is o-1.'], scriptedUsage(4, 1)),
    ]);
    const session = createSession({
      time,
      model: model.adapter,
      tools: [order.tool],
    });

    await session.queue.enqueue(
      utterance('input-1', 'what was my last order?'),
    );

    const runId = runIdOf(session.received, 'input-1');
    expect(session.received).toEqual([
      {
        type: 'placeholder',
        version: AGENT_WIRE_VERSION,
        inputId: MessageId('input-1'),
        text: 'One moment.',
      },
      {
        type: 'accepted',
        version: AGENT_WIRE_VERSION,
        inputId: MessageId('input-1'),
        runId,
        disposition: 'agent',
        ack: 'On it.',
      },
      { type: 'started', version: AGENT_WIRE_VERSION, runId },
      {
        type: 'tool_call',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
      },
      {
        type: 'tool_result',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t1`,
        callId: CallId('c1'),
        name: 'latest_order',
        ok: true,
        summary: 'Order o-1',
      },
      {
        type: 'message',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t2`,
        delta: 'Your order ',
      },
      {
        type: 'message',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:t2`,
        delta: 'is o-1.',
      },
      {
        type: 'finished',
        version: AGENT_WIRE_VERSION,
        runId,
        ok: true,
        reason: 'completed',
        reply: 'Your order is o-1.',
        metrics: {
          turns: 2,
          toolCalls: 1,
          elapsedMs: 250,
          inputTokens: 14,
          outputTokens: 3,
        },
      },
    ]);
    expect(
      session.received.every(
        (event) => AgentEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
    expect(session.finishedMetadata()).toEqual([
      {
        reason: 'completed',
        outcome: 'succeeded',
        turns: 2,
        toolCalls: 1,
        elapsedMs: 250,
        inputTokens: 14,
        outputTokens: 3,
        unreportedUsageCalls: 0,
      },
    ]);
    expect(session.toolResults.get(toolCallRef(runId, CallId('c1')))).toEqual({
      callId: CallId('c1'),
      name: 'latest_order',
      ok: true,
      summary: 'Order o-1',
      value: LATEST_ORDER,
    });
    expect(session.queue.pendingRuns()).toBe(0);
  });

  test('identity reaches the tool context only, never a request, an event or the transcript', async () => {
    const order = orderTool();
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'c1', name: 'latest_order', args: {} }],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn(['Done.'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({
      model: model.adapter,
      tools: [order.tool],
    });

    await session.queue.enqueue(utterance('input-1', 'last order?'));

    expect(order.contexts).toHaveLength(1);
    expect(order.contexts[0]?.user).toBe(session.user);
    expect(order.contexts[0]?.token).toBe(TOKEN_SENTINEL);
    const surfaces = [
      ...model.requests.map(serializeLoosely),
      JSON.stringify(session.received),
      JSON.stringify(session.transcript.renderPriorMessages()),
      JSON.stringify(order.args),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(USER_SENTINEL);
      expect(surface).not.toContain(TOKEN_SENTINEL);
    }
  });

  test('elapsed time is measured from started, not from run setup', async () => {
    const time = createFakeAgentRunTime();
    const model = scriptedTextAdapter([
      scriptedTextTurn(['Hi.'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({
      time,
      model: () => {
        time.advance(40);
        return model.adapter;
      },
    });

    await session.queue.enqueue(utterance('input-1', 'hello'));

    expect(lastFinished(session.received).metrics.elapsedMs).toBe(0);
  });

  test('a run whose last turn has no text finishes completed with no reply and no message', async () => {
    const model = scriptedTextAdapter([
      scriptedTextTurn([], scriptedUsage(1, 1)),
    ]);
    const session = createSession({ model: model.adapter });

    await session.queue.enqueue(utterance('input-1', 'hello'));

    const runId = runIdOf(session.received, 'input-1');
    expect(
      eventsOf(session.received, runId).map((event) => event.type),
    ).toEqual(['accepted', 'started', 'finished']);
    const finished = lastFinished(session.received);
    expect(finished).toMatchObject({ ok: true, reason: 'completed' });
    expect(finished).not.toHaveProperty('reply');
    expect(AgentEventSchema.safeParse(finished).success).toBe(true);
  });

  test('the finished event reports the elapsed time the run froze, not time spent after it ended', async () => {
    const time = createFakeAgentRunTime();
    const startRun: AgentRunStarter = () =>
      (async function* (): AsyncGenerator<AgentRunEvent> {
        time.advance(325);
        yield {
          type: 'finished',
          reason: 'completed',
          reply: 'Done.',
          metrics: { ...ZERO_METRICS, elapsedMs: 250 },
          unreportedUsageCalls: 0,
        };
      })();
    const session = createSession({ time, startRun });

    await session.queue.enqueue(utterance('input-1', 'hello'));

    expect(lastFinished(session.received).metrics.elapsedMs).toBe(250);
    expect(session.finishedMetadata()).toMatchObject([{ elapsedMs: 250 }]);
  });

  test('a second utterance is accepted at once and starts only after the first finishes, building on its transcript', async () => {
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
      scriptedTextTurn(['It is o-1.'], scriptedUsage(1, 1)),
      scriptedTextTurn(['Total 42.'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({
      model: model.adapter,
      tools: [order.tool],
    });

    const first = session.queue.enqueue(utterance('input-1', 'last order?'));
    await toolStarted.promise;
    const second = session.queue.enqueue(
      utterance('input-2', 'and its total?'),
    );

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
    expect(session.queue.pendingRuns()).toBe(2);

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
      reply: 'Total 42.',
    });

    const secondPrompt = serializeLoosely(model.requests[2]?.messages);
    expect(secondPrompt).toContain('last order?');
    expect(secondPrompt).toContain('It is o-1.');
    expect(secondPrompt).toContain(`[tool call ${firstRun}:c1] latest_order`);
    expect(secondPrompt).toContain(
      `[tool result ${firstRun}:c1] ok: Order o-1`,
    );
    expect(secondPrompt).not.toContain('"total":42');
    expect(secondPrompt.split('and its total?')).toHaveLength(2);
  });

  test('cancelling the active run finishes it as cancelled, drops its late output and starts the queued run', async () => {
    const release = defer<void>();
    const toolStarted = defer<AbortSignal>();
    let calls = 0;
    const order = orderTool({
      latestOrder: async (signal) => {
        calls += 1;
        if (calls > 1) return LATEST_ORDER;
        toolStarted.resolve(signal);
        await release.promise;
        return LATEST_ORDER;
      },
    });
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'c1', name: 'latest_order', args: {} }],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn(['Next.'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({
      model: model.adapter,
      tools: [order.tool],
    });

    const first = session.queue.enqueue(utterance('input-1', 'last order?'));
    const toolSignal = await toolStarted.promise;
    const second = session.queue.enqueue(
      utterance('input-2', 'something else'),
    );
    const firstRun = runIdOf(session.received, 'input-1');
    session.queue.cancelRun(firstRun);
    await Promise.all([first, second]);
    release.resolve();
    await flushMacrotasks();

    expect(toolSignal.aborted).toBe(true);
    expect(
      eventsOf(session.received, firstRun).map((event) => event.type),
    ).toEqual(['accepted', 'started', 'tool_call', 'finished']);
    const cancelled = session.received.find(
      (event) => event.type === 'finished' && event.runId === firstRun,
    );
    expect(cancelled).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(cancelled).not.toHaveProperty('reply');
    expect(lastFinished(session.received)).toMatchObject({
      runId: runIdOf(session.received, 'input-2'),
      reason: 'completed',
      reply: 'Next.',
    });
    const secondPrompt = serializeLoosely(model.requests[1]?.messages);
    expect(secondPrompt).toContain(`[run ${firstRun} ended: cancelled]`);
    expect(secondPrompt).not.toContain('[tool result');
  });

  test('a delta and a tool result a cancelled run yields after the abort never reach the wire or the transcript', async () => {
    const transcript = createTranscript();
    const startRun: AgentRunStarter = (input, { signal }) =>
      (async function* (): AsyncGenerator<AgentRunEvent> {
        yield { type: 'message', turnId: `${input.runId}:t1`, delta: 'early ' };
        await new Promise((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
        yield { type: 'message', turnId: `${input.runId}:t1`, delta: 'LATE' };
        yield {
          type: 'tool_result',
          turnId: `${input.runId}:t1`,
          callId: CallId('c9'),
          name: 'latest_order',
          ok: true,
          summary: 'LATE RESULT',
        };
        yield {
          type: 'finished',
          reason: 'cancelled',
          cause: signal.reason,
          metrics: { ...ZERO_METRICS, turns: 1 },
          unreportedUsageCalls: 0,
        };
      })();
    const session = createSession({ startRun, transcript });

    const run = session.queue.enqueue(utterance('input-1', 'hi'));
    const runId = runIdOf(session.received, 'input-1');
    await waitUntil(() =>
      session.received.some((event) => event.type === 'message'),
    );
    session.queue.cancelRun(runId);
    await run;

    expect(eventsOf(session.received, runId)).toEqual([
      expect.objectContaining({ type: 'accepted' }),
      expect.objectContaining({ type: 'started' }),
      expect.objectContaining({ type: 'message', delta: 'early ' }),
      expect.objectContaining({
        type: 'finished',
        reason: 'cancelled',
        ok: false,
        metrics: expect.objectContaining({ turns: 1 }),
      }),
    ]);
    const rendered = JSON.stringify(transcript.renderPriorMessages());
    expect(rendered).not.toContain('LATE');
    expect(rendered).toContain('early ');
  });

  test('cancelling a queued run finishes it as cancelled without starting it', async () => {
    const release = defer<void>();
    const startRun: AgentRunStarter = (input) =>
      (async function* (): AsyncGenerator<AgentRunEvent> {
        await release.promise;
        yield { type: 'message', turnId: `${input.runId}:t1`, delta: 'ok' };
        yield {
          type: 'finished',
          reason: 'completed',
          reply: 'ok',
          metrics: ZERO_METRICS,
          unreportedUsageCalls: 0,
        };
      })();
    const session = createSession({ startRun });

    const first = session.queue.enqueue(utterance('input-1', 'one'));
    const second = session.queue.enqueue(utterance('input-2', 'two'));
    const secondRun = runIdOf(session.received, 'input-2');
    session.queue.cancelRun(secondRun);
    await second;
    expect(session.queue.pendingRuns()).toBe(1);
    release.resolve();
    await first;

    expect(
      eventsOf(session.received, secondRun).map((event) => event.type),
    ).toEqual(['accepted', 'finished']);
    const cancelled = eventsOf(session.received, secondRun).find(
      (event) => event.type === 'finished',
    );
    expect(cancelled).toMatchObject({ reason: 'cancelled', ok: false });
    expect(cancelled).not.toHaveProperty('reply');
  });

  test('cancelling the active run while its setup is pending finishes it as cancelled and starts the queued run', async () => {
    const model = scriptedTextAdapter([
      scriptedTextTurn(['Second works.'], scriptedUsage(1, 1)),
    ]);
    const setupStarted = defer<void>();
    let setups = 0;
    const session = createSession({
      model: () => {
        setups += 1;
        if (setups > 1) return model.adapter;
        setupStarted.resolve();
        return new Promise<never>(() => {});
      },
    });

    const first = session.queue.enqueue(utterance('input-1', 'one'));
    const second = session.queue.enqueue(utterance('input-2', 'two'));
    await setupStarted.promise;
    const firstRun = runIdOf(session.received, 'input-1');
    session.queue.cancelRun(firstRun);
    await Promise.all([first, second]);

    expect(eventsOf(session.received, firstRun)).toEqual([
      expect.objectContaining({ type: 'accepted' }),
      expect.objectContaining({
        type: 'finished',
        ok: false,
        reason: 'cancelled',
        metrics: ZERO_METRICS,
      }),
    ]);
    expect(lastFinishedOf(session.received, firstRun)).not.toHaveProperty(
      'reply',
    );
    const secondRun = runIdOf(session.received, 'input-2');
    expect(
      eventsOf(session.received, secondRun).map((event) => event.type),
    ).toEqual(['accepted', 'started', 'message', 'finished']);
    expect(lastFinished(session.received)).toMatchObject({
      runId: secondRun,
      reason: 'completed',
      reply: 'Second works.',
    });
    expect(session.queue.pendingRuns()).toBe(0);
  });

  test('a setup that rejects after the run was cancelled still finishes as cancelled', async () => {
    const setup = defer<never>();
    const setupStarted = defer<void>();
    const errors: unknown[] = [];
    const session = createSession({
      logger: {
        ...silentLogger,
        error: (_message, error) => errors.push(error),
      },
      model: () => {
        setupStarted.resolve();
        return setup.promise;
      },
    });

    const run = session.queue.enqueue(utterance('input-1', 'one'));
    await setupStarted.promise;
    const runId = runIdOf(session.received, 'input-1');
    session.queue.cancelRun(runId);
    await flushMacrotasks();
    const emittedBeforeRejection = session.received.length;
    setup.reject(new Error('late setup failure'));
    await run;
    await flushMacrotasks();

    const finished = session.received.filter(
      (event) => event.type === 'finished',
    );
    expect(finished).toEqual([
      expect.objectContaining({ runId, ok: false, reason: 'cancelled' }),
    ]);
    expect(JSON.stringify(session.received)).not.toContain('setup_failed');
    expect(errors).toEqual([]);
    expect(session.received).toHaveLength(emittedBeforeRejection);
  });

  test('closing mid-run aborts the tool and emits nothing further, not even finished', async () => {
    const release = defer<void>();
    const toolStarted = defer<AbortSignal>();
    const order = orderTool({
      latestOrder: async (signal) => {
        toolStarted.resolve(signal);
        await release.promise;
        return LATEST_ORDER;
      },
    });
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'c1', name: 'latest_order', args: {} }],
        scriptedUsage(1, 1),
      ),
      scriptedTextTurn(['never'], scriptedUsage(1, 1)),
      scriptedTextTurn(['never'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({
      model: model.adapter,
      tools: [order.tool],
    });

    const first = session.queue.enqueue(utterance('input-1', 'last order?'));
    const toolSignal = await toolStarted.promise;
    const second = session.queue.enqueue(utterance('input-2', 'queued'));
    const before = session.received.length;
    session.queue.close();
    await Promise.all([first, second]);
    release.resolve();
    await flushMacrotasks();

    expect(toolSignal.aborted).toBe(true);
    expect(session.received).toHaveLength(before);
    expect(session.received.some((event) => event.type === 'finished')).toBe(
      false,
    );
    expect(model.requests).toHaveLength(1);
    expect(session.queue.pendingRuns()).toBe(0);
  });

  test('closing returns the active run iterator after aborting its signal', async () => {
    const closed = defer<boolean>();
    const startRun: AgentRunStarter = (_input, { signal }) =>
      (async function* (): AsyncGenerator<AgentRunEvent> {
        try {
          yield { type: 'message', turnId: 't', delta: 'first' };
          await new Promise((resolve) => {
            signal.addEventListener('abort', resolve, { once: true });
          });
          yield { type: 'message', turnId: 't', delta: 'after abort' };
        } finally {
          closed.resolve(signal.aborted);
        }
      })();
    const session = createSession({ startRun });

    const run = session.queue.enqueue(utterance('input-1', 'hi'));
    await waitUntil(() =>
      session.received.some((event) => event.type === 'message'),
    );
    session.queue.close();
    await run;

    expect(await closed.promise).toBe(true);
    expect(session.received.map((event) => event.type)).toEqual([
      'placeholder',
      'accepted',
      'started',
      'message',
    ]);
  });

  test.each([
    ['model factory', 'model'],
    ['budget resolver', 'budgets'],
    ['model factory returning a non-adapter', 'adapter'],
  ] as const)(
    'a failing %s ends the run with a sanitized error after accepted and without started, and the next run starts',
    async (_label, failing) => {
      const model = scriptedTextAdapter([
        scriptedTextTurn(['Second works.'], scriptedUsage(1, 1)),
      ]);
      let setups = 0;
      const explode = () => {
        setups += 1;
        if (setups === 1) throw new Error('SECRET internal detail');
      };
      const errors: unknown[] = [];
      const session = createSession({
        logger: {
          ...silentLogger,
          error: (_message, error) => errors.push(error),
        },
        ...(failing === 'model'
          ? {
              model: () => {
                explode();
                return model.adapter;
              },
            }
          : failing === 'adapter'
            ? {
                model: () => {
                  setups += 1;
                  return setups === 1
                    ? ({ secret: 'SECRET' } as unknown as typeof model.adapter)
                    : model.adapter;
                },
              }
            : {
                model: model.adapter,
                budgets: () => {
                  explode();
                  return {};
                },
              }),
      });

      const first = session.queue.enqueue(utterance('input-1', 'one'));
      const second = session.queue.enqueue(utterance('input-2', 'two'));
      await Promise.all([first, second]);

      const firstRun = runIdOf(session.received, 'input-1');
      const secondRun = runIdOf(session.received, 'input-2');
      expect(eventsOf(session.received, firstRun)).toEqual([
        expect.objectContaining({ type: 'accepted' }),
        {
          type: 'finished',
          version: AGENT_WIRE_VERSION,
          runId: firstRun,
          ok: false,
          reason: 'error',
          code: 'setup_failed',
          error: 'The agent run could not start.',
          metrics: ZERO_METRICS,
        },
      ]);
      expect(lastFinishedOf(session.received, firstRun)).not.toHaveProperty(
        'reply',
      );
      expect(JSON.stringify(session.received)).not.toContain('SECRET');
      expect(errors).toHaveLength(1);
      expect(
        eventsOf(session.received, secondRun).map((event) => event.type),
      ).toEqual(['accepted', 'started', 'message', 'finished']);
      expect(lastFinished(session.received)).toMatchObject({
        runId: secondRun,
        reason: 'completed',
      });
    },
  );

  test.each([
    ['model factory', 'model', TEST_BUDGETS.maxElapsedMs],
    ['budget resolver', 'budgets', DEFAULT_AGENT_RUN_BUDGETS.maxElapsedMs],
  ] as const)(
    'a %s that never settles ends the run as setup_failed at the elapsed deadline, and the next run starts',
    async (_label, hanging, deadlineMs) => {
      const time = createFakeAgentRunTime();
      const model = scriptedTextAdapter([
        scriptedTextTurn(['Second works.'], scriptedUsage(1, 1)),
      ]);
      const setupStarted = defer<void>();
      let setups = 0;
      const hang = <T>(settled: T): T | Promise<T> => {
        setups += 1;
        if (setups > 1) return settled;
        setupStarted.resolve();
        return new Promise<never>(() => {});
      };
      const session = createSession({
        time,
        ...(hanging === 'model'
          ? { model: () => hang(model.adapter) }
          : { model: model.adapter, budgets: () => hang(TEST_BUDGETS) }),
      });

      const first = session.queue.enqueue(utterance('input-1', 'one'));
      const second = session.queue.enqueue(utterance('input-2', 'two'));
      await setupStarted.promise;
      const firstRun = runIdOf(session.received, 'input-1');
      time.advance(deadlineMs - 1);
      await flushMacrotasks();
      expect(eventsOf(session.received, firstRun)).toHaveLength(1);
      time.advance(1);
      await Promise.all([first, second]);

      expect(eventsOf(session.received, firstRun)).toEqual([
        expect.objectContaining({ type: 'accepted' }),
        expect.objectContaining({
          type: 'finished',
          ok: false,
          reason: 'error',
          code: 'setup_failed',
        }),
      ]);
      expect(lastFinishedOf(session.received, firstRun)).not.toHaveProperty(
        'reply',
      );
      const secondRun = runIdOf(session.received, 'input-2');
      expect(
        eventsOf(session.received, secondRun).map((event) => event.type),
      ).toEqual(['accepted', 'started', 'message', 'finished']);
      expect(lastFinished(session.received)).toMatchObject({
        runId: secondRun,
        reason: 'completed',
      });
    },
  );

  test('a run out of turns sends the closing message, finishes as budget and shows both to the next run', async () => {
    const order = orderTool();
    const model = scriptedTextAdapter([
      scriptedToolTurn(
        [{ id: 'c1', name: 'latest_order', args: {} }],
        scriptedUsage(3, 1),
      ),
      scriptedTextTurn(['Fine.'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({
      model: model.adapter,
      tools: [order.tool],
      budgets: { maxTurns: 1 },
    });

    await session.queue.enqueue(utterance('input-1', 'last order?'));
    const runId = runIdOf(session.received, 'input-1');

    expect(eventsOf(session.received, runId).slice(-2)).toEqual([
      {
        type: 'message',
        version: AGENT_WIRE_VERSION,
        runId,
        turnId: `${runId}:close`,
        delta: BUDGET_CLOSING_MESSAGE,
      },
      {
        type: 'finished',
        version: AGENT_WIRE_VERSION,
        runId,
        ok: false,
        reason: 'budget',
        reply: BUDGET_CLOSING_MESSAGE,
        metrics: {
          turns: 1,
          toolCalls: 0,
          elapsedMs: 0,
          inputTokens: 3,
          outputTokens: 1,
        },
      },
    ]);
    expect(
      session.received.filter(
        (event) =>
          event.type === 'message' && event.turnId === `${runId}:close`,
      ),
    ).toHaveLength(1);
    expect(order.contexts).toHaveLength(0);
    expect(session.finishedMetadata()[0]).toMatchObject({
      reason: 'budget',
      outcome: 'failed',
      limit: 'turns',
      unreportedUsageCalls: 0,
    });

    await session.queue.enqueue(utterance('input-2', 'again'));
    const nextPrompt = serializeLoosely(model.requests[1]?.messages);
    expect(nextPrompt).toContain(
      `[closing message ${runId}] ${BUDGET_CLOSING_MESSAGE}`,
    );
    expect(nextPrompt).toContain(`[run ${runId} ended: budget, limit turns]`);
  });

  test('a model failing after some text keeps the deltas, finishes as error with no reply and marks the partial text for the next run', async () => {
    const model = scriptedTextAdapter([
      scriptedFailingTurn(['Partial '], 'SECRET upstream failure'),
      scriptedTextTurn(['Recovered.'], scriptedUsage(1, 1)),
    ]);
    const session = createSession({ model: model.adapter });

    await session.queue.enqueue(utterance('input-1', 'tell me'));
    const runId = runIdOf(session.received, 'input-1');

    expect(
      eventsOf(session.received, runId).map((event) => event.type),
    ).toEqual(['accepted', 'started', 'message', 'finished']);
    expect(lastFinished(session.received)).toMatchObject({
      ok: false,
      reason: 'error',
      code: 'provider_error',
    });
    expect(lastFinished(session.received)).not.toHaveProperty('reply');
    expect(JSON.stringify(session.received)).not.toContain('SECRET');

    await session.queue.enqueue(utterance('input-2', 'again'));
    const nextPrompt = serializeLoosely(model.requests[1]?.messages);
    expect(nextPrompt).toContain('Partial ');
    expect(nextPrompt).toContain(
      `[run ${runId} ended: error provider_error, The model could not respond., reply above is partial]`,
    );
  });

  describe('a tool still running after its run ended', () => {
    test.each([
      ['deadline', 'budget'],
      ['cancel', 'cancelled'],
    ] as const)(
      'after a %s the ending is emitted at once and the next run waits until a non-idempotent tool that ignores its abort settles',
      async (trigger, reason) => {
        const time = createFakeAgentRunTime();
        const release = defer<void>();
        const toolStarted = defer<AbortSignal>();
        const charge = chargeTool(async (signal) => {
          toolStarted.resolve(signal);
          await release.promise;
          return { charged: true };
        });
        const model = scriptedTextAdapter([
          scriptedToolTurn(
            [{ id: 'c1', name: 'charge_card', args: {} }],
            scriptedUsage(1, 1),
          ),
          scriptedTextTurn(['Next.'], scriptedUsage(1, 1)),
        ]);
        const session = createSession({
          time,
          model: model.adapter,
          tools: [charge.tool],
          budgets: { maxElapsedMs: 100 },
        });

        const first = session.queue.enqueue(utterance('input-1', 'charge me'));
        const toolSignal = await toolStarted.promise;
        const second = session.queue.enqueue(utterance('input-2', 'and now?'));
        const firstRun = runIdOf(session.received, 'input-1');
        const secondRun = runIdOf(session.received, 'input-2');
        if (trigger === 'deadline') time.advance(100);
        else session.queue.cancelRun(firstRun);
        await first;
        for (let flush = 0; flush < 5; flush += 1) await flushMacrotasks();

        expect(toolSignal.aborted).toBe(true);
        expect(charge.settled()).toBe(false);
        expect(
          session.received.find(
            (event) => event.type === 'finished' && event.runId === firstRun,
          ),
        ).toMatchObject({ ok: false, reason });
        expect(
          eventsOf(session.received, secondRun).map((event) => event.type),
        ).toEqual(['accepted']);
        expect(model.requests).toHaveLength(1);
        expect(session.queue.pendingRuns()).toBe(1);

        release.resolve();
        await second;

        expect(charge.settled()).toBe(true);
        expect(
          eventsOf(session.received, secondRun).map((event) => event.type),
        ).toEqual(['accepted', 'started', 'message', 'finished']);
        expect(lastFinished(session.received)).toMatchObject({
          runId: secondRun,
          reason: 'completed',
          reply: 'Next.',
        });
      },
    );

    test('a read-only tool that ignores its abort does not hold back the next run', async () => {
      const time = createFakeAgentRunTime();
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
        scriptedTextTurn(['Next.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        time,
        model: model.adapter,
        tools: [order.tool],
        budgets: { maxElapsedMs: 100 },
      });

      const first = session.queue.enqueue(utterance('input-1', 'last order?'));
      await toolStarted.promise;
      const second = session.queue.enqueue(utterance('input-2', 'and now?'));
      time.advance(100);
      await Promise.all([first, second]);

      expect(lastFinished(session.received)).toMatchObject({
        runId: runIdOf(session.received, 'input-2'),
        reason: 'completed',
        reply: 'Next.',
      });
      release.resolve();
    });

    test('a run that completes normally starts the next run without waiting', async () => {
      const charge = chargeTool(() => Promise.resolve({ charged: true }));
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'charge_card', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['Charged.'], scriptedUsage(1, 1)),
        scriptedTextTurn(['Next.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        model: model.adapter,
        tools: [charge.tool],
      });

      const first = session.queue.enqueue(utterance('input-1', 'charge me'));
      const second = session.queue.enqueue(utterance('input-2', 'and now?'));
      await Promise.all([first, second]);

      expect(
        session.received
          .filter((event) => event.type === 'finished')
          .map((event) => [event.runId, event.reason]),
      ).toEqual([
        [runIdOf(session.received, 'input-1'), 'completed'],
        [runIdOf(session.received, 'input-2'), 'completed'],
      ]);
    });

    test('closing while the next run waits drops it and emits nothing once the tool settles', async () => {
      const time = createFakeAgentRunTime();
      const release = defer<void>();
      const toolStarted = defer<void>();
      const charge = chargeTool(async () => {
        toolStarted.resolve();
        await release.promise;
        return { charged: true };
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'charge_card', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['never'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        time,
        model: model.adapter,
        tools: [charge.tool],
        budgets: { maxElapsedMs: 100 },
      });

      const first = session.queue.enqueue(utterance('input-1', 'charge me'));
      await toolStarted.promise;
      const second = session.queue.enqueue(utterance('input-2', 'and now?'));
      time.advance(100);
      await first;
      const before = session.received.length;
      session.queue.close();
      await second;
      release.resolve();
      for (let flush = 0; flush < 5; flush += 1) await flushMacrotasks();

      expect(session.received).toHaveLength(before);
      expect(model.requests).toHaveLength(1);
      expect(session.queue.pendingRuns()).toBe(0);
    });

    test('a settlement that rejects still lets the next run start', async () => {
      const release = defer<void>();
      let runs = 0;
      const startRun: AgentRunStarter = () =>
        (async function* (): AsyncGenerator<AgentRunEvent> {
          runs += 1;
          const finished: AgentRunEvent = {
            type: 'finished',
            reason: 'completed',
            reply: 'Done.',
            metrics: ZERO_METRICS,
            unreportedUsageCalls: 0,
          };
          if (runs === 1) {
            Object.defineProperty(finished, 'toolsSettled', {
              value: release.promise.then(() => {
                throw new Error('settlement failed');
              }),
              enumerable: false,
            });
          }
          yield finished;
        })();
      const session = createSession({ startRun });

      const first = session.queue.enqueue(utterance('input-1', 'hi'));
      const second = session.queue.enqueue(utterance('input-2', 'again'));
      await first;
      await flushMacrotasks();
      const secondRun = runIdOf(session.received, 'input-2');
      expect(
        eventsOf(session.received, secondRun).map((event) => event.type),
      ).toEqual(['accepted']);

      release.resolve();
      await second;

      expect(
        eventsOf(session.received, secondRun).map((event) => event.type),
      ).toEqual(['accepted', 'started', 'finished']);
    });
  });

  describe('loop-driven shows', () => {
    test('a tool phase with a successful result records the queued note and requests one show for the utterance', async () => {
      const order = orderTool({
        intentFacts: (output) => ({ orderId: output.orderId }),
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));

      const runId = runIdOf(session.received, 'input-1');
      expect(session.showPlans).toHaveLength(1);
      const [plan] = session.showPlans;
      expect(plan).toMatchObject({
        runId,
        inputId: MessageId('input-1'),
        turnId: `${runId}:t1`,
      });
      expect(plan?.request.skipReply).toBe(true);
      expect(plan?.request.intentFacts).toEqual({
        'latest_order:c1': { orderId: 'o-1' },
      });
      expect(plan?.request.context.updateReasons).toEqual([
        { type: 'user_intent', intent: 'show my last order' },
      ]);
      expect(renderedTranscript(session.transcript)).toContain(
        `[show ${runId}:t1] Show queued: latest_order result.`,
      );
    });

    test('a tool phase whose only result failed requests no show and writes no note', async () => {
      const order = orderTool({
        latestOrder: () => Promise.reject(new ToolError('No orders yet.')),
      });
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['You have no orders.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        model: model.adapter,
        tools: [order.tool],
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));
      await flushMacrotasks();

      expect(session.showPlans).toHaveLength(0);
      expect(renderedTranscript(session.transcript)).not.toContain('[show ');
    });

    test('an acknowledgement reaches the show queue, which writes the screen note or refuses an unknown change', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        model: model.adapter,
        tools: [orderTool().tool],
        planShow: (input) =>
          Promise.resolve(
            ok({ type: 'response', response: showResponse(input, 1) }),
          ),
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));
      await waitUntil(() =>
        session.received.some((event) => event.type === 'ui_change'),
      );
      const change = session.received.find(
        (event) => event.type === 'ui_change',
      );
      if (change?.type !== 'ui_change') throw new Error('no ui_change');
      const runId = runIdOf(session.received, 'input-1');
      expect(change.runId).toBe(runId);

      session.queue.acknowledge(applied(change.changeId, 1));
      expect(renderedTranscript(session.transcript)).toContain(
        `[show ${runId}:t1] Screen updated: ran addEvent on calendar`,
      );

      const before = session.received.length;
      session.queue.acknowledge(applied(change.changeId, 1));
      expect(session.received.slice(before)).toEqual([
        {
          type: 'error',
          version: AGENT_WIRE_VERSION,
          changeId: change.changeId,
          code: 'unknown_change',
          error: 'Unknown UI change.',
        },
      ]);
    });

    test('the run finishes while its show is still planning', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        model: model.adapter,
        tools: [orderTool().tool],
        planShow: () => new Promise(() => {}),
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));

      expect(session.showPlans).toHaveLength(1);
      expect(model.requests).toHaveLength(2);
      expect(lastFinished(session.received)).toMatchObject({
        reason: 'completed',
        reply: 'It was o-1.',
      });
      expect(session.queue.pendingRuns()).toBe(0);
    });

    test('closing the queue leaves the show in flight unaborted and emits no later change', async () => {
      const planned = defer<void>();
      const outcome = defer<MaelstromResponse>();
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const session = createSession({
        model: model.adapter,
        tools: [orderTool().tool],
        planShow: async () => {
          planned.resolve();
          return ok({ type: 'response', response: await outcome.promise });
        },
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));
      await planned.promise;
      session.queue.close();
      const [plan] = session.showPlans;
      if (plan === undefined) throw new Error('no show planned');
      expect(plan.signal.aborted).toBe(false);
      outcome.resolve(showResponse(plan, 1));
      await flushMacrotasks();

      expect(session.received.some((event) => event.type === 'ui_change')).toBe(
        false,
      );
    });

    test('a show note recorded before a run renders its prior messages stays there alone, and one recorded after is taken once', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const parked: {
        input: Parameters<AgentRunStarter>[0];
        options: Parameters<AgentRunStarter>[1];
      }[] = [];
      let starts = 0;
      const startRun: AgentRunStarter = (input, options) => {
        starts += 1;
        if (starts === 1) return runAgent(input, options);
        parked.push({ input, options });
        return untilAborted(options.signal);
      };
      const session = createSession({
        model: model.adapter,
        tools: [orderTool().tool],
        startRun,
        planShow: (input) =>
          Promise.resolve(
            ok({ type: 'response', response: showResponse(input, 1) }),
          ),
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));
      await waitUntil(() =>
        session.received.some((event) => event.type === 'ui_change'),
      );
      const second = session.queue.enqueue(utterance('input-2', 'and now?'));
      await waitUntil(() => parked.length === 1);
      const [run] = parked;
      if (run === undefined) throw new Error('second run never started');
      const firstRun = runIdOf(session.received, 'input-1');
      const queuedNote = `[show ${firstRun}:t1] Show queued: latest_order result.`;
      expect(serializeLoosely(run.input.priorMessages)).toContain(queuedNote);
      expect(run.options.takeSessionNotes?.()).toEqual([]);

      const change = session.received.find(
        (event) => event.type === 'ui_change',
      );
      if (change?.type !== 'ui_change') throw new Error('no ui_change');
      session.queue.acknowledge(applied(change.changeId, 1));

      expect(run.options.takeSessionNotes?.()).toEqual([
        expect.stringMatching(
          new RegExp(`^\\[show ${firstRun}:t1\\] Screen updated: `),
        ),
      ]);
      expect(run.options.takeSessionNotes?.()).toEqual([]);
      expect(serializeLoosely(run.input.priorMessages)).not.toContain(
        'Screen updated:',
      );
      session.queue.cancelRun(runIdOf(session.received, 'input-2'));
      await second;
    });

    test('cancelling the active run drops its queued shows with cancelled notes and keeps its sent change awaiting acknowledgement', async () => {
      const startRun: AgentRunStarter = (input, { signal }) =>
        (async function* (): AsyncGenerator<AgentRunEvent> {
          for (const turn of [1, 2, 3]) {
            yield {
              type: 'tool_phase_ended',
              turnId: `${input.runId}:t${turn}`,
              results: [
                {
                  callId: CallId(`c${turn}`),
                  name: 'latest_order',
                  ok: true,
                  summary: 'Order o-1',
                  value: LATEST_ORDER,
                },
              ],
            };
          }
          yield* untilAborted(signal);
        })();
      const session = createSession({
        tools: [orderTool().tool],
        startRun,
        planShow: (input) =>
          Promise.resolve(
            ok({ type: 'response', response: showResponse(input, 1) }),
          ),
      });

      const run = session.queue.enqueue(utterance('input-1', 'show it'));
      await waitUntil(() =>
        session.received.some((event) => event.type === 'ui_change'),
      );
      const runId = runIdOf(session.received, 'input-1');
      session.queue.cancelRun(runId);
      await run;

      const transcript = renderedTranscript(session.transcript);
      expect(transcript).toContain(
        `[show ${runId}:t2] Show cancelled: latest_order result.`,
      );
      expect(transcript).toContain(
        `[show ${runId}:t3] Show cancelled: latest_order result.`,
      );
      expect(session.showPlans).toHaveLength(1);

      const change = session.received.find(
        (event) => event.type === 'ui_change',
      );
      if (change?.type !== 'ui_change') throw new Error('no ui_change');
      const before = session.received.length;
      session.queue.acknowledge(applied(change.changeId, 1));

      expect(session.received.slice(before)).toEqual([]);
      expect(renderedTranscript(session.transcript)).toContain(
        `[show ${runId}:t1] Screen updated: `,
      );
      expect(session.showPlans).toHaveLength(1);
    });

    test('a cancelled note for an evicted run that overflows the transcript bound never evicts the newest run', async () => {
      const model = scriptedTextAdapter([
        scriptedToolTurn(
          [{ id: 'c1', name: 'latest_order', args: {} }],
          scriptedUsage(1, 1),
        ),
        scriptedTextTurn(['It was o-1.'], scriptedUsage(1, 1)),
      ]);
      const parked: Parameters<AgentRunStarter>[0][] = [];
      let starts = 0;
      const startRun: AgentRunStarter = (input, options) => {
        starts += 1;
        if (starts === 1) return runAgent(input, options);
        parked.push(input);
        return untilAborted(options.signal);
      };
      const transcript = createTranscript({ maxChars: 230 });
      const session = createSession({
        model: model.adapter,
        tools: [orderTool().tool],
        startRun,
        transcript,
        planShow: () => new Promise(() => {}),
      });

      await session.queue.enqueue(utterance('input-1', 'show my last order'));
      const firstRun = runIdOf(session.received, 'input-1');
      const second = session.queue.enqueue(
        utterance('input-2', 'x'.repeat(200)),
      );
      await waitUntil(() => parked.length === 1);
      expect(renderedTranscript(transcript)).not.toContain(firstRun);

      session.queue.cancelRun(firstRun);

      expect(transcript.renderPriorMessages()).toEqual([
        { role: 'user', content: 'x'.repeat(200) },
      ]);
      session.queue.cancelRun(runIdOf(session.received, 'input-2'));
      await second;
    });
  });
});

const USER_SENTINEL = 'USER-SENTINEL-42';
const TOKEN_SENTINEL = 'TOKEN-SENTINEL-42';
const LATEST_ORDER = { orderId: 'o-1', total: 42 };

const ZERO_METRICS = {
  turns: 0,
  toolCalls: 0,
  elapsedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
};

const TEST_BUDGETS: AgentRunBudgets = {
  maxTurns: 6,
  maxElapsedMs: 60_000,
  maxTokens: 1_000,
  maxToolCalls: 6,
};

const ACKNOWLEDGEMENT_TIMEOUT_MS = 30_000;

const nothingToShowPlanner: ShowPlanner = (input) =>
  Promise.resolve(ok({ type: 'response', response: showResponse(input, 0) }));

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface SessionOverrides {
  readonly model?: AgentConfig['model'];
  readonly tools?: AgentConfig['tools'];
  readonly budgets?: AgentConfig['budgets'];
  readonly time?: ReturnType<typeof createFakeAgentRunTime>;
  readonly logger?: Logger;
  readonly startRun?: AgentRunStarter;
  readonly transcript?: ReturnType<typeof createTranscript>;
  readonly planShow?: ShowPlanner;
}

function createSession(overrides: SessionOverrides = {}) {
  const time = overrides.time ?? createFakeAgentRunTime();
  const events = createOrderedEmitter<AgentEvent>();
  const received: AgentEvent[] = [];
  events.subscribe((event) => {
    received.push(event);
  });
  const observed: { kind: string; metadata: DiagnosticMetadata }[] = [];
  const transcript = overrides.transcript ?? createTranscript();
  const toolResults = createToolResultStore();
  const user = { id: USER_SENTINEL };
  const budgets = overrides.budgets;
  const showPlans: ShowPlanInput[] = [];
  const planShow = overrides.planShow ?? nothingToShowPlanner;
  const queue = createAgentRunQueue({
    agent: resolveAgentConfig({
      model: overrides.model ?? scriptedTextAdapter([]).adapter,
      instructions: 'You help pet shop customers.',
      tools: overrides.tools ?? [],
      budgets:
        typeof budgets === 'function'
          ? budgets
          : { ...TEST_BUDGETS, ...budgets },
    }),
    identity: { user, token: TOKEN_SENTINEL },
    events,
    observe: (_runId, _inputId, kind, metadata) => {
      observed.push({ kind, metadata });
    },
    logger: overrides.logger ?? silentLogger,
    clock: time.clock.now,
    scheduleTimeout: time.clock.scheduleTimeout,
    planShow: (input) => {
      showPlans.push(input);
      return planShow(input);
    },
    acknowledgementTimeoutMs: ACKNOWLEDGEMENT_TIMEOUT_MS,
    transcript,
    toolResults,
    ...(overrides.startRun === undefined
      ? {}
      : { startRun: overrides.startRun }),
  });
  return {
    queue,
    received,
    transcript,
    toolResults,
    user,
    showPlans,
    finishedMetadata: () =>
      observed
        .filter((entry) => entry.kind === 'engine.agent.run.finished')
        .map((entry) => entry.metadata),
  };
}

function orderTool(
  options: {
    readonly latestOrder?: (
      signal: AbortSignal,
    ) => Promise<typeof LATEST_ORDER>;
    readonly intentFacts?: (
      order: typeof LATEST_ORDER,
    ) => Readonly<Record<string, JsonValue>>;
  } = {},
) {
  const contexts: { user: unknown; token?: string }[] = [];
  const args: unknown[] = [];
  const tool = serverTool({
    name: 'latest_order',
    description: 'Returns the latest order of the user',
    input: z.object({}),
    output: z.object({ orderId: z.string(), total: z.number() }),
    sideEffect: 'read_only',
    execute: (input, ctx) => {
      args.push(input);
      contexts.push({ user: ctx.user, token: ctx.token });
      return (options.latestOrder ?? (() => Promise.resolve(LATEST_ORDER)))(
        ctx.signal,
      );
    },
    summarize: (output) => `Order ${output.orderId}`,
    ...(options.intentFacts === undefined
      ? {}
      : { intentFacts: options.intentFacts }),
  });
  return { tool, contexts, args };
}

function showResponse(
  input: ShowPlanInput,
  actions: number,
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: input.messageId,
    rationale: 'Show the order.',
    executionPlan: Array.from({ length: actions }, () => ({
      instanceId: InstanceId('calendar-main'),
      action: ActionName('addEvent'),
    })),
    layout: structuredClone(
      input.request.layout,
    ) as MaelstromResponse['layout'],
  };
}

function applied(changeId: ChangeId, outcomes: number): AgentUiAppliedInput {
  return {
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId,
    chart: makeTilingRequest(),
    actionOutcomes: Array.from({ length: outcomes }, () => ({ ok: true })),
  };
}

function renderedTranscript(
  transcript: ReturnType<typeof createTranscript>,
): string {
  return JSON.stringify(transcript.renderPriorMessages());
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

function eventsOf(events: readonly AgentEvent[], runId: RunId): AgentEvent[] {
  return events.filter((event) => 'runId' in event && event.runId === runId);
}

function lastFinished(events: readonly AgentEvent[]) {
  const finished = events.filter((event) => event.type === 'finished');
  const last = finished.at(-1);
  if (last === undefined) throw new Error('no finished event');
  return last;
}

function lastFinishedOf(events: readonly AgentEvent[], runId: RunId) {
  return lastFinished(eventsOf(events, runId));
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
    await flushMacrotasks();
  }
  throw new Error('condition never held');
}

function untilAborted(signal: AbortSignal): AsyncIterable<AgentRunEvent> {
  const aborted = new Promise((resolve) => {
    if (signal.aborted) resolve(undefined);
    signal.addEventListener('abort', resolve, { once: true });
  });
  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<AgentRunEvent>> => {
        await aborted;
        return { done: true, value: undefined };
      },
    }),
  };
}

function flushMacrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function chargeTool(
  execute: (signal: AbortSignal) => Promise<{ charged: boolean }>,
) {
  let settled = false;
  const tool = serverTool({
    name: 'charge_card',
    description: 'Charges the card of the user',
    input: z.object({}),
    output: z.object({ charged: z.boolean() }),
    sideEffect: 'non_idempotent',
    execute: async (_input, ctx) => {
      try {
        return await execute(ctx.signal);
      } finally {
        settled = true;
      }
    },
    summarize: (output) => (output.charged ? 'Charged' : 'Not charged'),
  });
  return { tool, settled: () => settled };
}
