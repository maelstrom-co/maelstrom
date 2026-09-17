import { describe, expect, test } from 'bun:test';
import {
  dummyAdapter,
  invalid,
  silentLogger,
} from '../__test-helpers__/fixtures.js';
import { createInMemoryStore } from '../history/in-memory-store.js';
import { validateEngineConfig } from './engine-config.js';

const fakePlanner = {
  id: 'fake',
  supportedLayoutModes: ['grid'],
  async invoke() {
    throw new Error('not called during configuration validation');
  },
};
const explicitPlannerConfig = {
  primary: {
    implementation: fakePlanner,
    finalization: 'strict' as const,
    maxRepairAttempts: 0,
  },
  operation: { timeoutMs: null, maxProviderCalls: 1 },
};

describe('validateEngineConfig', () => {
  test('accepts minimal valid config (adapter only)', () => {
    const result = validateEngineConfig({ adapter: dummyAdapter });
    expect(result.adapter).toEqual(dummyAdapter);
    expect(result.logger).toBeUndefined();
    expect(result.prompt).toBeUndefined();
  });

  test('accepts full valid config', () => {
    const config = {
      adapter: dummyAdapter,
      logger: silentLogger,
      prompt: {
        vars: { assistantName: 'Custom' },
        system: { identity: 'You are a helpful assistant.' },
        user: { vessels: { prepend: 'Extra vessels context' } },
      },
    };
    const result = validateEngineConfig(config);
    expect(result.logger).toEqual(silentLogger);
    expect(result.prompt?.vars?.assistantName).toBe('Custom');
  });

  test('throws when neither configuration arm is present', () => {
    expect(() => validateEngineConfig({})).toThrow(/adapter|planner/);
  });

  test('rejects mixing adapter shorthand with an explicit planner route', () => {
    expect(() =>
      validateEngineConfig({
        adapter: dummyAdapter,
        planner: explicitPlannerConfig,
      }),
    ).toThrow(/unrecognized|adapter|planner/i);
  });

  test('accepts an explicit planner route without LLM-only options', () => {
    expect(() =>
      validateEngineConfig({ planner: explicitPlannerConfig }),
    ).not.toThrow();
  });

  test('throws when adapter is not an object', () => {
    expect(() => validateEngineConfig({ adapter: 'nope' })).toThrow(/adapter/);
  });

  test('throws when adapter is missing required methods', () => {
    const badAdapter = { kind: 'text', name: 'x', model: 'm' };
    const run = () => validateEngineConfig({ adapter: badAdapter });
    expect(run).toThrow(/adapter\.chatStream/);
    expect(run).toThrow(/adapter\.structuredOutput/);
  });

  test('throws when adapter.kind is wrong', () => {
    const badAdapter = { ...dummyAdapter, kind: 'image' };
    expect(() => validateEngineConfig({ adapter: badAdapter })).toThrow(
      /adapter\.kind/,
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
      validateEngineConfig({ adapter: dummyAdapter, logger: badLogger }),
    ).toThrow(new RegExp(`logger\\.${method}`));
  });

  test('throws when logger method is not a function', () => {
    const badLogger = { ...silentLogger, error: 'not a function' };
    expect(() =>
      validateEngineConfig({ adapter: dummyAdapter, logger: badLogger }),
    ).toThrow(/logger\.error/);
  });

  test('throws when prompt.vars has non-string value', () => {
    expect(() =>
      validateEngineConfig({
        adapter: dummyAdapter,
        prompt: { vars: { assistantName: 42 } },
      }),
    ).toThrow(/prompt\.vars\.assistantName/);
  });

  test('accepts undefined prompt.vars values (matches PromptVars type)', () => {
    expect(() =>
      validateEngineConfig({
        adapter: dummyAdapter,
        prompt: { vars: { assistantName: undefined } },
      }),
    ).not.toThrow();
  });

  test('throws on unrecognized root keys (typo guard)', () => {
    expect(() =>
      validateEngineConfig({
        adapter: dummyAdapter,
        prompts: { vars: { assistantName: 'typo' } },
      }),
    ).toThrow(/unrecognized|prompts/i);
  });

  test('throws on unrecognized prompt keys (typo guard)', () => {
    expect(() =>
      validateEngineConfig({
        adapter: dummyAdapter,
        prompt: {
          vars: { assistantName: 'Keep' },
          bogusField: 'should fail',
        },
      }),
    ).toThrow(/unrecognized|bogusField/i);
  });

  test('preserves extra adapter methods (loose)', () => {
    const extendedAdapter = {
      ...dummyAdapter,
      providerSpecificMethod: () => 'hello',
    };
    const result = validateEngineConfig({ adapter: extendedAdapter });
    expect(
      (
        result.adapter as unknown as { providerSpecificMethod: () => string }
      ).providerSpecificMethod(),
    ).toBe('hello');
  });

  // Real provider adapters (e.g. @tanstack/ai-gemini's GeminiTextAdapter)
  // are class instances whose internal helpers live on the prototype and
  // get invoked via `this.helper()` from the public methods. A schema that
  // rebuilds the adapter as a plain object — losing the prototype chain —
  // makes those `this` calls blow up at runtime even though the public
  // methods are still callable. Pin: the validated adapter must keep its
  // prototype so `chatStream` can reach `this.helper()`.
  test('preserves adapter prototype-chain methods (class-based providers)', () => {
    class FakeProviderAdapter {
      readonly kind = 'text';
      readonly name = 'fake';
      readonly model = 'fake-model';
      mapOptions(value: number): number {
        return value + 1;
      }
      chatStream(): unknown {
        return this.mapOptions(0);
      }
      structuredOutput(): unknown {
        return this.mapOptions(0);
      }
    }
    const adapter = new FakeProviderAdapter();
    const result = validateEngineConfig({ adapter });
    const validated = result.adapter as unknown as FakeProviderAdapter;
    expect(validated.chatStream()).toBe(1);
    expect(validated.structuredOutput()).toBe(1);
  });

  test('preserves extra logger fields (loose — pino/winston/bunyan)', () => {
    const pinoLike = {
      ...silentLogger,
      level: 'info',
      silent: false,
      transports: [],
    };
    const result = validateEngineConfig({
      adapter: dummyAdapter,
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

  test('error message enumerates union branches for invalid SectionCustomizer', () => {
    let caught: unknown;
    try {
      validateEngineConfig({
        adapter: dummyAdapter,
        prompt: { system: { identity: 42 } },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/invalid_union/);
    // Recursive branch enumeration: each of the four SectionCustomizer arms
    // (string, null, function, extension object) leaves a distinguishable
    // fingerprint in the rendered message. A future `formatIssue` refactor
    // that drops branch enumeration will fail these assertions.
    expect(message).toMatch(/expected string/);
    expect(message).toMatch(/expected null/);
    expect(message).toMatch(/expected function/);
    expect(message).toMatch(/expected object/);
  });

  describe('SectionCustomizer forms', () => {
    test('accepts string, null, function, and full { prepend, append } extension', () => {
      const result = validateEngineConfig({
        adapter: dummyAdapter,
        prompt: {
          system: {
            identity: 'string form',
            triggers: null,
            layout: (prev: string) => `${prev}!`,
            actions: { prepend: 'pre', append: 'post' },
            rules: { append: 'post only' },
          },
          user: { vessels: { prepend: 'pre only' } },
        },
      });
      expect(result.prompt?.system?.identity).toBe('string form');
      expect(result.prompt?.system?.triggers).toBeNull();
      expect(result.prompt?.system?.layout).toBeTypeOf('function');
      expect(result.prompt?.system?.actions).toEqual({
        prepend: 'pre',
        append: 'post',
      });
      expect(result.prompt?.system?.rules).toEqual({ append: 'post only' });
      expect(result.prompt?.user?.vessels).toEqual({ prepend: 'pre only' });
    });

    test('accepts { prepend }-only extension', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          prompt: { system: { identity: { prepend: 'only' } } },
        }),
      ).not.toThrow();
    });

    test('accepts { append }-only extension', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          prompt: { system: { identity: { append: 'only' } } },
        }),
      ).not.toThrow();
    });

    test('rejects empty extension object {}', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          prompt: { system: { identity: {} } },
        }),
      ).toThrow();
    });

    test('rejects typo in extension key (strict reject)', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          prompt: { system: { identity: { prepand: 'typo', append: 'ok' } } },
        }),
      ).toThrow();
    });
  });

  describe('maxRetries', () => {
    test('accepts a positive integer', () => {
      expect(() =>
        validateEngineConfig({ adapter: dummyAdapter, maxRetries: 5 }),
      ).not.toThrow();
    });

    test('accepts zero (retry layer wired but never fires)', () => {
      expect(() =>
        validateEngineConfig({ adapter: dummyAdapter, maxRetries: 0 }),
      ).not.toThrow();
    });

    test('accepts undefined (uses default at resolveConfig time)', () => {
      const result = validateEngineConfig({ adapter: dummyAdapter });
      expect(result.maxRetries).toBeUndefined();
    });

    test.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])('rejects non-nonnegative-integer (%p)', (value) => {
      expect(() =>
        validateEngineConfig({ adapter: dummyAdapter, maxRetries: value }),
      ).toThrow(/maxRetries/);
    });

    test('accepts -0 (canonically equal to 0)', () => {
      // Number.isInteger(-0) === true and -0 >= 0; pin behavior so a future
      // schema tightening doesn't accidentally reject it.
      expect(() =>
        validateEngineConfig({ adapter: dummyAdapter, maxRetries: -0 }),
      ).not.toThrow();
    });

    test('rejects null', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          maxRetries: invalid<number>(null),
        }),
      ).toThrow(/maxRetries/);
    });

    test('rejects non-number', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          maxRetries: invalid<number>('3'),
        }),
      ).toThrow(/maxRetries/);
    });
  });

  describe('history schema', () => {
    test('rejects history block missing the required store', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
          history: { maxEntries: 50 },
        }),
      ).toThrow(/history\.store/);
    });

    test('accepts history block with explicit in-memory store', () => {
      expect(() =>
        validateEngineConfig({
          adapter: dummyAdapter,
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
          adapter: dummyAdapter,
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
          adapter: dummyAdapter,
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
          adapter: dummyAdapter,
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
          adapter: dummyAdapter,
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
        adapter: dummyAdapter,
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
