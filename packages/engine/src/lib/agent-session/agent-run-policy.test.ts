import { describe, expect, test } from 'bun:test';

import { RunId } from '@maelstrom-co/protocol';
import {
  createUsageLedger,
  type ProviderCallRecord,
} from '@maelstrom-co/telemetry/usage-adapter';
import type {
  ChatMiddleware,
  ChatMiddlewareContext,
  ChatMiddlewarePhase,
  StreamChunk,
  ToolCallHookContext,
} from '@tanstack/ai';
import { z } from 'zod';

import { defer } from '../__test-helpers__/defer.js';
import type { Logger } from '../logger.js';
import { createFakeAgentRunTime } from './__test-helpers__/fake-agent-run-time.js';
import { summarizeAsTruncatedJson } from './__test-helpers__/summarize-as-truncated-json.js';
import {
  type AgentRunEnding,
  type AgentRunPolicy,
  type AgentRunPolicyRefusal,
  createAgentRunPolicy,
  createAgentRunPolicyMiddleware,
  NOT_RUN_TOOL_SUMMARY,
  notRunToolResult,
  STOPPED_TOOL_SUMMARY,
  stoppedToolResult,
} from './agent-run-policy.js';
import type { AgentRunBudgets, AgentRunGate } from './agent-run.js';
import { serverTool } from './server-tool.js';
import {
  toModelToolPayload,
  validateToolResultEnvelope,
} from './tool-executor.js';
import { createToolRegistry, type ToolRegistry } from './tool-registry.js';

const roomyBudgets: AgentRunBudgets = {
  maxTurns: 10,
  maxElapsedMs: 10_000,
  maxTokens: 1_000,
  maxToolCalls: 10,
};

describe('admission before chat()', () => {
  test.each([
    ['maxTurns', 'turns'],
    ['maxElapsedMs', 'elapsed'],
    ['maxTokens', 'tokens'],
    ['maxToolCalls', 'toolCalls'],
  ] as const)(
    'a zero %s ends the run with limit %s, zero metrics and no deadline timer',
    (budget, limit) => {
      const run = setup({ budgets: { ...roomyBudgets, [budget]: 0 } });

      expect(run.policy.start()).toEqual({ reason: 'budget', limit });
      expect(run.policy.ending).toEqual({ reason: 'budget', limit });
      expect(run.time.scheduled()).toEqual([]);
      expect(run.policy.metrics()).toEqual({
        metrics: {
          turns: 0,
          toolCalls: 0,
          elapsedMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        unreportedUsageCalls: 0,
      });
    },
  );

  test('an already aborted signal ends the run cancelled with its reason', () => {
    const caller = new AbortController();
    caller.abort('user left');
    const run = setup({ budgets: roomyBudgets, signal: caller.signal });

    expect(run.policy.start()).toEqual({
      reason: 'cancelled',
      cause: 'user left',
    });
    expect(run.time.scheduled()).toEqual([]);
    expect(run.policy.metrics().metrics.turns).toBe(0);
  });

  test('an admitted run arms the deadline timer for maxElapsedMs', () => {
    const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 250 } });

    expect(run.policy.start()).toBeUndefined();
    expect(run.policy.ending).toBeUndefined();
    expect(run.time.scheduled()).toEqual([250]);
  });

  test('an unbounded elapsed budget arms no timer', () => {
    const run = setup({
      budgets: { ...roomyBudgets, maxElapsedMs: Number.POSITIVE_INFINITY },
    });

    expect(run.policy.start()).toBeUndefined();
    expect(run.time.scheduled()).toEqual([]);
  });
});

