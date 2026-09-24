import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock factories are hoisted, so their shared state must be initialized first.
const createEngineMock = vi.hoisted(() => vi.fn());
vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: createEngineMock,
}));
const plannerSpies = vi.hoisted(() => ({
  jevPlanner: vi.fn(),
  jevComposedPairsPlanner: vi.fn(),
}));
vi.mock('@maelstrom-co/planner-jev', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@maelstrom-co/planner-jev')>();
  plannerSpies.jevPlanner.mockImplementation(original.jevPlanner);
  plannerSpies.jevComposedPairsPlanner.mockImplementation(
    original.jevComposedPairsPlanner,
  );
  return {
    ...original,
    jevPlanner: plannerSpies.jevPlanner,
    jevComposedPairsPlanner: plannerSpies.jevComposedPairsPlanner,
  };
});

import { buildLocalEngine } from './local-planner';

const OPENAI_KEY = 'sk-openaiServerKeyThatMustNeverLeak0123456789ABCD';
const TYPESAFE_KEY = 'ts-typesafe-key-that-must-never-leak-42';

function stubEngine() {
  return {
    handle: async () => {
      throw new Error('unused');
    },
    cancel: () => undefined,
    getHistory: async () => ({ ok: true, value: [] }),
  };
}

afterEach(() => {
  createEngineMock.mockReset();
  plannerSpies.jevPlanner.mockClear();
  plannerSpies.jevComposedPairsPlanner.mockClear();
  vi.restoreAllMocks();
});

const JEV_ENV = {
  OPENAI_API_KEY: OPENAI_KEY,
  TYPESAFE_API_KEY: TYPESAFE_KEY,
  JEV_MODEL: 'jev-1.13.0',
};

function quietly<T>(build: () => T): T {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  return build();
}

