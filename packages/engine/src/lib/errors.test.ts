import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';

import {
  cancellationError,
  historyError,
  parseError,
  providerError,
  requestValidationError,
  timeoutError,
  validationError,
} from './errors.js';
import type { EngineError } from './errors.js';

describe('Error constructors', () => {
  test('parseError creates tagged error with stack', () => {
    const e = parseError('bad json', '{{');
    expect(e._tag).toBe('ParseError');
    expect(e.message).toBe('bad json');
    expect(e.raw).toBe('{{');
    expect(e.stack).toBeString();
  });

  test('providerError creates tagged error', () => {
    const cause = new Error('network');
    const e = providerError('LLM failed', cause);
    expect(e._tag).toBe('ProviderError');
    expect(e.message).toBe('LLM failed');
    expect(e.cause).toBe(cause);
    expect(e.stack).toBeString();
  });

  test('validationError creates tagged error with field', () => {
    const e = validationError('missing field', 'name');
    expect(e._tag).toBe('ValidationError');
    expect(e.message).toBe('missing field');
    expect(e.field).toBe('name');
    expect(e.stack).toBeString();
  });

  test('validationError omits absent optional keys (no undefined-valued field/cause)', () => {
    const e = validationError('general validation failure');
    expect(e._tag).toBe('ValidationError');
    expect(e.message).toBe('general validation failure');
    // Locks the conditional-spread contract: `'field' in e` / `'cause' in e`
    // must be false when omitted, so consumers that branch on key presence
    // (logging, JSON serialization, shallow equality) see a stable shape.
    expect('field' in e).toBe(false);
    expect('cause' in e).toBe(false);
  });

  test('validationError preserves underlying cause', () => {
    const cause = new Error('customizer boom');
    const e = validationError('prompt build failed', 'prompt', cause);
    expect(e._tag).toBe('ValidationError');
    expect(e.field).toBe('prompt');
    expect(e.cause).toBe(cause);
    expect(e.stack).toBeString();
  });

  test('validationError accepts non-Error cause unchanged', () => {
    // `cause: unknown` must passthrough whatever was thrown — strings, plain
    // objects, undefined-via-throw — without coercion, so downstream
    // diagnostics can recover the original shape.
    const e = validationError('build failed', 'prompt', 'boom');
    expect(e.cause).toBe('boom');
  });

  test('timeoutError creates tagged error with stack', () => {
    const e = timeoutError('timed out', 30_000);
    expect(e._tag).toBe('TimeoutError');
    expect(e.message).toBe('timed out');
    expect(e.timeoutMs).toBe(30_000);
    expect(e.stack).toBeString();
  });

  test('timeoutError rejects negative values', () => {
    expect(() => timeoutError('bad', -1)).toThrow(RangeError);
  });

  test('timeoutError rejects NaN', () => {
    expect(() => timeoutError('bad', NaN)).toThrow(RangeError);
  });

  test('timeoutError rejects Infinity', () => {
    expect(() => timeoutError('bad', Infinity)).toThrow(RangeError);
  });

  test('cancellationError creates tagged error with stack', () => {
    const e = cancellationError('aborted by user', 'user cancel');
    expect(e._tag).toBe('CancellationError');
    expect(e.message).toBe('aborted by user');
    expect(e.reason).toBe('user cancel');
    expect(e.stack).toBeString();
  });

  test('historyError creates tagged error with operation + cause', () => {
    const cause = new Error('store offline');
    const e = historyError('failed to persist', 'add_assistant_message', cause);
    expect(e._tag).toBe('HistoryError');
    expect(e.message).toBe('failed to persist');
    expect(e.operation).toBe('add_assistant_message');
    expect(e.cause).toBe(cause);
    expect(e.stack).toBeString();
  });

});

// One escape hatch (this single cast) instead of one per call site — keeps
// the test surface honest about which fields are minimal-fixture-only.
type IssueFixture = {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
};
const makeIssue = (fixture: IssueFixture): z.ZodIssue =>
  fixture as unknown as z.ZodIssue;

