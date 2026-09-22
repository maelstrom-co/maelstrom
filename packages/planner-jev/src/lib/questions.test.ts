import { describe, expect, test } from 'bun:test';

import { isErr, isOk } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeInput,
  makeRequest,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import {
  choice,
  isScoreAnswer,
  MAX_CHOICES,
  MAX_LEVELS,
  MIN_LEVELS,
  noul,
  overOptionCap,
  type Reply,
  readAnswer,
  score,
} from './questions.js';

const reply: Reply = {
  answers: { scope: { choice: 'supported', confidence: 0.3 } },
  usage: { inputTokens: 1, outputTokens: 1 },
};

function context() {
  const spy = spyLogger();
  return {
    ...spy,
    ctx: makeContext(makeInput(makeRequest('hi')), { logger: spy.logger }),
  };
}

describe('overOptionCap', () => {
  test('accepts exactly MAX_CHOICES options and flags one more', () => {
    const options = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, 'x']));
    expect(
      overOptionCap({
        state: {},
        questions: { a: choice('a', options(MAX_CHOICES)) },
      }),
    ).toBe(undefined);
    expect(
      overOptionCap({
        state: {},
        questions: {
          a: choice('a', options(2)),
          b: choice('b', options(MAX_CHOICES + 1)),
        },
      }),
    ).toBe('b');
  });
});

describe('noul', () => {
  test('builds a yes/no question without criteria', () => {
    expect(noul('Does it ask for actions?')).toEqual({
      type: 'noul',
      instructions: 'Does it ask for actions?',
    });
  });

  test('is never over the option cap', () => {
    expect(
      overOptionCap({ state: {}, questions: { gate: noul('Is it?') } }),
    ).toBe(undefined);
  });
});

describe('score', () => {
  const levels = (n: number) =>
    Array.from({ length: n }, (_, i) => `level ${i}`);

  test('builds a score question with its levels as ordered criteria', () => {
    expect(score('How well?', ['Not at all', 'Partly', 'Fully'])).toEqual({
      type: 'score',
      instructions: 'How well?',
      criteria: ['Not at all', 'Partly', 'Fully'],
    });
  });

  test('copies the levels so later edits to the input do not leak in', () => {
    const input = ['low', 'high'];
    const question = score('How much?', input);
    input.push('extra');
    expect(question.criteria).toEqual(['low', 'high']);
  });

  test('accepts MIN_LEVELS and MAX_LEVELS levels', () => {
    expect(MIN_LEVELS).toBe(2);
    expect(MAX_LEVELS).toBe(10);
    expect(score('a', levels(MIN_LEVELS)).criteria).toHaveLength(MIN_LEVELS);
    expect(score('a', levels(MAX_LEVELS)).criteria).toHaveLength(MAX_LEVELS);
  });

  test.each([
    ['no levels', 0],
    ['one level', 1],
    ['more than MAX_LEVELS levels', 11],
  ])('rejects %s', (_name, count) => {
    expect(() => score('a', levels(count))).toThrow(RangeError);
  });

  test('is never over the option cap', () => {
    expect(
      overOptionCap({
        state: {},
        questions: { grade: score('How well?', levels(MAX_LEVELS)) },
      }),
    ).toBe(undefined);
  });
});

describe('isScoreAnswer', () => {
  test('tells score answers from choice and noul answers', () => {
    expect(
      isScoreAnswer({
        choice: '1',
        confidence: 0.4,
        score: 1.2,
        probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 },
      }),
    ).toBe(true);
    expect(isScoreAnswer({ choice: 'supported', confidence: 0.3 })).toBe(false);
    expect(
      isScoreAnswer({ choice: 'yes', confidence: 0.5, probability: 0.75 }),
    ).toBe(false);
  });
});

describe('readAnswer', () => {
  test('logs the answer with its confidence and has no gate by default', () => {
    const { ctx, entries } = context();
    const result = readAnswer(reply, 'scope', 'jevSelect', ctx);
    expect(isOk(result) && result.value).toEqual({
      choice: 'supported',
      confidence: 0.3,
    });
    expect(entries).toContainEqual({
      level: 'debug',
      msg: 'jev.answer',
      data: {
        stage: 'jevSelect',
        question: 'scope',
        choice: 'supported',
        confidence: 0.3,
      },
    });
  });

  test('defers below an explicit minimum', () => {
    const { ctx } = context();
    const result = readAnswer(reply, 'scope', 'jevSelect', ctx, {
      minimum: 0.5,
    });
    expect(isErr(result) && result.error.reason).toBe(
      'jevSelect/low_confidence',
    );
  });

  test('defers when the answer is missing', () => {
    const { ctx } = context();
    const result = readAnswer(reply, 'layout', 'jevLayout', ctx);
    expect(isErr(result) && result.error.reason).toBe(
      'jevLayout/answer_missing',
    );
  });
});
