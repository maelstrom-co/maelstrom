import { describe, expect, test } from 'bun:test';
import {
  cancellationError,
  historyError,
  parseError,
  providerError,
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

  test('validationError creates tagged error without field', () => {
    const e = validationError('general validation failure');
    expect(e._tag).toBe('ValidationError');
    expect(e.message).toBe('general validation failure');
    expect(e.field).toBeUndefined();
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

describe('EngineError pattern matching', () => {
  test('switch on _tag covers all variants', () => {
    const errors: EngineError[] = [
      parseError('a', ''),
      providerError('b', undefined),
      validationError('c'),
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
      'timeout',
      'cancellation',
      'history',
    ]);
  });
});
