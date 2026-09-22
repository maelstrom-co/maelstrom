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
  MAX_CHOICES,
  noul,
  overOptionCap,
  type Reply,
  readAnswer,
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
