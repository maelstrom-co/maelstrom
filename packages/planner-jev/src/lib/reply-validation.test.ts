import { describe, expect, test } from 'bun:test';

import { err, isOk } from '@maelstrom-co/protocol';

import { choice, type Evaluation, noul, score } from './questions.js';
import {
  choiceAnswer,
  type InvalidReplyReason,
  levelAnswer,
  validateWireAnswers,
} from './reply-validation.js';

const OPTIONS = ['keep', 'hide', 'delete'] as const;

describe('choiceAnswer', () => {
  test('accepts a choice with the highest probability over exactly the options', () => {
    const result = choiceAnswer(
      'hide',
      0.6,
      { keep: 0.2, hide: 0.7, delete: 0.1 },
      OPTIONS,
    );
    expect(isOk(result) && result.value).toEqual({
      choice: 'hide',
      confidence: 0.6,
      probabilities: { keep: 0.2, hide: 0.7, delete: 0.1 },
    });
  });

  test('accepts a choice tied for the highest probability', () => {
    const result = choiceAnswer(
      'keep',
      0.1,
      { keep: 0.5, hide: 0.5, delete: 0 },
      OPTIONS,
    );
    expect(isOk(result) && result.value.choice).toBe('keep');
  });

  test('accepts probabilities that sum to one within 0.02', () => {
    expect(
      isOk(
        choiceAnswer(
          'hide',
          1,
          { keep: 0.01, hide: 0.98, delete: 0.02 },
          OPTIONS,
        ),
      ),
    ).toBe(true);
  });

  test.each<[string, unknown, unknown, unknown, InvalidReplyReason]>([
    [
      'a choice outside the options',
      'maybe',
      0.5,
      { keep: 1, hide: 0, delete: 0 },
      'key_mismatch',
    ],
    [
      'a non-string choice',
      1,
      0.5,
      { keep: 1, hide: 0, delete: 0 },
      'malformed_json',
    ],
    [
      'probabilities missing an option',
      'keep',
      0.5,
      { keep: 1, hide: 0 },
      'key_mismatch',
    ],
    [
      'probabilities over an extra option',
      'keep',
      0.5,
      { keep: 1, hide: 0, delete: 0, maybe: 0 },
      'key_mismatch',
    ],
    [
      'probabilities that do not sum to one',
      'keep',
      0.5,
      { keep: 0.9, hide: 0.05, delete: 0 },
      'probability_sum',
    ],
    [
      'a choice without the highest probability',
      'keep',
      0.5,
      { keep: 0.2, hide: 0.8, delete: 0 },
      'not_most_probable',
    ],
    [
      'a probability outside [0, 1]',
      'keep',
      0.5,
      { keep: 1.2, hide: -0.2, delete: 0 },
      'out_of_range',
    ],
    [
      'a non-numeric probability',
      'keep',
      0.5,
      { keep: '1', hide: 0, delete: 0 },
      'malformed_json',
    ],
    [
      'a confidence outside [0, 1]',
      'keep',
      1.5,
      { keep: 1, hide: 0, delete: 0 },
      'out_of_range',
    ],
    [
      'a non-numeric confidence',
      'keep',
      'high',
      { keep: 1, hide: 0, delete: 0 },
      'malformed_json',
    ],
    [
      'probabilities that are not a record',
      'keep',
      0.5,
      [1, 0, 0],
      'malformed_json',
    ],
  ])('rejects %s', (_name, chosen, confidence, probabilities, reason) => {
    expect(choiceAnswer(chosen, confidence, probabilities, OPTIONS)).toEqual(
      err(reason),
    );
  });
});