describe('requestValidationError', () => {
  test('classifies a sessionId issue as envelope layer', () => {
    const e = requestValidationError([
      makeIssue({
        code: 'invalid_type',
        path: ['sessionId'],
        message: 'expected string',
      }),
    ]);
    expect(e._tag).toBe('RequestValidationError');
    expect(e.layer).toBe('envelope');
    expect(e.field).toBe('sessionId');
    expect(e.issues).toHaveLength(1);
    expect(e.stack).toBeString();
  });

  test('classifies a request.context.layoutMode issue as payload layer', () => {
    const e = requestValidationError([
      makeIssue({
        code: 'invalid_value',
        path: ['request', 'context', 'layoutMode'],
        message: 'invalid enum value',
      }),
    ]);
    expect(e.layer).toBe('payload');
    expect(e.field).toBe('request.context.layoutMode');
  });

  test('classifies a content issue as payload layer', () => {
    const e = requestValidationError([
      makeIssue({
        code: 'too_small',
        path: ['content'],
        message: 'string must be non-empty',
      }),
    ]);
    expect(e.layer).toBe('payload');
    expect(e.field).toBe('content');
  });

  test('classifies an id issue as envelope layer', () => {
    const e = requestValidationError([
      makeIssue({ code: 'invalid_type', path: ['id'], message: 'x' }),
    ]);
    expect(e.layer).toBe('envelope');
  });

  test('classifies a timestamp issue as envelope layer', () => {
    const e = requestValidationError([
      makeIssue({ code: 'invalid_type', path: ['timestamp'], message: 'x' }),
    ]);
    expect(e.layer).toBe('envelope');
  });

  test('classifies a type-discriminator issue as envelope layer', () => {
    const e = requestValidationError([
      makeIssue({ code: 'invalid_value', path: ['type'], message: 'x' }),
    ]);
    expect(e.layer).toBe('envelope');
  });

  test('classifies a root-level (empty path) failure as envelope layer', () => {
    // A non-object input (null, 42, "chart_request") makes Zod emit a single
    // issue with path: []. The envelope itself is missing — this is
    // structurally an envelope failure, not a payload one.
    const e = requestValidationError([
      makeIssue({ code: 'invalid_type', path: [], message: 'expected object' }),
    ]);
    expect(e.layer).toBe('envelope');
    expect(e.field).toBe('(root)');
  });

  test('classifies based on the envelope issue even when payload issues come first', () => {
    // Defensive: Zod issue ordering is not a documented contract. If a
    // payload issue precedes an envelope one in the issues array, layer
    // derivation must still surface the envelope failure.
    const e = requestValidationError([
      makeIssue({
        code: 'invalid_value',
        path: ['request', 'context', 'layoutMode'],
        message: 'x',
      }),
      makeIssue({ code: 'too_small', path: ['sessionId'], message: 'y' }),
    ]);
    expect(e.layer).toBe('envelope');
    expect(e.field).toBe('sessionId');
  });

  test('handles degenerate empty issues without crashing', () => {
    // Zod never produces success:false with zero issues, but the constructor
    // is exported and a future caller might. Stay graceful — surface a
    // root envelope failure rather than crashing the engine.
    const e = requestValidationError([]);
    expect(e.layer).toBe('envelope');
    expect(e.field).toBe('(root)');
    expect(e.issues).toHaveLength(0);
  });
});

describe('EngineError pattern matching', () => {
  test('switch on _tag covers all variants', () => {
    const errors: EngineError[] = [
      parseError('a', ''),
      providerError('b', undefined),
      validationError('c'),
      requestValidationError([]),
      timeoutError('d', 1000),
      cancellationError('e', 'reason'),
      historyError('f', 'add_assistant_message', new Error('store')),
    ];

    const tags = errors.map((e) => {
      switch (e._tag) {
        case 'ParseError':
          return 'parse';
        case 'ProviderError':
          return 'provider';
        case 'ValidationError':
          return 'validation';
        case 'RequestValidationError':
          return 'requestValidation';
        case 'TimeoutError':
          return 'timeout';
        case 'CancellationError':
          return 'cancellation';
        case 'HistoryError':
          return 'history';
        default: {
          const _exhaustive: never = e;
          throw new Error(`Unknown tag: ${(_exhaustive as EngineError)._tag}`);
        }
      }
    });

    expect(tags).toEqual([
      'parse',
      'provider',
      'validation',
      'requestValidation',
      'timeout',
      'cancellation',
      'history',
    ]);
  });
});
