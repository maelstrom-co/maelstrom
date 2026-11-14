import type { Engine } from '@maelstrom-co/engine';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

const engineBuilders = vi.hoisted(() => ({
  createPlaygroundEngine: vi.fn(),
  createJevPlaygroundEngine: vi.fn(),
}));
vi.mock('./engine-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine-config')>()),
  createPlaygroundEngine: engineBuilders.createPlaygroundEngine,
  createJevPlaygroundEngine: engineBuilders.createJevPlaygroundEngine,
}));

import {
  EngineFactory,
  EngineFactoryLive,
} from '../worker/session/engine-factory';
import type {
  JevPlaygroundEngineOptions,
  PlaygroundEngineOptions,
} from './engine-config';
import { buildLocalEngine } from './local-planner';

const OPENAI_KEY = 'sk-agentSlotTestKey0123456789ABCDEFGHIJKLMNOPQR';
const STUB_ENGINE = {} as Engine;

afterEach(() => {
  engineBuilders.createPlaygroundEngine.mockReset();
  engineBuilders.createJevPlaygroundEngine.mockReset();
  vi.restoreAllMocks();
});

describe('agent slot wiring', () => {
  it('the local LLM engine gets the demo agent served by its own adapter', () => {
    engineBuilders.createPlaygroundEngine.mockReturnValue(STUB_ENGINE);

    quietly(() => buildLocalEngine({ OPENAI_API_KEY: OPENAI_KEY }));

    expect(engineBuilders.createPlaygroundEngine).toHaveBeenCalledTimes(1);
    expectDemoAgent(engineBuilders.createPlaygroundEngine.mock.calls[0]?.[0]);
  });

  it('the local Jev engine gets the demo agent served by its own adapter', () => {
    engineBuilders.createJevPlaygroundEngine.mockReturnValue(STUB_ENGINE);

    quietly(() =>
      buildLocalEngine({
        MAELSTROM_PLANNER: 'jev',
        OPENAI_API_KEY: OPENAI_KEY,
        TYPESAFE_API_KEY: 'ts-agent-slot-test-key',
        JEV_MODEL: 'jev-1.13.0',
      }),
    );

    expect(engineBuilders.createJevPlaygroundEngine).toHaveBeenCalledTimes(1);
    expectDemoAgent(
      engineBuilders.createJevPlaygroundEngine.mock.calls[0]?.[0],
    );
  });

  it('MAELSTROM_AGENT=off leaves the agent out of the local LLM engine', () => {
    engineBuilders.createPlaygroundEngine.mockReturnValue(STUB_ENGINE);

    quietly(() =>
      buildLocalEngine({ OPENAI_API_KEY: OPENAI_KEY, MAELSTROM_AGENT: 'off' }),
    );

    expect(engineBuilders.createPlaygroundEngine).toHaveBeenCalledTimes(1);
    const [options] = engineBuilders.createPlaygroundEngine.mock.calls[0] as [
      PlaygroundEngineOptions,
    ];
    expect(options).not.toHaveProperty('agent');
  });

  it('MAELSTROM_AGENT=off leaves the agent out of the local Jev engine', () => {
    engineBuilders.createJevPlaygroundEngine.mockReturnValue(STUB_ENGINE);

    quietly(() =>
      buildLocalEngine({
        MAELSTROM_PLANNER: 'jev',
        MAELSTROM_AGENT: 'off',
        OPENAI_API_KEY: OPENAI_KEY,
        TYPESAFE_API_KEY: 'ts-agent-slot-test-key',
        JEV_MODEL: 'jev-1.13.0',
      }),
    );

    const [options] = engineBuilders.createJevPlaygroundEngine.mock
      .calls[0] as [JevPlaygroundEngineOptions];
    expect(options).not.toHaveProperty('agent');
  });

  it('rejects an unknown MAELSTROM_AGENT value', () => {
    expect(() =>
      quietly(() =>
        buildLocalEngine({ OPENAI_API_KEY: OPENAI_KEY, MAELSTROM_AGENT: 'no' }),
      ),
    ).toThrow('MAELSTROM_AGENT must be on or off');
  });

  it('the hosted Worker engine factory passes no agent', () => {
    engineBuilders.createPlaygroundEngine.mockReturnValue(STUB_ENGINE);

    const engine = Effect.runSync(
      Effect.gen(function* () {
        const factory = yield* EngineFactory;
        return yield* factory.make(OPENAI_KEY);
      }).pipe(Effect.provide(EngineFactoryLive)),
    );

    expect(engine).toBe(STUB_ENGINE);
    expect(engineBuilders.createPlaygroundEngine).toHaveBeenCalledTimes(1);
    const [options] = engineBuilders.createPlaygroundEngine.mock.calls[0] as [
      PlaygroundEngineOptions,
    ];
    expect(options).not.toHaveProperty('agent');
  });
});

function expectDemoAgent(
  options: PlaygroundEngineOptions | JevPlaygroundEngineOptions | undefined,
) {
  expect(options?.agent).toBeDefined();
  expect(options?.agent?.model).toBe(options?.adapter);
  expect(options?.agent?.tools?.map((tool) => tool.name)).toEqual([
    'latest_order',
    'search_products',
  ]);
}

function quietly<T>(build: () => T): T {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  return build();
}