describe('levelAnswer', () => {
  test('picks the most probable level and keeps the fractional score', () => {
    const result = levelAnswer(1.43, 0.35, { '0': 0, '1': 0.57, '2': 0.43 }, 3);
    expect(isOk(result) && result.value).toEqual({
      choice: '1',
      confidence: 0.35,
      score: 1.43,
      probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
    });
  });

  test('picks the most probable level even where the rounded score disagrees', () => {
    const high = levelAnswer(1.6, 0.4, { '0': 0.3, '1': 0, '2': 0.7 }, 3);
    expect(isOk(high) && high.value.choice).toBe('2');
    const low = levelAnswer(1.4, 0.4, { '0': 0.5, '1': 0, '2': 0.5 }, 3);
    expect(isOk(low) && low.value.choice).toBe('0');
  });

  test('picks the lower level on a tie', () => {
    const result = levelAnswer(0.5, 0.2, { '0': 0.5, '1': 0.5, '2': 0 }, 3);
    expect(isOk(result) && result.value.choice).toBe('0');
  });

  test('accepts the end points of the score range', () => {
    const bottom = levelAnswer(0, 1, { '0': 1, '1': 0, '2': 0 }, 3);
    expect(isOk(bottom) && bottom.value.score).toBe(0);
    const top = levelAnswer(2, 1, { '0': 0, '1': 0, '2': 1 }, 3);
    expect(isOk(top) && top.value.score).toBe(2);
  });

  test.each<[string, unknown, unknown, unknown, InvalidReplyReason]>([
    [
      'a score below zero',
      -0.1,
      0.5,
      { '0': 1, '1': 0, '2': 0 },
      'out_of_range',
    ],
    [
      'a score above the top level',
      2.1,
      0.5,
      { '0': 0, '1': 0, '2': 1 },
      'out_of_range',
    ],
    [
      'a non-finite score',
      Number.NaN,
      0.5,
      { '0': 1, '1': 0, '2': 0 },
      'out_of_range',
    ],
    [
      'a non-numeric score',
      '1',
      0.5,
      { '0': 0, '1': 1, '2': 0 },
      'malformed_json',
    ],
    [
      'a confidence outside [0, 1]',
      1,
      1.2,
      { '0': 0, '1': 1, '2': 0 },
      'out_of_range',
    ],
    [
      'a non-numeric confidence',
      1,
      'high',
      { '0': 0, '1': 1, '2': 0 },
      'malformed_json',
    ],
    [
      'a non-numeric probability',
      1,
      0.5,
      { '0': 0, '1': '1', '2': 0 },
      'malformed_json',
    ],
    [
      'probabilities missing a level',
      1,
      0.5,
      { '1': 0.57, '2': 0.43 },
      'key_mismatch',
    ],
    [
      'probabilities over an extra level',
      1,
      0.5,
      { '0': 0, '1': 0.57, '2': 0.43, '3': 0 },
      'key_mismatch',
    ],
    [
      'probabilities that do not sum to one',
      1,
      0.5,
      { '0': 0, '1': 0.5, '2': 0.43 },
      'probability_sum',
    ],
    [
      'a probability outside [0, 1]',
      1,
      0.5,
      { '0': -0.2, '1': 0.77, '2': 0.43 },
      'out_of_range',
    ],
    [
      'probabilities that are not a record',
      1,
      0.5,
      [0, 1, 0],
      'malformed_json',
    ],
  ])('rejects %s', (_name, value, confidence, probabilities, reason) => {
    expect(levelAnswer(value, confidence, probabilities, 3)).toEqual(
      err(reason),
    );
  });
});

