import { describe, expect, test } from 'bun:test';

import { dummyAdapter, silentLogger } from '../__test-helpers__/fixtures.js';
import { validateEngineConfig } from './engine-config.js';

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

  test('throws when adapter is missing', () => {
    expect(() => validateEngineConfig({})).toThrow(/adapter/);
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

  test.each(['debug', 'info', 'warn', 'error'] as const)(
    'throws when required logger method %s is missing',
    (method) => {
      const badLogger: Record<string, unknown> = { ...silentLogger };
      delete badLogger[method];
      expect(() =>
        validateEngineConfig({ adapter: dummyAdapter, logger: badLogger }),
      ).toThrow(new RegExp(`logger\\.${method}`));
    },
  );

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
      (result.adapter as unknown as { providerSpecificMethod: () => string })
        .providerSpecificMethod(),
    ).toBe('hello');
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
});