describe('buildLocalEngine', () => {
  it('defaults to the LLM planner and awaits a browser key without a server key', () => {
    const local = quietly(() => buildLocalEngine({}));
    expect(local.planner).toBe('llm');
    expect(local.engine).toBeNull();
    expect(local.helloReceived).toBe(false);
    expect(createEngineMock).not.toHaveBeenCalled();
  });

  it('builds the LLM engine with the default retry policy when a server key is set', () => {
    createEngineMock.mockReturnValue(stubEngine());
    const local = quietly(() =>
      buildLocalEngine({ OPENAI_API_KEY: OPENAI_KEY }),
    );
    expect(local.planner).toBe('llm');
    expect(local.engine).not.toBeNull();
    expect(local.helloReceived).toBe(true);
    expect(createEngineMock.mock.calls[0]?.[0].retry).toEqual({ max: 2 });
  });

  it('rejects an unknown planner', () => {
    expect(() =>
      quietly(() => buildLocalEngine({ MAELSTROM_PLANNER: 'gpt' })),
    ).toThrow(/MAELSTROM_PLANNER must be llm, jev or jev-composed-pairs/);
  });

  it.each([
    'jev',
    'jev-composed-pairs',
  ])('%s without the TypeSafe key names its planner value', (planner) => {
    expect(() =>
      quietly(() =>
        buildLocalEngine({
          MAELSTROM_PLANNER: planner,
          OPENAI_API_KEY: OPENAI_KEY,
          JEV_MODEL: 'jev-1.13.0',
        }),
      ),
    ).toThrow(`MAELSTROM_PLANNER=${planner} requires TYPESAFE_API_KEY.`);
  });

  it('jev builds the frozen POC planner', () => {
    createEngineMock.mockReturnValue(stubEngine());
    const local = quietly(() =>
      buildLocalEngine({ MAELSTROM_PLANNER: 'jev', ...JEV_ENV }),
    );
    expect(local.planner).toBe('jev');
    expect(plannerSpies.jevPlanner).toHaveBeenCalledTimes(1);
    expect(plannerSpies.jevComposedPairsPlanner).not.toHaveBeenCalled();
  });

  it('jev-composed-pairs builds the experimental composed pairs planner with retry off', () => {
    createEngineMock.mockReturnValue(stubEngine());
    const local = quietly(() =>
      buildLocalEngine({ MAELSTROM_PLANNER: 'jev-composed-pairs', ...JEV_ENV }),
    );
    expect(local.planner).toBe('jev-composed-pairs');
    expect(local.engine).not.toBeNull();
    expect(local.helloReceived).toBe(true);
    expect(local.secrets).toEqual([OPENAI_KEY, TYPESAFE_KEY]);
    expect(plannerSpies.jevComposedPairsPlanner).toHaveBeenCalledTimes(1);
    expect(plannerSpies.jevPlanner).not.toHaveBeenCalled();
    const [options] = plannerSpies.jevComposedPairsPlanner.mock.calls[0] ?? [];
    expect(options.typesafe).toMatchObject({
      apiKey: TYPESAFE_KEY,
      model: 'jev-1.13.0',
    });
    expect(typeof options.fallback).toBe('function');
    expect(createEngineMock.mock.calls[0]?.[0].retry).toBe(false);
  });

  it.each([
    [
      'the TypeSafe key',
      { OPENAI_API_KEY: OPENAI_KEY, JEV_MODEL: 'jev-1.13.0' },
      /TYPESAFE_API_KEY/,
    ],
    [
      'the Jev model',
      { OPENAI_API_KEY: OPENAI_KEY, TYPESAFE_API_KEY: TYPESAFE_KEY },
      /JEV_MODEL/,
    ],
    [
      'the server OpenAI key',
      { TYPESAFE_API_KEY: TYPESAFE_KEY, JEV_MODEL: 'jev-1.13.0' },
      /OPENAI_API_KEY/,
    ],
  ])('jev without %s throws without echoing a secret', (_name, env, pattern) => {
    let caught: unknown;
    try {
      quietly(() => buildLocalEngine({ MAELSTROM_PLANNER: 'jev', ...env }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(pattern);
    expect(message).not.toContain(OPENAI_KEY);
    expect(message).not.toContain(TYPESAFE_KEY);
  });

  it('redacts secrets from a jev engine construction failure', () => {
    createEngineMock.mockImplementation(() => {
      throw new Error(`bad config ${TYPESAFE_KEY} ${OPENAI_KEY}`);
    });
    let caught: unknown;
    try {
      quietly(() =>
        buildLocalEngine({
          MAELSTROM_PLANNER: 'jev',
          OPENAI_API_KEY: OPENAI_KEY,
          TYPESAFE_API_KEY: TYPESAFE_KEY,
          JEV_MODEL: 'jev-1.13.0',
        }),
      );
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error).message;
    expect(message).not.toContain(OPENAI_KEY);
    expect(message).not.toContain(TYPESAFE_KEY);
  });

  it('jev builds one shared engine with retry off and both secrets redacted', () => {
    createEngineMock.mockReturnValue(stubEngine());
    const local = quietly(() =>
      buildLocalEngine({
        MAELSTROM_PLANNER: 'jev',
        OPENAI_API_KEY: OPENAI_KEY,
        TYPESAFE_API_KEY: TYPESAFE_KEY,
        JEV_MODEL: 'jev-1.13.0',
      }),
    );
    expect(local.planner).toBe('jev');
    expect(local.engine).not.toBeNull();
    expect(local.helloReceived).toBe(true);
    expect(local.secrets).toEqual([OPENAI_KEY, TYPESAFE_KEY]);
    expect(createEngineMock).toHaveBeenCalledTimes(1);
    const config = createEngineMock.mock.calls[0]?.[0] as {
      retry: unknown;
      planner: unknown;
      logger: { error: (m: string, e?: unknown) => void };
    };
    expect(config.retry).toBe(false);
    expect(typeof config.planner).toBe('function');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    config.logger.error('jev failed', new Error(`key ${TYPESAFE_KEY}`));
    const logged = errorSpy.mock.calls
      .flat()
      .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
      .join(' ');
    expect(logged).not.toContain(TYPESAFE_KEY);
  });
});
