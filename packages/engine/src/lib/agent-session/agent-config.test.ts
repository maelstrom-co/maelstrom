import { describe, expect, test } from 'bun:test';

import type { AnyTextAdapter } from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';

import { resolveConfig } from '../config.js';
import {
  resolveAgentConfig,
  resolveAgentRunSetup,
  tightenAgentRunBudgets,
  type AgentBudgetResolver,
  type AgentConfig,
  type AgentModelFactory,
  type AgentRunContext,
} from './agent-config.js';
import type { AgentRunBudgets } from './agent-run.js';
import { serverTool } from './server-tool.js';
import type { RegistrableServerTool } from './tool-registry.js';

const adapter = fakeText({ model: 'static' });
const user = { id: 'user-1' };
const ctx: AgentRunContext = { user, token: 'token-1' };
const BUDGET_FIELDS = [
  'maxTurns',
  'maxElapsedMs',
  'maxTokens',
  'maxToolCalls',
] as const;

describe('resolveAgentConfig', () => {
  test('without budgets every run gets the defaults', async () => {
    const resolved = resolveAgentConfig({ model: adapter });
    expect(resolved.instructions).toBe('');
    expect(resolved.registry.entries()).toEqual([]);
    expect(resolved.retry).toBeUndefined();
    const setup = await resolveAgentRunSetup(resolved, ctx);
    expect(setup.budgets).toEqual({
      maxTurns: 12,
      maxElapsedMs: 120_000,
      maxTokens: 100_000,
      maxToolCalls: 24,
    });
    expect(Object.isFrozen(setup.budgets)).toBe(true);
  });

  test('static partial budgets replace only the fields they set', async () => {
    const resolved = resolveAgentConfig({
      model: adapter,
      budgets: { maxTurns: 3, maxTokens: 500 },
    });
    const setup = await resolveAgentRunSetup(resolved, ctx);
    expect(setup.budgets).toEqual({
      maxTurns: 3,
      maxElapsedMs: 120_000,
      maxTokens: 500,
      maxToolCalls: 24,
    });
  });

  test('zero is a valid budget', () => {
    expect(() =>
      resolveAgentConfig({ model: adapter, budgets: { maxTokens: 0 } }),
    ).not.toThrow();
  });

  for (const field of BUDGET_FIELDS) {
    for (const value of [Number.NaN, -1, 1.5, -Infinity]) {
      test(`static ${field} of ${value} is rejected`, () => {
        expect(() =>
          resolveAgentConfig({ model: adapter, budgets: { [field]: value } }),
        ).toThrow(new RegExp(`Invalid agent budget ${field}`));
      });
    }
  }

  for (const field of ['maxTokens', 'maxElapsedMs'] as const) {
    test(`static ${field} of Infinity is accepted as no cap`, async () => {
      const resolved = resolveAgentConfig({
        model: adapter,
        budgets: { [field]: Infinity },
      });
      const setup = await resolveAgentRunSetup(resolved, ctx);
      expect(setup.budgets[field]).toBe(Infinity);
    });
  }

  for (const field of ['maxTurns', 'maxToolCalls'] as const) {
    test(`static ${field} of Infinity is rejected so the loop stays bounded`, () => {
      expect(() =>
        resolveAgentConfig({ model: adapter, budgets: { [field]: Infinity } }),
      ).toThrow(new RegExp(`Invalid agent budget ${field}`));
    });
  }

  test('a tool without summarize fails at startup', () => {
    const { summarize: _summarize, ...withoutSummarize } = echoTool();
    expect(() =>
      resolveAgentConfig({
        model: adapter,
        tools: [withoutSummarize as unknown as RegistrableServerTool],
      }),
    ).toThrow('Server tool "echo" must define summarize');
  });

  test('tools are registered once, in order', () => {
    const tool = echoTool();
    const resolved = resolveAgentConfig({ model: adapter, tools: [tool] });
    expect(resolved.registry.get('echo')?.tool).toBe(tool);
  });

  test('a model that is neither an adapter nor a factory is rejected', () => {
    expect(() =>
      resolveAgentConfig({ model: null as unknown as AnyTextAdapter }),
    ).toThrow('model must be a text adapter or a model factory');
  });

  test('resolveConfig resolves the agent slot and leaves it undefined when absent', () => {
    const planner = (() => {
      throw new Error('unused');
    }) as never;
    expect(resolveConfig({ planner }).agent).toBeUndefined();
    const resolved = resolveConfig({
      planner,
      agent: { model: adapter, instructions: 'Be brief.' },
    }).agent;
    expect(resolved?.instructions).toBe('Be brief.');
    expect(() =>
      resolveConfig({
        planner,
        agent: { model: adapter, budgets: { maxTurns: -1 } },
      }),
    ).toThrow('Invalid agent budget maxTurns');
  });
});