describe('turn cap', () => {
  test('tools requested on the final allowed turn are refused with limit turns', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTurns: 3 } });
    run.policy.start();

    for (const callId of ['c1', 'c2']) {
      expect(await run.policy.beforeModelTurn()).toBe(true);
      run.policy.noteToolCallRequested(callId);
      expect(run.policy.beforeToolCall(callId)).toEqual({ admitted: true });
      expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(
        true,
      );
    }
    expect(await run.policy.beforeModelTurn()).toBe(true);
    run.policy.noteToolCallRequested('c3');
    run.policy.noteToolCallRequested('c4');

    const ending: AgentRunEnding = { reason: 'budget', limit: 'turns' };
    expect(run.policy.beforeToolCall('c3')).toEqual({
      admitted: false,
      ending,
    });
    expect(run.policy.beforeToolCall('c4')).toEqual({
      admitted: false,
      ending,
    });
    expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(
      false,
    );
    expect(run.policy.ending).toEqual(ending);
    expect(run.policy.metrics().metrics).toMatchObject({
      turns: 3,
      toolCalls: 2,
    });
  });

  test('a text answer on the final allowed turn does not latch a budget ending', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTurns: 1 } });
    run.policy.start();

    expect(await run.policy.beforeModelTurn()).toBe(true);
    run.policy.shouldStartNextTurn({ requestedTools: false });

    expect(run.policy.ending).toBeUndefined();
    expect(run.policy.latch({ reason: 'completed' })).toBe(true);
  });

  test('a model turn past maxTurns is refused before it starts', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTurns: 1 } });
    run.policy.start();

    expect(await run.policy.beforeModelTurn()).toBe(true);
    expect(await run.policy.beforeModelTurn()).toBe(false);

    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'turns' });
    expect(run.policy.abortController.signal.aborted).toBe(true);
    expect(run.policy.metrics().metrics.turns).toBe(1);
  });

  test('the next turn is refused once maxTurns turns are used', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTurns: 1 } });
    run.policy.start();
    await run.policy.beforeModelTurn();

    expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(
      false,
    );
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'turns' });
  });
});

describe('batch reservation', () => {
  test('a batch of three against two remaining tool calls runs none', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxToolCalls: 2 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    for (const callId of ['c1', 'c2', 'c3']) {
      run.policy.noteToolCallRequested(callId);
    }

    const ending: AgentRunEnding = { reason: 'budget', limit: 'toolCalls' };
    for (const callId of ['c1', 'c2', 'c3']) {
      expect(run.policy.beforeToolCall(callId)).toEqual({
        admitted: false,
        ending,
      });
    }
    expect(run.policy.metrics().metrics.toolCalls).toBe(0);
    expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(
      false,
    );
  });

  test('a batch of two within capacity runs sequentially', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxToolCalls: 2 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.noteToolCallRequested('c1');
    run.policy.noteToolCallRequested('c2');
    let balance = 0;
    const balances: number[] = [];

    for (const [callId, amount] of [
      ['c1', 1],
      ['c2', 2],
    ] as const) {
      if (run.policy.beforeToolCall(callId).admitted) {
        balance += amount;
        balances.push(balance);
      }
    }

    expect(balances).toEqual([1, 3]);
    expect(run.policy.ending).toBeUndefined();
    expect(run.policy.metrics().metrics.toolCalls).toBe(2);
  });

  test('a later batch that no longer fits the remaining calls runs none', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxToolCalls: 2 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.noteToolCallRequested('c1');
    expect(run.policy.beforeToolCall('c1')).toEqual({ admitted: true });
    run.policy.shouldStartNextTurn({ requestedTools: true });
    await run.policy.beforeModelTurn();
    run.policy.noteToolCallRequested('c2');
    run.policy.noteToolCallRequested('c3');

    expect(run.policy.beforeToolCall('c2')).toMatchObject({
      admitted: false,
      ending: { limit: 'toolCalls' },
    });
    expect(run.policy.metrics().metrics.toolCalls).toBe(1);
  });

  test('a call the stream never announced still counts as a batch of one', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxToolCalls: 1 } });
    run.policy.start();
    await run.policy.beforeModelTurn();

    expect(run.policy.beforeToolCall('c1')).toEqual({ admitted: true });
  });
});

