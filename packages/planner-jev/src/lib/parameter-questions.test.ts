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

  test('lets an enumerated parameter match a listed value by a short name or reference', () => {
    const { questions } = parameterQuestions(
      [
        {
          name: 'destination',
          type: 'string',
          description: 'Destination',
          enum: ['Home', 'Studio Vortex HQ'],
        },
      ],
      'param/0',
      'For action 1, showRoute on map-main',
      'route to the studio',
      undefined,
    );
    const destination = questions['param/0/destination'];
    const instructions = destination?.instructions as {
      readonly question: string;
    };
    expect(instructions.question).toContain(
      'Choose the listed value the latest intent clearly refers to, even when the wording differs.',
    );
    expect(instructions.question).not.toContain('itself the value');
    expect(
      destination?.type === 'choice' && destination.criteria.stated_elsewhere,
    ).toBe(
      'The latest intent gives a value that no listed option clearly matches, or that several listed options could match.',
    );
  });

  test('carries the enumerated parameter definition with its listed values in the question', () => {
    const { questions } = parameterQuestions(
      [
        {
          name: 'destination',
          type: 'string',
          description: 'Destination',
          enum: ['Home', 'Studio Vortex HQ'],
        },
      ],
      'param/0',
      'For action 1, showRoute on map-main',
      'route to the studio',
      undefined,
    );
    expect(questions['param/0/destination']?.instructions).toEqual({
      question: expect.stringMatching(
        /^For action 1, showRoute on map-main, choose the value of destination \(string\): Destination\. /,
      ),
      parameter: {
        name: 'destination',
        type: 'string',
        description: 'Destination',
        enum: ['Home', 'Studio Vortex HQ'],
      },
    });
  });

  test('asks a free-form parameter in plain text', () => {
    const { questions } = parameterQuestions(
      parameters,
      'param/0',
      'For action 1, setLocation on weather-main',
      'weather in Oslo',
      undefined,
    );
    expect(typeof questions['param/0/location']?.instructions).toBe('string');
  });

  test('keeps a free-form parameter to a span that is itself the value', () => {
    const { questions } = parameterQuestions(
      parameters,
      'param/0',
      'For action 1, setLocation on weather-main',
      'weather in the city where the Eiffel Tower stands',
      undefined,
    );
    const location = questions['param/0/location'];
    expect(location?.instructions).toContain(
      'Pick an option only when it is itself the value',
    );
    expect(
      location?.type === 'choice' && location.criteria.stated_elsewhere,
    ).toContain('refers to the value indirectly');
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
