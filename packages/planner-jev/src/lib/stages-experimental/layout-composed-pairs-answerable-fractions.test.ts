import { describe, expect, test } from 'bun:test';

import { ok } from '@maelstrom-co/protocol';
import {
  makeContext,
  makeInput,
  makeRequest,
} from '../__test-helpers__/fixtures.js';
import type { Ask } from '../ask.js';
import { STAGE_NAME } from '../defer.js';
import { type Evaluation, noul, score } from '../questions.js';
import { withAnswerableFractions } from './layout-composed-pairs-answerable-fractions.js';

describe('withAnswerableFractions', () => {
  test('tells every fraction-in-group question what to answer when the request states no fraction, and leaves other questions alone', async () => {
    const seen: Evaluation[] = [];
    const ask: Ask = async (_stage, evaluation) => {
      seen.push(evaluation);
      return ok({ answers: {}, usage: { inputTokens: 0, outputTokens: 0 } });
    };
    const fraction = score(
      'What fraction of its column does the request give tasks-main?',
      ['a quarter', 'a third', 'half', 'two thirds', 'three quarters'],
    );
    const stated = noul('Does the request state a fraction for tasks-main?');
    const input = makeInput(makeRequest('swap them'));
    await withAnswerableFractions(ask)(
      STAGE_NAME.jevLayout,
      {
        state: {},
        questions: {
          'fraction_in_group/tasks-main': fraction,
          'size_stated_in_group/tasks-main': stated,
        },
      },
      makeContext(input),
    );
    const [sent] = seen;
    const rewritten = sent?.questions['fraction_in_group/tasks-main'];
    expect(rewritten?.type).toBe('score');
    expect(rewritten?.instructions).toStartWith(fraction.instructions);
    expect(rewritten?.instructions).toContain(
      'When the `request` states no such fraction, answer half of its row or column',
    );
    expect(rewritten?.type === 'score' && rewritten.criteria).toEqual(
      fraction.criteria,
    );
    expect(sent?.questions['size_stated_in_group/tasks-main']).toBe(stated);
  });
});
