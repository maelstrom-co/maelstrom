import { describe, expect, test } from 'bun:test';
import {
  cancellationError,
  historyError,
  layoutValidationError,
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

  test('layoutValidationError throws on empty failures', () => {
    expect(() => layoutValidationError([])).toThrow(RangeError);
  });

  test('layoutValidationError stores a defensive copy of failures', () => {
    const source = [{ kind: 'missing_rationale' } as const];
    const e = layoutValidationError(source);
    // Mutating the source after construction must not affect the error.
    (source as Array<{ kind: string }>).push({ kind: 'mutated' });
    expect(e.failures).toHaveLength(1);
  });

  test('layoutValidationError single-failure message uses the "failed:" prefix', () => {
    const e = layoutValidationError([{ kind: 'missing_rationale' }]);
    expect(e.message).toBe('Layout validation failed: rationale is empty');
  });

  test('layoutValidationError multi-failure message uses pluralized prefix', () => {
    const e = layoutValidationError([
      { kind: 'missing_rationale' },
      { kind: 'duplicate_instance_id', instanceId: 'foo' },
    ]);
    expect(e.message).toBe(
      'Layout validation failed with 2 issues: rationale is empty; duplicate instanceId "foo"',
    );
  });
});

describe('describeFailure (via layoutValidationError.message)', () => {
  const messageOf = (
    failure: Parameters<typeof layoutValidationError>[0][number],
  ) =>
    layoutValidationError([failure]).message.replace(
      'Layout validation failed: ',
      '',
    );

  test('missing_rationale', () => {
    expect(messageOf({ kind: 'missing_rationale' })).toBe('rationale is empty');
  });

  test('duplicate_instance_id', () => {
    expect(
      messageOf({ kind: 'duplicate_instance_id', instanceId: 'calendar-main' }),
    ).toBe('duplicate instanceId "calendar-main"');
  });

  test('position_overflow', () => {
    expect(
      messageOf({
        kind: 'position_overflow',
        instanceId: 'calendar-main',
        row: 6,
        column: 10,
        width: 4,
        height: 4,
        chartColumns: 12,
        chartRows: 8,
      }),
    ).toBe('"calendar-main" at (row=6,col=10) size 4x4 exceeds chart 12x8');
  });

  test('size_below_minimum', () => {
    expect(
      messageOf({
        kind: 'size_below_minimum',
        instanceId: 'calendar-main',
        width: 2,
        height: 2,
        minWidth: 4,
        minHeight: 4,
      }),
    ).toBe('"calendar-main" size 2x2 is below minSize 4x4');
  });

  test('unknown_instance', () => {
    expect(messageOf({ kind: 'unknown_instance', instanceId: 'ghost' })).toBe(
      'unknown instanceId "ghost"',
    );
  });

  test('unknown_vessel', () => {
    expect(
      messageOf({
        kind: 'unknown_vessel',
        instanceId: 'calendar-main',
        vesselId: 'ghost-vessel',
      }),
    ).toBe('"calendar-main" references unknown vessel "ghost-vessel"');
  });

  test('unknown_variant', () => {
    expect(
      messageOf({
        kind: 'unknown_variant',
        instanceId: 'calendar-main',
        variant: 'year',
      }),
    ).toBe('"calendar-main" has unknown variant "year"');
  });

  test('tree_missing_child', () => {
    expect(messageOf({ kind: 'tree_missing_child', atTokenIndex: 3 })).toBe(
      'tree split at token index 3 is missing a child',
    );
  });

  test('tree_extra_tokens', () => {
    expect(messageOf({ kind: 'tree_extra_tokens', unconsumedCount: 2 })).toBe(
      'tree has 2 unconsumed token(s) after parse',
    );
  });

  test('orphan_tree_reference', () => {
    expect(
      messageOf({ kind: 'orphan_tree_reference', instanceId: 'ghost' }),
    ).toBe('tree references unknown instance "ghost"');
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
      layoutValidationError([{ kind: 'missing_rationale' }]),
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
        case 'LayoutValidationError':
          return 'layout';
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
      'layout',
      'history',
    ]);
  });
});
