import type { AgentConfig } from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

const createEngineMock = vi.hoisted(() =>
  vi.fn((_config: { agent?: unknown }) => ({})),
);

vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: createEngineMock,
}));

import {
  createDemoAgentConfig,
  createJevPlaygroundEngine,
  createPlaygroundEngine,
} from './engine-config';
import { createDemoOpenaiChat } from './engine-model';

describe('createDemoAgentConfig', () => {
  it('registers the read-only latest-order and product-search Server Tools', () => {
    const adapter = { name: 'stub-adapter' } as unknown as AnyTextAdapter;

    const config = createDemoAgentConfig(adapter);

    expect(config.model).toBe(adapter);
    expect(config.instructions).toMatch(/pet shop/);
    expect(config.budgets).toBeUndefined();
    expect(config.tools).toHaveLength(2);
    expect(config.tools?.[0]).toMatchObject({
      name: 'latest_order',
      locus: 'server',
      sideEffect: 'read_only',
    });
    expect(config.tools?.[1]).toMatchObject({
      name: 'search_products',
      locus: 'server',
      sideEffect: 'read_only',
    });
  });
});

describe('playground engines and the agent slot', () => {
  const adapter = createDemoOpenaiChat('sk-test-key');
  const typesafe = { apiKey: 'ts-test-key', model: 'jev-test' };
  const agent: AgentConfig = createDemoAgentConfig(adapter);

  afterEach(() => {
    createEngineMock.mockClear();
  });

  const builders = {
    createPlaygroundEngine: (agentOption?: AgentConfig) =>
      createPlaygroundEngine({
        adapter,
        ...(agentOption ? { agent: agentOption } : {}),
      }),
    createJevPlaygroundEngine: (agentOption?: AgentConfig) =>
      createJevPlaygroundEngine({
        adapter,
        typesafe,
        ...(agentOption ? { agent: agentOption } : {}),
      }),
  };

  for (const [name, build] of Object.entries(builders)) {
    it(`${name} passes the exact agent reference to createEngine`, () => {
      build(agent);

      expect(createEngineMock.mock.calls[0]?.[0].agent).toBe(agent);
    });

    it(`${name} leaves the agent key out when the option is omitted`, () => {
      build();

      expect(createEngineMock.mock.calls[0]?.[0]).not.toHaveProperty('agent');
    });
  }
});