describe('usage before tools', () => {
  test('a ledger at the token cap refuses the tool', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.recordProviderCall(call({ inputTokens: 7, outputTokens: 3 }));
    run.policy.noteToolCallRequested('c1');

    expect(run.policy.beforeToolCall('c1')).toEqual({
      admitted: false,
      ending: { reason: 'budget', limit: 'tokens' },
    });
  });

  test('a ledger over the token cap refuses the tool', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.recordProviderCall(call({ inputTokens: 9, outputTokens: 5 }));

    expect(run.policy.beforeToolCall('c1')).toMatchObject({
      admitted: false,
      ending: { limit: 'tokens' },
    });
  });

  test('unknown usage under a cap refuses the tool with usageUnknown', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.recordProviderCall(call(undefined));

    expect(run.policy.beforeToolCall('c1')).toEqual({
      admitted: false,
      ending: { reason: 'budget', limit: 'tokens', usageUnknown: true },
    });
  });

  test('unknown usage without a cap lets the tool run and metrics keep the known sums', async () => {
    const run = setup({
      budgets: { ...roomyBudgets, maxTokens: Number.POSITIVE_INFINITY },
    });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.recordProviderCall(call({ inputTokens: 4, outputTokens: 2 }));
    run.policy.recordProviderCall(call(undefined));

    expect(run.policy.beforeToolCall('c1')).toEqual({ admitted: true });
    expect(run.policy.metrics()).toMatchObject({
      metrics: { inputTokens: 4, outputTokens: 2 },
      unreportedUsageCalls: 1,
    });
  });

  test('cumulative usage of 6 then 6 against 10 allows the first tool and refuses the second', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();

    await run.policy.beforeModelTurn();
    run.policy.recordProviderCall(call({ inputTokens: 4, outputTokens: 2 }));
    run.policy.noteToolCallRequested('c1');
    expect(run.policy.beforeToolCall('c1')).toEqual({ admitted: true });
    expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(true);

    expect(await run.policy.beforeModelTurn()).toBe(true);
    run.policy.recordProviderCall(call({ inputTokens: 4, outputTokens: 2 }));
    run.policy.noteToolCallRequested('c2');
    expect(run.policy.beforeToolCall('c2')).toEqual({
      admitted: false,
      ending: { reason: 'budget', limit: 'tokens' },
    });
    expect(run.policy.metrics()).toMatchObject({
      metrics: { toolCalls: 1, inputTokens: 8, outputTokens: 4 },
    });
  });

  test('a spent token budget refuses the next model turn', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.recordProviderCall(call({ inputTokens: 8, outputTokens: 4 }));

    expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(
      false,
    );
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'tokens' });
  });
});

describe('provider calls within a turn', () => {
  test('the first call of a turn is admitted and a retry is refused once the ledger meets the cap', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();
    await run.policy.beforeModelTurn();

    expect(run.policy.beforeProviderCall()).toBe(true);
    run.policy.recordProviderCall(call({ inputTokens: 8, outputTokens: 4 }));

    expect(run.policy.beforeProviderCall()).toBe(false);
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'tokens' });
    expect(run.policy.abortController.signal.aborted).toBe(true);
    expect(run.policy.metrics().metrics.turns).toBe(1);
  });

  test('a retry under the cap is admitted without counting a turn', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTokens: 10 } });
    run.policy.start();
    await run.policy.beforeModelTurn();

    expect(run.policy.beforeProviderCall()).toBe(true);
    run.policy.recordProviderCall(call({ inputTokens: 2, outputTokens: 1 }));

    expect(run.policy.beforeProviderCall()).toBe(true);
    expect(run.policy.ending).toBeUndefined();
    expect(run.policy.metrics().metrics.turns).toBe(1);
  });

  test('a retry past the deadline is refused with the elapsed limit', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 100 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    expect(run.policy.beforeProviderCall()).toBe(true);

    run.time.advanceWithoutFiring(100);

    expect(run.policy.beforeProviderCall()).toBe(false);
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'elapsed' });
  });
});

describe('deadline', () => {
  test('a tool at 99 ms runs and one at the 100 ms deadline is refused', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 100 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.noteToolCallRequested('c1');
    run.policy.noteToolCallRequested('c2');

    run.time.advance(99);
    expect(run.policy.beforeToolCall('c1')).toEqual({ admitted: true });

    run.time.advance(1);
    expect(run.policy.beforeToolCall('c2')).toEqual({
      admitted: false,
      ending: { reason: 'budget', limit: 'elapsed' },
    });
  });

  test.each([100, 150])(
    'a tool at %i ms is refused even before the timer callback runs',
    async (elapsed) => {
      const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 100 } });
      run.policy.start();
      await run.policy.beforeModelTurn();

      run.time.advanceWithoutFiring(elapsed);

      expect(run.policy.beforeToolCall('c1')).toEqual({
        admitted: false,
        ending: { reason: 'budget', limit: 'elapsed' },
      });
    },
  );

  test('the deadline timer latches elapsed and aborts the run controller', () => {
    const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 100 } });
    run.policy.start();

    run.time.advance(100);

    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'elapsed' });
    const { signal } = run.policy.abortController;
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
    expect(run.policy.metrics().metrics.elapsedMs).toBe(100);
  });

  test('a passed deadline refuses the next model turn', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 100 } });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.time.advanceWithoutFiring(100);

    expect(run.policy.shouldStartNextTurn({ requestedTools: true })).toBe(
      false,
    );
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'elapsed' });
  });

  test('finish cancels the deadline timer', () => {
    const run = setup({ budgets: { ...roomyBudgets, maxElapsedMs: 100 } });
    run.policy.start();
    run.policy.latch({ reason: 'completed' });

    run.policy.finish();
    run.time.advance(100);

    expect(run.time.pending()).toBe(0);
    expect(run.policy.ending).toEqual({ reason: 'completed' });
    expect(run.policy.abortController.signal.aborted).toBe(false);
  });
});

