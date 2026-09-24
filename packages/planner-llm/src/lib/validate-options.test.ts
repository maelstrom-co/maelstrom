import { describe, expect, test } from 'bun:test';

import { dummyAdapter } from './__test-helpers__/fixtures.js';
import { validateLlmPlannerOptions } from './validate-options.js';

describe('validateLlmPlannerOptions', () => {
  test('accepts minimal valid options (adapter only)', () => {
    const options = { adapter: dummyAdapter };
    expect(validateLlmPlannerOptions(options)).toBe(options);
  });

  test('accepts full valid options', () => {
    const options = {
      adapter: dummyAdapter,
      prompt: {
        vars: { assistantName: 'Custom' },
        system: { identity: 'You are a helpful assistant.' },
        user: { vessels: { prepend: 'Extra vessels context' } },
      },
      modelOptions: { max_output_tokens: 1024 },
    };
    const result = validateLlmPlannerOptions(options);
    expect(result.prompt?.vars?.assistantName).toBe('Custom');
    expect(result.modelOptions).toEqual({ max_output_tokens: 1024 });
  });

  test('throws when adapter is missing', () => {
    expect(() => validateLlmPlannerOptions({})).toThrow(
      /^Invalid LlmPlannerOptions: adapter/,
    );
  });

  test('throws when adapter is not an object', () => {
    expect(() => validateLlmPlannerOptions({ adapter: 'nope' })).toThrow(
      /adapter/,
    );
  });

  test('throws when adapter is missing required methods', () => {
    const badAdapter = { kind: 'text', name: 'x', model: 'm' };
    const run = () => validateLlmPlannerOptions({ adapter: badAdapter });
    expect(run).toThrow(/adapter\.chatStream/);
    expect(run).toThrow(/adapter\.structuredOutput/);
  });

  test('throws when adapter.kind is wrong', () => {
    const badAdapter = { ...dummyAdapter, kind: 'image' };
    expect(() => validateLlmPlannerOptions({ adapter: badAdapter })).toThrow(
      /adapter\.kind/,
    );
  });

  test('throws on unrecognized root keys (typo guard)', () => {
    expect(() =>
      validateLlmPlannerOptions({
        adapter: dummyAdapter,
        prompts: { vars: { assistantName: 'typo' } },
      }),
    ).toThrow(/unrecognized|prompts/i);
  });

  test('throws when modelOptions is not a record', () => {
    expect(() =>
      validateLlmPlannerOptions({
        adapter: dummyAdapter,
        modelOptions: 'fast',
      }),
    ).toThrow(/modelOptions/);
  });

  test('throws when prompt.vars has non-string value', () => {
    expect(() =>
      validateLlmPlannerOptions({
        adapter: dummyAdapter,
        prompt: { vars: { assistantName: 42 } },
      }),
    ).toThrow(/prompt\.vars\.assistantName/);
  });

  test('accepts undefined prompt.vars values (matches PromptVars type)', () => {
    expect(() =>
      validateLlmPlannerOptions({
        adapter: dummyAdapter,
        prompt: { vars: { assistantName: undefined } },
      }),
    ).not.toThrow();
  });

  test('throws on unrecognized prompt keys (typo guard)', () => {
    expect(() =>
      validateLlmPlannerOptions({
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
    const result = validateLlmPlannerOptions({ adapter: extendedAdapter });
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
    const result = validateLlmPlannerOptions({ adapter });
    const validated = result.adapter as unknown as FakeProviderAdapter;
    expect(validated.chatStream()).toBe(1);
    expect(validated.structuredOutput()).toBe(1);
  });

  test('error message enumerates union branches for invalid SectionCustomizer', () => {
    let caught: unknown;
    try {
      validateLlmPlannerOptions({
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
      const result = validateLlmPlannerOptions({
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
        validateLlmPlannerOptions({
          adapter: dummyAdapter,
          prompt: { system: { identity: { prepend: 'only' } } },
        }),
      ).not.toThrow();
    });

    test('accepts { append }-only extension', () => {
      expect(() =>
        validateLlmPlannerOptions({
          adapter: dummyAdapter,
          prompt: { system: { identity: { append: 'only' } } },
        }),
      ).not.toThrow();
    });

    test('rejects empty extension object {}', () => {
      expect(() =>
        validateLlmPlannerOptions({
          adapter: dummyAdapter,
          prompt: { system: { identity: {} } },
        }),
      ).toThrow();
    });

    test('rejects typo in extension key (strict reject)', () => {
      expect(() =>
        validateLlmPlannerOptions({
          adapter: dummyAdapter,
          prompt: { system: { identity: { prepand: 'typo', append: 'ok' } } },
        }),
      ).toThrow();
    });
  });
});
