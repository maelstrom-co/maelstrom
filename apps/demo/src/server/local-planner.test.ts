import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock factories are hoisted, so their shared state must be initialized first.
const createEngineMock = vi.hoisted(() => vi.fn());
vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: createEngineMock,
}));

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
  vi.restoreAllMocks();
});

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
    ).toThrow(/MAELSTROM_PLANNER must be llm or jev/);
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