describe('gate', () => {
  test('an unresolved gate holds the turn and resolving it releases the turn', async () => {
    const gateOpened = defer<void>();
    const turns: number[] = [];
    const gate: AgentRunGate = ({ turn }) => {
      turns.push(turn);
      return gateOpened.promise;
    };
    const run = setup({ budgets: roomyBudgets, gate });
    run.policy.start();

    const turnStarted = run.policy.beforeModelTurn();

    expect(turns).toEqual([1]);
    expect(await settledState(turnStarted)).toBe('pending');
    expect(run.policy.metrics().metrics.turns).toBe(0);

    gateOpened.resolve();
    expect(await turnStarted).toBe(true);
    expect(run.policy.metrics().metrics.turns).toBe(1);
  });

  test('the deadline passing while gated ends the run with limit elapsed', async () => {
    const run = setup({
      budgets: { ...roomyBudgets, maxElapsedMs: 100 },
      gate: () => defer<void>().promise,
    });
    run.policy.start();

    const turnStarted = run.policy.beforeModelTurn();
    run.time.advance(100);

    expect(await turnStarted).toBe(false);
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'elapsed' });
    expect(run.policy.metrics().metrics.turns).toBe(0);
  });

  test('a gate settling past the deadline before the timer runs refuses the turn', async () => {
    const gateOpened = defer<void>();
    const run = setup({
      budgets: { ...roomyBudgets, maxElapsedMs: 100 },
      gate: () => gateOpened.promise,
    });
    run.policy.start();

    const turnStarted = run.policy.beforeModelTurn();
    run.time.advanceWithoutFiring(100);
    gateOpened.resolve();

    expect(await turnStarted).toBe(false);
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'elapsed' });
    expect(run.policy.metrics().metrics.turns).toBe(0);
    expect(run.policy.abortController.signal.aborted).toBe(true);
  });

  test('an abort while gated ends the run cancelled', async () => {
    const caller = new AbortController();
    const run = setup({
      budgets: roomyBudgets,
      gate: () => defer<void>().promise,
      signal: caller.signal,
    });
    run.policy.start();

    const turnStarted = run.policy.beforeModelTurn();
    caller.abort('stop now');

    expect(await turnStarted).toBe(false);
    expect(run.policy.ending).toEqual({
      reason: 'cancelled',
      cause: 'stop now',
    });
  });

  test('a rejecting gate ends the run with a sanitized error', async () => {
    const run = setup({
      budgets: roomyBudgets,
      gate: () => Promise.reject(new Error('secret internals')),
    });
    run.policy.start();

    expect(await run.policy.beforeModelTurn()).toBe(false);
    expect(run.policy.ending).toEqual({
      reason: 'error',
      code: 'gate_failed',
      error: 'The run could not continue.',
    });
  });
});

describe('terminal latch', () => {
  test('only the first terminal cause wins', () => {
    const caller = new AbortController();
    const run = setup({
      budgets: { ...roomyBudgets, maxElapsedMs: 100 },
      signal: caller.signal,
    });
    run.policy.start();

    expect(run.policy.latch({ reason: 'budget', limit: 'tokens' })).toBe(true);
    caller.abort('late');
    run.time.advance(100);

    expect(run.policy.latch({ reason: 'completed' })).toBe(false);
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'tokens' });
  });

  test('usageUnknown is only accepted with limit tokens (type-level check)', () => {
    const tokens: AgentRunEnding = {
      reason: 'budget',
      limit: 'tokens',
      usageUnknown: true,
    };
    const turns: AgentRunEnding = {
      reason: 'budget',
      limit: 'turns',
      // @ts-expect-error usageUnknown belongs to the token limit only
      usageUnknown: true,
    };

    expect([tokens, turns]).toHaveLength(2);
  });

  test('a caller abort latches cancelled and aborts the run controller with its reason', () => {
    const caller = new AbortController();
    const run = setup({ budgets: roomyBudgets, signal: caller.signal });
    run.policy.start();

    caller.abort('user left');

    expect(run.policy.ending).toEqual({
      reason: 'cancelled',
      cause: 'user left',
    });
    expect(run.policy.abortController.signal.reason).toBe('user left');
  });

  test('every tool after a latched ending is refused with that ending', async () => {
    const run = setup({ budgets: roomyBudgets });
    run.policy.start();
    await run.policy.beforeModelTurn();
    run.policy.latch({ reason: 'error', code: 'x', error: 'failed' });

    expect(run.policy.beforeToolCall('c1')).toEqual({
      admitted: false,
      ending: { reason: 'error', code: 'x', error: 'failed' },
    });
    expect(await run.policy.beforeModelTurn()).toBe(false);
  });
});

