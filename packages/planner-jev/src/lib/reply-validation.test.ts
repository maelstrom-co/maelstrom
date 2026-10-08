import { describe, expect, test } from 'bun:test';

import { choiceAnswer, levelAnswer } from './reply-validation.js';

const OPTIONS = ['keep', 'hide', 'delete'] as const;

describe('choiceAnswer', () => {
  test('accepts a choice with the highest probability over exactly the options', () => {
    expect(
      choiceAnswer('hide', 0.6, { keep: 0.2, hide: 0.7, delete: 0.1 }, OPTIONS),
    ).toEqual({
      choice: 'hide',
      confidence: 0.6,
      probabilities: { keep: 0.2, hide: 0.7, delete: 0.1 },
    });
  });

  test('accepts a choice tied for the highest probability', () => {
    expect(
      choiceAnswer('keep', 0.1, { keep: 0.5, hide: 0.5, delete: 0 }, OPTIONS)
        ?.choice,
    ).toBe('keep');
  });

  test('accepts probabilities that sum to one within 0.02', () => {
    expect(
      choiceAnswer(
        'hide',
        1,
        { keep: 0.01, hide: 0.98, delete: 0.02 },
        OPTIONS,
      ),
    ).not.toBe(undefined);
  });

  test.each([
    [
      'a choice outside the options',
      'maybe',
      0.5,
      { keep: 1, hide: 0, delete: 0 },
    ],
    ['a non-string choice', 1, 0.5, { keep: 1, hide: 0, delete: 0 }],
    ['probabilities missing an option', 'keep', 0.5, { keep: 1, hide: 0 }],
    [
      'probabilities over an extra option',
      'keep',
      0.5,
      { keep: 1, hide: 0, delete: 0, maybe: 0 },
    ],
    [
      'probabilities that do not sum to one',
      'keep',
      0.5,
      { keep: 0.9, hide: 0.05, delete: 0 },
    ],
    [
      'a choice without the highest probability',
      'keep',
      0.5,
      { keep: 0.2, hide: 0.8, delete: 0 },
    ],
    [
      'a probability outside [0, 1]',
      'keep',
      0.5,
      { keep: 1.2, hide: -0.2, delete: 0 },
    ],
    [
      'a confidence outside [0, 1]',
      'keep',
      1.5,
      { keep: 1, hide: 0, delete: 0 },
    ],
    ['probabilities that are not a record', 'keep', 0.5, [1, 0, 0]],
  ])('rejects %s', (_name, chosen, confidence, probabilities) => {
    expect(choiceAnswer(chosen, confidence, probabilities, OPTIONS)).toBe(
      undefined,
    );
  });
});

describe('levelAnswer', () => {
  test('picks the most probable level and keeps the fractional score', () => {
    expect(
      levelAnswer(1.43, 0.35, { '0': 0, '1': 0.57, '2': 0.43 }, 3),
    ).toEqual({
      choice: '1',
      confidence: 0.35,
      score: 1.43,
      probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
    });
  });

  test('picks the most probable level even where the rounded score disagrees', () => {
    expect(
      levelAnswer(1.6, 0.4, { '0': 0.3, '1': 0, '2': 0.7 }, 3)?.choice,
    ).toBe('2');
    expect(
      levelAnswer(1.4, 0.4, { '0': 0.5, '1': 0, '2': 0.5 }, 3)?.choice,
    ).toBe('0');
  });

  test('picks the lower level on a tie', () => {
    expect(
      levelAnswer(0.5, 0.2, { '0': 0.5, '1': 0.5, '2': 0 }, 3)?.choice,
    ).toBe('0');
  });

  test('accepts the end points of the score range', () => {
    expect(levelAnswer(0, 1, { '0': 1, '1': 0, '2': 0 }, 3)?.score).toBe(0);
    expect(levelAnswer(2, 1, { '0': 0, '1': 0, '2': 1 }, 3)?.score).toBe(2);
  });

  test.each([
    ['a score below zero', -0.1, 0.5, { '0': 1, '1': 0, '2': 0 }],
    ['a score above the top level', 2.1, 0.5, { '0': 0, '1': 0, '2': 1 }],
    ['a non-finite score', Number.NaN, 0.5, { '0': 1, '1': 0, '2': 0 }],
    ['a non-numeric score', '1', 0.5, { '0': 0, '1': 1, '2': 0 }],
    ['a confidence outside [0, 1]', 1, 1.2, { '0': 0, '1': 1, '2': 0 }],
    ['probabilities missing a level', 1, 0.5, { '1': 0.57, '2': 0.43 }],
    [
      'probabilities over an extra level',
      1,
      0.5,
      { '0': 0, '1': 0.57, '2': 0.43, '3': 0 },
    ],
    [
      'probabilities that do not sum to one',
      1,
      0.5,
      { '0': 0, '1': 0.5, '2': 0.43 },
    ],
    [
      'a probability outside [0, 1]',
      1,
      0.5,
      { '0': -0.2, '1': 0.77, '2': 0.43 },
    ],
  ])('rejects %s', (_name, value, confidence, probabilities) => {
    expect(levelAnswer(value, confidence, probabilities, 3)).toBe(undefined);
  });
});
