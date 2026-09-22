import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import { conversation } from '../__test-helpers__/actions-fixtures.js';
import { makeInput, makeRequest } from '../__test-helpers__/fixtures.js';
import { runPair } from '../__test-helpers__/stage-pair.js';
import { jevSelect } from '../stages/jev-select.js';
import { selectV1 } from './select-v1.js';

describe('selectV1', () => {
  test('sends the POC selection call and returns its selection without gates', async () => {
    const input = makeInput(makeRequest('add a second weather widget'));
    const { poc, next } = await runPair(
      jevSelect,
      selectV1,
      input,
      input,
      conversation({
        select: { 'view/tasks-main': 'hide', 'new/weather': 'one/current' },
        confidence: 0.7,
      }),
    );
    expect(next.calls).toEqual(poc.calls);
    expect(next.plain).toEqual(poc.result);
    expect(isOk(next.result) && 'gates' in next.result.value).toBe(false);
  });

  test('defers exactly like the POC', async () => {
    const input = makeInput(makeRequest('hide the tasks'));
    const { poc, next } = await runPair(
      jevSelect,
      selectV1,
      input,
      input,
      conversation({ select: { scope: 'ambiguous' } }),
    );
    expect(next.plain).toEqual(poc.result);
    expect(poc.result).toMatchObject({
      error: { reason: 'jevSelect/scope_ambiguous' },
    });
  });
});