describe('resolveAgentRunSetup budgets', () => {
  test('a resolver gets ctx.user and is called once per setup', async () => {
    const calls: AgentRunContext[] = [];
    const resolver: AgentBudgetResolver = async (runCtx) => {
      calls.push(runCtx);
      return { maxToolCalls: 4 };
    };
    const resolved = resolveAgentConfig({ model: adapter, budgets: resolver });
    const first = await resolveAgentRunSetup(resolved, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.user).toBe(user);
    expect(calls[0]?.token).toBe('token-1');
    expect(first.budgets).toEqual({
      maxTurns: 12,
      maxElapsedMs: 120_000,
      maxTokens: 100_000,
      maxToolCalls: 4,
    });
    await resolveAgentRunSetup(resolved, ctx);
    expect(calls).toHaveLength(2);
  });

  test('a resolver value can raise a default', async () => {
    const resolved = resolveAgentConfig({
      model: adapter,
      budgets: () => ({ maxTurns: 40 }),
    });
    expect((await resolveAgentRunSetup(resolved, ctx)).budgets.maxTurns).toBe(
      40,
    );
  });

  test('a per-run override lowers values but never raises them', async () => {
    const resolved = resolveAgentConfig({
      model: adapter,
      budgets: { maxTurns: 6, maxTokens: 1_000 },
    });
    const setup = await resolveAgentRunSetup(resolved, ctx, {
      maxTurns: 2,
      maxTokens: 5_000,
      maxElapsedMs: 300_000,
      maxToolCalls: 10,
    });
    expect(setup.budgets).toEqual({
      maxTurns: 2,
      maxElapsedMs: 120_000,
      maxTokens: 1_000,
      maxToolCalls: 10,
    });
  });

  test('a per-run override also tightens resolver values', async () => {
    const resolved = resolveAgentConfig({
      model: adapter,
      budgets: () => ({ maxTurns: 40 }),
    });
    const setup = await resolveAgentRunSetup(resolved, ctx, {
      maxTurns: 50,
      maxToolCalls: 1,
    });
    expect(setup.budgets.maxTurns).toBe(40);
    expect(setup.budgets.maxToolCalls).toBe(1);
  });

  for (const field of BUDGET_FIELDS) {
    for (const value of [Number.NaN, -1, 1.5]) {
      test(`a resolver ${field} of ${value} rejects the setup`, async () => {
        const resolved = resolveAgentConfig({
          model: adapter,
          budgets: () => ({ [field]: value }),
        });
        await expect(resolveAgentRunSetup(resolved, ctx)).rejects.toThrow(
          new RegExp(`Invalid agent budget ${field} from budget resolver`),
        );
      });

      test(`an override ${field} of ${value} rejects the setup`, async () => {
        const resolved = resolveAgentConfig({ model: adapter });
        await expect(
          resolveAgentRunSetup(resolved, ctx, { [field]: value }),
        ).rejects.toThrow(
          new RegExp(`Invalid agent budget ${field} from per-run override`),
        );
      });
    }
  }

  for (const field of ['maxTokens', 'maxElapsedMs'] as const) {
    test(`a resolver ${field} of Infinity is accepted`, async () => {
      const resolved = resolveAgentConfig({
        model: adapter,
        budgets: () => ({ [field]: Infinity }),
      });
      const setup = await resolveAgentRunSetup(resolved, ctx);
      expect(setup.budgets[field]).toBe(Infinity);
    });
  }

  test('a throwing resolver rejects the setup', async () => {
    const resolved = resolveAgentConfig({
      model: adapter,
      budgets: () => {
        throw new Error('quota lookup failed');
      },
    });
    await expect(resolveAgentRunSetup(resolved, ctx)).rejects.toThrow(
      'quota lookup failed',
    );
  });

  test('a rejecting resolver rejects the setup', async () => {
    const resolved = resolveAgentConfig({
      model: adapter,
      budgets: () => Promise.reject(new Error('quota store down')),
    });
    await expect(resolveAgentRunSetup(resolved, ctx)).rejects.toThrow(
      'quota store down',
    );
  });
});

