import { describe, expect, test } from 'bun:test';
import { ok } from '@maelstrom-co/protocol';

import {
  buildGridResponse,
  invalid,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import { createInMemoryStore } from '../history/in-memory-store.js';
import type { Planner } from '../planner/stage.js';
import { validateEngineConfig } from './engine-config.js';

const stubPlanner: Planner = async () => ok(buildGridResponse());
const notAPlanner = { kind: 'text', name: 'dummy', model: 'dummy-model' };

describe('validateEngineConfig', () => {
  test('accepts minimal valid config (planner only)', () => {
    const result = validateEngineConfig({ planner: stubPlanner });
    expect(result.planner).toBe(stubPlanner);
    expect(result.logger).toBeUndefined();
    expect(result.retry).toBeUndefined();
  });

  test('accepts full valid config', () => {
    const config = {
      planner: stubPlanner,
      logger: silentLogger,
      history: { store: createInMemoryStore() },
      retry: { max: 2 },
    };
    const result = validateEngineConfig(config);
    expect(result).toBe(config);
  });

  test('throws when planner is missing', () => {
    expect(() => validateEngineConfig({})).toThrow(/planner/);
  });

  test.each([
    ['an object', { adapter: notAPlanner }],
    ['a string', 'llm'],
    ['null', null],
  ])('throws when planner is %s', (_case, planner) => {
    expect(() => validateEngineConfig({ planner })).toThrow(
      /planner \[custom\]: expected function/,
    );
  });

  test.each([
    'debug',
    'info',
    'warn',
    'error',
  ] as const)('throws when required logger method %s is missing', (method) => {
    const badLogger: Record<string, unknown> = { ...silentLogger };
    delete badLogger[method];
    expect(() =>
      validateEngineConfig({ planner: stubPlanner, logger: badLogger }),
    ).toThrow(new RegExp(`logger\\.${method}`));
  });

  test('throws when logger method is not a function', () => {
    const badLogger = { ...silentLogger, error: 'not a function' };
    expect(() =>
      validateEngineConfig({ planner: stubPlanner, logger: badLogger }),
    ).toThrow(/logger\.error/);
  });

  test.each([
    ['adapter', notAPlanner],
    ['prompt', {}],
    ['modelOptions', {}],
    ['maxRetries', 1],
  ])('rejects the %s key, which belongs to a planner or was removed', (key, value) => {
    expect(() =>
      validateEngineConfig({ planner: stubPlanner, [key]: value }),
    ).toThrow(new RegExp(`unrecognized.*${key}|${key}.*unrecognized`, 'i'));
  });

  test('preserves extra logger fields (loose — pino/winston/bunyan)', () => {
    const pinoLike = {
      ...silentLogger,
      level: 'info',
      silent: false,
      transports: [],
    };
    const result = validateEngineConfig({
      planner: stubPlanner,
      logger: pinoLike,
    });
    const loggerWithExtras = result.logger as unknown as {
      level: string;
      silent: boolean;
      transports: unknown[];
    };
    expect(loggerWithExtras.level).toBe('info');
    expect(loggerWithExtras.silent).toBe(false);
    expect(loggerWithExtras.transports).toEqual([]);
  });

  describe('retry', () => {
    test.each([
      ['a positive budget', { max: 5 }],
      ['a zero budget (validation wired, never re-runs)', { max: 0 }],
      ['-0 (canonically equal to 0)', { max: -0 }],
      ['false (planner runs bare)', false],
    ])('accepts %s', (_case, retry) => {
      expect(() =>
        validateEngineConfig({ planner: stubPlanner, retry }),
      ).not.toThrow();
    });

    test('accepts undefined (uses default at resolveConfig time)', () => {
      const result = validateEngineConfig({ planner: stubPlanner });
      expect(result.retry).toBeUndefined();
    });

    test.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])('rejects a max that is not a non-negative integer (%p)', (max) => {
      expect(() =>
        validateEngineConfig({ planner: stubPlanner, retry: { max } }),
      ).toThrow(/retry/);
    });

    test.each([
      ['true', true],
      ['null', null],
      ['a number', 3],
      ['an empty object', {}],
      ['a string max', { max: '3' }],
      ['an unknown key', { max: 1, backoff: 100 }],
    ])('rejects %s', (_case, retry) => {
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          retry: invalid<false>(retry),
        }),
      ).toThrow(/retry/);
    });
  });

  describe('history schema', () => {
    test('rejects history block missing the required store', () => {
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          history: { maxEntries: 50 },
        }),
      ).toThrow(/history\.store/);
    });

    test('accepts history block with explicit in-memory store', () => {
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          history: { store: createInMemoryStore(), maxEntries: 50 },
        }),
      ).not.toThrow();
    });

    test.each([
      ['maxEntries', 0],
      ['maxEntries', -1],
      ['maxEntries', 1.5],
      ['maxChars', 0],
      ['maxChars', -100],
      ['maxChars', 2.5],
    ] as const)('rejects non-positive-integer %s (%p)', (field, value) => {
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          history: {
            store: createInMemoryStore(),
            [field]: value,
          },
        }),
      ).toThrow(new RegExp(`history\\.${field}`));
    });

    test('rejects non-callable transformEntry', () => {
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          history: {
            store: createInMemoryStore(),
            transformEntry: 'not a function' as unknown as (
              e: unknown,
            ) => unknown,
          },
        }),
      ).toThrow(/transformEntry/);
    });

    test('rejects non-callable deriveLLMContext', () => {
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          history: {
            store: createInMemoryStore(),
            deriveLLMContext: 'not a function' as unknown as (
              e: unknown,
            ) => readonly unknown[],
          },
        }),
      ).toThrow(/deriveLLMContext/);
    });

    test('rejects a store missing required methods', () => {
      const incompleteStore = {
        append: () => Promise.resolve({ inserted: true }),
        get: () => Promise.resolve([]),
        // missing: replace, clear
      };
      expect(() =>
        validateEngineConfig({
          planner: stubPlanner,
          history: {
            store: invalid<never>(incompleteStore),
          },
        }),
      ).toThrow(/history\.store\.(replace|clear)/);
    });

    test('preserves extra implementation-specific fields on store (loose)', () => {
      // Production stores ride along with backend handles (Redis client,
      // pool, etc.) the engine must not strip during validation.
      const inner = createInMemoryStore();
      const richStore = {
        ...inner,
        backendName: 'redis',
        connection: { host: 'redis.local' },
      };
      const result = validateEngineConfig({
        planner: stubPlanner,
        history: { store: richStore },
      });
      const observed = result.history?.store as unknown as {
        backendName: string;
        connection: { host: string };
      };
      expect(observed.backendName).toBe('redis');
      expect(observed.connection.host).toBe('redis.local');
    });
  });
});