describe('validateWireAnswers', () => {
  const LEVELS = ['Nothing happened', 'Some of it happened', 'All of it'];
  const evaluation: Evaluation = {
    state: { intent: 'hide the weather' },
    questions: {
      scope: choice('Is it supported?', {
        supported: 'yes',
        unsupported: 'no',
        ambiguous: 'unclear',
      }),
      needsActions: noul('Does it need actions?'),
      satisfied: score('Did the response do what was asked?', LEVELS),
    },
  };
  const scope = {
    type: 'choice',
    choice: 'supported',
    confidence: 0.8,
    probabilities: { supported: 1, unsupported: 0, ambiguous: 0 },
  };
  const needsActions = { type: 'noul', noul: 0.75 };
  const satisfied = {
    type: 'score',
    score: 1.43,
    confidence: 0.35,
    legend: { '0': LEVELS[0], '1': LEVELS[1], '2': LEVELS[2] },
    probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
  };
  const valid = (): Record<string, unknown> => ({
    scope,
    needsActions,
    satisfied,
  });

  test('accepts every kind of answer and keeps their probabilities', () => {
    const result = validateWireAnswers(valid(), evaluation);
    expect(isOk(result) && result.value).toEqual({
      scope: {
        choice: 'supported',
        confidence: 0.8,
        probabilities: { supported: 1, unsupported: 0, ambiguous: 0 },
      },
      needsActions: {
        choice: 'yes',
        confidence: 0.5,
        probability: 0.75,
        probabilities: { yes: 0.75, no: 0.25 },
      },
      satisfied: {
        choice: '1',
        confidence: 0.35,
        score: 1.43,
        probabilities: { '0': 0, '1': 0.57, '2': 0.43 },
      },
    });
  });

  test.each<[string, unknown, InvalidReplyReason]>([
    ['answers that are not a record', [scope], 'malformed_json'],
    ['a missing question id', { scope, needsActions }, 'missing_answer'],
    ['an extra question id', { ...valid(), extra: scope }, 'key_mismatch'],
    [
      'a missing id next to an extra one',
      { scope, needsActions, extra: satisfied },
      'missing_answer',
    ],
    [
      'an answer that is not an object',
      { ...valid(), scope: 3 },
      'malformed_json',
    ],
    [
      'an answer without a type',
      { ...valid(), scope: { ...scope, type: undefined } },
      'malformed_json',
    ],
    [
      'a non-choice answer type',
      { ...valid(), scope: { ...scope, type: 'text' } },
      'wrong_type',
    ],
    [
      'a noul answer to a choice question',
      { ...valid(), scope: needsActions },
      'wrong_type',
    ],
    [
      'a score answer to a choice question',
      { ...valid(), scope: satisfied },
      'wrong_type',
    ],
    [
      'a choice answer to a noul question',
      { ...valid(), needsActions: scope },
      'wrong_type',
    ],
    [
      'a noul answer to a score question',
      { ...valid(), satisfied: needsActions },
      'wrong_type',
    ],
    [
      'a choice outside the criteria',
      { ...valid(), scope: { ...scope, choice: 'maybe' } },
      'key_mismatch',
    ],
    [
      'probabilities over the wrong options',
      {
        ...valid(),
        scope: { ...scope, probabilities: { supported: 1, unsupported: 0 } },
      },
      'key_mismatch',
    ],
    [
      'probabilities that do not sum to one',
      {
        ...valid(),
        scope: {
          ...scope,
          probabilities: { supported: 0.9, unsupported: 0.05, ambiguous: 0 },
        },
      },
      'probability_sum',
    ],
    [
      'a chosen option without the highest probability',
      {
        ...valid(),
        scope: {
          ...scope,
          probabilities: { supported: 0.2, unsupported: 0.8, ambiguous: 0 },
        },
      },
      'not_most_probable',
    ],
    [
      'a confidence outside [0, 1]',
      { ...valid(), scope: { ...scope, confidence: 1.5 } },
      'out_of_range',
    ],
    [
      'a noul outside [0, 1]',
      { ...valid(), needsActions: { type: 'noul', noul: 1.2 } },
      'out_of_range',
    ],
    [
      'a missing noul value',
      { ...valid(), needsActions: { type: 'noul' } },
      'malformed_json',
    ],
    [
      'levels echoed out of order',
      {
        ...valid(),
        satisfied: {
          ...satisfied,
          legend: { '0': LEVELS[1], '1': LEVELS[0], '2': LEVELS[2] },
        },
      },
      'key_mismatch',
    ],
    [
      'a level echoed with different text',
      {
        ...valid(),
        satisfied: {
          ...satisfied,
          legend: { '0': LEVELS[0], '1': 'Half of it', '2': LEVELS[2] },
        },
      },
      'key_mismatch',
    ],
    [
      'a legend missing a level',
      {
        ...valid(),
        satisfied: { ...satisfied, legend: { '0': LEVELS[0], '1': LEVELS[1] } },
      },
      'key_mismatch',
    ],
    [
      'a legend with an extra level',
      {
        ...valid(),
        satisfied: {
          ...satisfied,
          legend: { '0': LEVELS[0], '1': LEVELS[1], '2': LEVELS[2], '3': 'x' },
        },
      },
      'key_mismatch',
    ],
    [
      'a missing legend',
      { ...valid(), satisfied: { ...satisfied, legend: undefined } },
      'malformed_json',
    ],
    [
      'a score below zero',
      { ...valid(), satisfied: { ...satisfied, score: -0.1 } },
      'out_of_range',
    ],
    [
      'a score above the top level',
      { ...valid(), satisfied: { ...satisfied, score: 2.1 } },
      'out_of_range',
    ],
    [
      'a non-numeric score',
      { ...valid(), satisfied: { ...satisfied, score: '1.43' } },
      'malformed_json',
    ],
    [
      'score probabilities over an extra level',
      {
        ...valid(),
        satisfied: {
          ...satisfied,
          probabilities: { '0': 0, '1': 0.57, '2': 0.43, '3': 0 },
        },
      },
      'key_mismatch',
    ],
    [
      'score probabilities that do not sum to one',
      {
        ...valid(),
        satisfied: {
          ...satisfied,
          probabilities: { '0': 0.1, '1': 0.57, '2': 0.43 },
        },
      },
      'probability_sum',
    ],
  ])('rejects %s', (_name, answers, reason) => {
    expect(validateWireAnswers(answers, evaluation)).toEqual(err(reason));
  });
});
