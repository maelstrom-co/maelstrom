import { expect, test } from 'bun:test';

import { isErr } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeInput,
  makeRequest,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import { deferAt } from './defer.js';

test('deferAt prefixes the reason with the stage and logs it at info', () => {
  const { logger, entries } = spyLogger();
  const ctx = makeContext(makeInput(makeRequest('hi')), { logger });
  const result = deferAt(ctx, 'jevSelect', 'scope_ambiguous', 'scope');
  expect(isErr(result) && result.error).toEqual({
    _tag: 'Deferred',
    reason: 'jevSelect/scope_ambiguous',
  });
  expect(entries).toEqual([
    {
      level: 'info',
      msg: 'jev.defer',
      data: {
        stage: 'jevSelect',
        reason: 'jevSelect/scope_ambiguous',
        question: 'scope',
      },
    },
  ]);
});
