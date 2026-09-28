import { describe, expect, test } from 'bun:test';

import type { ActionParameterEnumSnapshot } from '@maelstrom-co/engine';
import type { ActionParameter } from '@maelstrom-co/protocol';

import {
  enumValues,
  MAX_SPAN_WORDS,
  parameterCandidates,
} from './parameters.js';

const param = (
  type: ActionParameter['type'],
  extra: Partial<ActionParameter> = {},
): ActionParameter => ({ name: 'p', description: 'p', type, ...extra });

describe('enumValues', () => {
  test('keeps only JSON values of the declared type', () => {
    expect(
      enumValues(
        param('string', { enum: ['Buy milk', 7, null, 'Send invoice'] }),
        undefined,
      ),
    ).toEqual(['Buy milk', 'Send invoice']);
    expect(
      enumValues(param('number', { enum: [1, '2', 3.5] }), undefined),
    ).toEqual([1, 3.5]);
  });

  test('drops values JSON cannot serialise', () => {
    expect(
      enumValues(param('string', { enum: [1n, () => 'x', 'ok'] }), undefined),
    ).toEqual(['ok']);
  });

  test('reads the request snapshot when one is given', () => {
    const snapshot: ActionParameterEnumSnapshot = {
      get: () => [{ serialized: '"From snapshot"', value: 'From snapshot' }],
    };
    expect(enumValues(param('string', { enum: ['x'] }), snapshot)).toEqual([
      'From snapshot',
    ]);
  });
});

describe('parameterCandidates', () => {
  test('enum values win over extraction', () => {
    expect(
      parameterCandidates(param('string'), 'show "Tokyo"', ['Paris', 'Rome']),
    ).toEqual(['Paris', 'Rome']);
  });

  test('booleans offer true and false', () => {
    expect(parameterCandidates(param('boolean'), 'whatever', [])).toEqual([
      true,
      false,
    ]);
  });

  test('numbers are read from the intent, deduplicated', () => {
    expect(
      parameterCandidates(
        param('number'),
        'show 5 tasks, not 5 or -2.5 or v2',
        [],
      ),
    ).toEqual([5, -2.5]);
  });

  test('quoted strings are preferred over spans', () => {
    expect(
      parameterCandidates(
        param('string'),
        'Set weather to "Tokyo" and “Paris”',
        [],
      ),
    ).toEqual(['Tokyo', 'Paris']);
  });

  test('unquoted strings offer every 1 to 8 word span', () => {
    const candidates = parameterCandidates(
      param('string'),
      'weather in New York',
      [],
    );
    expect(candidates).toContain('New York');
    expect(candidates).toContain('weather in New York');
    expect(candidates).toContain('York');
    expect(candidates).toHaveLength(4 + 3 + 2 + 1);
  });

  test('objects get no candidates', () => {
    expect(parameterCandidates(param('object'), 'import "x"', [])).toEqual([]);
  });

  test('a long unquoted intent yields no candidates instead of deferring', () => {
    const intent = Array.from(
      { length: MAX_SPAN_WORDS + 1 },
      (_, i) => `w${i}`,
    ).join(' ');
    expect(parameterCandidates(param('string'), intent, [])).toEqual([]);
  });

  test('candidates over the option cap yield none', () => {
    const quoted = (n: number) =>
      Array.from({ length: n }, (_, i) => `"q${i}"`).join(' ');
    expect(parameterCandidates(param('string'), quoted(252), [])).toHaveLength(
      252,
    );
    expect(parameterCandidates(param('string'), quoted(253), [])).toEqual([]);
  });
});