describe('refusal results', () => {
  test('not run and stopped results pass validateToolResultEnvelope', async () => {
    const entry = orderEntry();

    for (const [result, summary] of [
      [notRunToolResult(), NOT_RUN_TOOL_SUMMARY],
      [stoppedToolResult(), STOPPED_TOOL_SUMMARY],
    ] as const) {
      expect(result).toEqual({ ok: false, code: 'cancelled', summary });
      expect(await validateToolResultEnvelope(entry, result)).toEqual({
        valid: true,
        result,
      });
    }
    expect(NOT_RUN_TOOL_SUMMARY).toBe('Not run');
    expect(STOPPED_TOOL_SUMMARY).toBe('Stopped');
  });
});

describe('adapter bug warning', () => {
  test('a completed call without usage logs one warning naming run, role and model', () => {
    const run = setup({ budgets: roomyBudgets });

    run.policy.recordProviderCall(call(undefined));
    run.policy.recordProviderCall({ ...call(undefined), completed: false });
    run.policy.recordProviderCall(call({ inputTokens: 1, outputTokens: 1 }));

    expect(run.warnings).toEqual([
      {
        message:
          'Agent run provider call completed without reporting usage. The adapter likely drops provider usage.',
        data: { runId: 'run-1', role: 'agent', model: 'scripted-model' },
      },
    ]);
    expect(run.ledger.snapshot().calls).toBe(3);
  });
});

describe('policy middleware', () => {
  test('onConfig runs the gate once for turn one, at beforeModel only', async () => {
    const turns: number[] = [];
    const run = setup({
      budgets: roomyBudgets,
      gate: ({ turn }) => {
        turns.push(turn);
      },
    });
    const hooks = middlewareHooks(run.policy);
    run.policy.start();

    await hooks.onConfig(hooks.context('init'));
    await hooks.onConfig(hooks.context('beforeModel'));

    expect(turns).toEqual([1]);
    expect(hooks.aborts).toEqual([]);
  });

  test('onConfig aborts the chat when the policy refuses the turn', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTurns: 1 } });
    const hooks = middlewareHooks(run.policy);
    run.policy.start();

    await hooks.onConfig(hooks.context('beforeModel'));
    await hooks.onConfig(hooks.context('beforeModel'));

    expect(hooks.aborts).toHaveLength(1);
    expect(run.policy.abortController.signal.aborted).toBe(true);
  });

  test('onBeforeToolCall skips a refused call with a validated not run payload', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxToolCalls: 1 } });
    const hooks = middlewareHooks(run.policy);
    run.policy.start();
    await hooks.onConfig(hooks.context('beforeModel'));
    hooks.onChunk(toolCallStart('c1'));
    hooks.onChunk(toolCallStart('c2'));

    const decision = await hooks.onBeforeToolCall('c1');

    const result = notRunToolResult();
    expect(decision).toEqual({
      type: 'skip',
      result: toModelToolPayload(result),
    });
    expect(hooks.refusals).toEqual([
      {
        callId: 'c1',
        name: 'latest_order',
        result,
        ending: { reason: 'budget', limit: 'toolCalls' },
      },
    ]);
  });

  test('onBeforeToolCall lets an admitted call run', async () => {
    const run = setup({ budgets: roomyBudgets });
    const hooks = middlewareHooks(run.policy);
    run.policy.start();
    await hooks.onConfig(hooks.context('beforeModel'));
    hooks.onChunk(toolCallStart('c1'));

    expect(await hooks.onBeforeToolCall('c1')).toBeUndefined();
    expect(hooks.refusals).toEqual([]);
  });

  test('onShouldContinue maps the last turn tool count to the policy', async () => {
    const run = setup({ budgets: { ...roomyBudgets, maxTurns: 1 } });
    const hooks = middlewareHooks(run.policy);
    run.policy.start();
    await hooks.onConfig(hooks.context('beforeModel'));

    expect(await hooks.onShouldContinue(0)).toBe(true);
    expect(run.policy.ending).toBeUndefined();
    expect(await hooks.onShouldContinue(1)).toBe(false);
    expect(run.policy.ending).toEqual({ reason: 'budget', limit: 'turns' });
  });
});

