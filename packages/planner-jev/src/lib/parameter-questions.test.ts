import { describe, expect, test } from 'bun:test';

import {
  bindParameterChoices,
  parameterQuestions,
} from './parameter-questions.js';

const parameters = [
  { name: 'location', type: 'string', description: 'City' },
  { name: 'urgent', type: 'boolean', description: 'Urgent', required: false },
] as const;

describe('parameterQuestions', () => {
  test('asks one question per parameter under the prefix, led by the action', () => {
    const { slots, questions } = parameterQuestions(
      parameters,
      'param/0',
      'For action 1, setLocation on weather-main',
      'weather in Oslo',
      undefined,
    );
    expect(slots.map((slot) => slot.id)).toEqual([
      'param/0/location',
      'param/0/urgent',
    ]);
    const location = questions['param/0/location'];
    expect(location?.instructions).toStartWith(
      'For action 1, setLocation on weather-main, choose the value of location (string): City.',
    );
    expect(location?.type === 'choice' && location.criteria.v2).toBe('"Oslo"');
    const urgent = questions['param/0/urgent'];
    expect(urgent?.type === 'choice' && Object.keys(urgent.criteria)).toEqual([
      'v0',
      'v1',
      'stated_elsewhere',
      'not_stated',
      'omit',
    ]);
  });
});

describe('bindParameterChoices', () => {
  const { slots } = parameterQuestions(
    parameters,
    'p',
    'For x',
    'weather in Oslo',
    undefined,
  );

  test('binds candidates and skips omitted parameters', () => {
    expect(
      bindParameterChoices(slots, { 'p/location': 'v2', 'p/urgent': 'omit' }),
    ).toEqual({ params: { location: 'Oslo' }, pending: [], missing: [] });
  });

  test('leaves stated_elsewhere to the LLM and reports not_stated as missing', () => {
    const bound = bindParameterChoices(slots, {
      'p/location': 'stated_elsewhere',
      'p/urgent': 'not_stated',
    });
    expect(bound.params).toEqual({});
    expect(bound.pending.map((p) => p.name)).toEqual(['location']);
    expect(bound.missing.map((p) => p.name)).toEqual(['urgent']);
  });
});