describe('resolveAgentRunSetup model', () => {
  test('a static adapter is returned unchanged', async () => {
    const resolved = resolveAgentConfig({ model: adapter });
    expect((await resolveAgentRunSetup(resolved, ctx)).adapter).toBe(adapter);
  });

  test('a factory gets ctx.user and is called once per setup', async () => {
    const calls: AgentRunContext[] = [];
    const perRun = fakeText({ model: 'per-run' });
    const factory: AgentModelFactory = async (runCtx) => {
      calls.push(runCtx);
      return perRun;
    };
    const resolved = resolveAgentConfig({ model: factory });
    const setup = await resolveAgentRunSetup(resolved, ctx);
    expect(setup.adapter).toBe(perRun);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.user).toBe(user);
    await resolveAgentRunSetup(resolved, ctx);
    expect(calls).toHaveLength(2);
  });

  test('a synchronous factory works', async () => {
    const resolved = resolveAgentConfig({ model: () => adapter });
    expect((await resolveAgentRunSetup(resolved, ctx)).adapter).toBe(adapter);
  });

  test('a throwing factory rejects the setup', async () => {
    const resolved = resolveAgentConfig({
      model: () => {
        throw new Error('no model for this tenant');
      },
    });
    await expect(resolveAgentRunSetup(resolved, ctx)).rejects.toThrow(
      'no model for this tenant',
    );
  });

  test('a rejecting factory rejects the setup', async () => {
    const resolved = resolveAgentConfig({
      model: () => Promise.reject(new Error('provider unavailable')),
    });
    await expect(resolveAgentRunSetup(resolved, ctx)).rejects.toThrow(
      'provider unavailable',
    );
  });

  test('a factory returning no adapter rejects the setup', async () => {
    const config: AgentConfig = {
      model: () => undefined as unknown as AnyTextAdapter,
    };
    await expect(
      resolveAgentRunSetup(resolveAgentConfig(config), ctx),
    ).rejects.toThrow('did not return a text adapter');
  });
});

describe('tightenAgentRunBudgets', () => {
  const base: AgentRunBudgets = {
    maxTurns: 5,
    maxElapsedMs: 1_000,
    maxTokens: Infinity,
    maxToolCalls: 8,
  };

  test('without an override it returns an equal frozen copy', () => {
    const tightened = tightenAgentRunBudgets(base);
    expect(tightened).toEqual(base);
    expect(tightened).not.toBe(base);
    expect(Object.isFrozen(tightened)).toBe(true);
  });

  test('each field takes the smaller value', () => {
    expect(
      tightenAgentRunBudgets(base, {
        maxTurns: 9,
        maxElapsedMs: 500,
        maxTokens: 2_000,
      }),
    ).toEqual({
      maxTurns: 5,
      maxElapsedMs: 500,
      maxTokens: 2_000,
      maxToolCalls: 8,
    });
  });
});

function echoTool() {
  return serverTool({
    name: 'echo',
    description: 'Echo the text',
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    execute: async (input) => input,
    summarize: (output) => output.text,
  });
}