function setup(options: {
  budgets: AgentRunBudgets;
  gate?: AgentRunGate;
  signal?: AbortSignal;
}) {
  const time = createFakeAgentRunTime();
  const ledger = createUsageLedger();
  const warnings: { message: string; data?: Record<string, unknown> }[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, data) => {
      warnings.push({ message, data });
    },
    error: () => undefined,
  };
  const policy = createAgentRunPolicy({
    runId: RunId('run-1'),
    budgets: options.budgets,
    clock: time.clock,
    logger,
    ledger,
    signal: options.signal ?? new AbortController().signal,
    gate: options.gate,
  });
  return { policy, time, ledger, warnings };
}

function call(
  usage: ProviderCallRecord['usage'] | undefined,
): ProviderCallRecord {
  const base = {
    role: 'agent',
    model: 'scripted-model',
    latencyMs: 1,
    completed: true,
  };
  return usage === undefined ? base : { ...base, usage };
}

async function settledState(
  promise: Promise<unknown>,
): Promise<'pending' | 'settled'> {
  const macrotask = new Promise<'pending'>((resolve) => {
    setImmediate(() => resolve('pending'));
  });
  return Promise.race([promise.then(() => 'settled' as const), macrotask]);
}

function orderEntry() {
  const entry = orderRegistry().get('latest_order');
  if (!entry) throw new Error('test tool did not register');
  return entry;
}

function orderRegistry(): ToolRegistry {
  return createToolRegistry([
    serverTool({
      name: 'latest_order',
      description: 'Returns the latest order',
      input: z.object({}),
      output: z.object({ orderId: z.string() }),
      execute: async () => ({ orderId: 'o-1' }),
      summarize: summarizeAsTruncatedJson,
    }),
  ]);
}

function toolCallStart(toolCallId: string): StreamChunk {
  return {
    type: 'TOOL_CALL_START',
    toolCallId,
    toolCallName: 'latest_order',
    timestamp: 0,
  } as StreamChunk;
}

function middlewareHooks(policy: AgentRunPolicy) {
  const aborts: (string | undefined)[] = [];
  const refusals: AgentRunPolicyRefusal[] = [];
  const middleware: ChatMiddleware = createAgentRunPolicyMiddleware(policy, {
    registry: orderRegistry(),
    onToolCallRefused: (refusal) => {
      refusals.push(refusal);
    },
  });
  const context = (phase: ChatMiddlewarePhase) =>
    ({
      phase,
      abort: (reason?: string) => {
        aborts.push(reason);
      },
    }) as unknown as ChatMiddlewareContext;
  return {
    aborts,
    refusals,
    context,
    onConfig: (ctx: ChatMiddlewareContext) =>
      requireHook(middleware.onConfig)(ctx, {
        messages: [],
        systemPrompts: [],
        tools: [],
      }),
    onChunk: (chunk: StreamChunk) =>
      requireHook(middleware.onChunk)(context('modelStream'), chunk),
    onBeforeToolCall: (toolCallId: string) =>
      requireHook(middleware.onBeforeToolCall)(context('beforeTools'), {
        toolCallId,
        toolName: 'latest_order',
        args: {},
      } as unknown as ToolCallHookContext),
    onShouldContinue: (lastTurnToolCallCount: number) =>
      requireHook(middleware.onShouldContinue)(context('afterTools'), {
        iterationCount: 1,
        messages: [],
        finishReason: lastTurnToolCallCount > 0 ? 'tool_calls' : 'stop',
        toolCallCount: lastTurnToolCallCount,
        lastTurnToolCallCount,
      }),
  };
}

function requireHook<Hook>(hook: Hook | undefined): Hook {
  if (!hook) throw new Error('policy middleware is missing a hook');
  return hook;
}
