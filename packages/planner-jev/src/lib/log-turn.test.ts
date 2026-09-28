import { describe, expect, test } from 'bun:test';

import type { Planner } from '@maelstrom-co/engine';
import { err, ok } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeInput,
  makeRequest,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import { logTurns } from './log-turn.js';

const candidate = {
  userMessage: 'Swapped the calendar and the map.',
  layout: { tree: ['V', 'ID:map-main', 'ID:calendar-main'] },
};

describe('logTurns', () => {
  test('logs the request and the shipped candidate at debug', async () => {
    const planner: Planner = async () => ok(candidate as never);
    const input = makeInput(makeRequest('swap the calendar and the map'));
    const { logger, entries } = spyLogger();
    await logTurns(planner)(input, makeContext(input, { logger }));
    expect(entries).toEqual([
      {
        level: 'debug',
        msg: 'jev.request',
        data: {
          messageId: input.messageId,
          request: 'swap the calendar and the map',
        },
      },
      {
        level: 'debug',
        msg: 'jev.result',
        data: {
          messageId: input.messageId,
          outcome: 'ok',
          candidate: JSON.stringify(candidate),
        },
      },
    ]);
  });

  test('logs a failed turn with its error tag and passes the result through', async () => {
    const failure = { _tag: 'CancellationError', message: 'cancelled' };
    const planner: Planner = async () => err(failure as never);
    const input = makeInput(makeRequest('swap them'));
    const { logger, entries } = spyLogger();
    const result = await logTurns(planner)(
      input,
      makeContext(input, { logger }),
    );
    expect(result).toEqual(err(failure as never));
    expect(entries.at(-1)).toEqual({
      level: 'debug',
      msg: 'jev.result',
      data: {
        messageId: input.messageId,
        outcome: 'error',
        error: 'CancellationError',
      },
    });
  });
});
