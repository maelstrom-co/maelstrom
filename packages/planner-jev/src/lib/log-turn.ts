import type { Planner } from '@maelstrom-co/engine';
import { isErr } from '@maelstrom-co/protocol';

import { intentText } from './questions.js';

/**
 * Wraps `planner` to log each turn at debug: the user's request as
 * `jev.request` before planning, and the shipped candidate or the error tag
 * as `jev.result` after. The candidate is logged as JSON because console
 * loggers cut nested objects short.
 */
export function logTurns(planner: Planner): Planner {
  return async (input, ctx) => {
    const { messageId } = input;
    ctx.logger.debug('jev.request', {
      messageId,
      request: intentText(input.request),
    });
    const result = await planner(input, ctx);
    ctx.logger.debug(
      'jev.result',
      isErr(result)
        ? { messageId, outcome: 'error', error: result.error._tag }
        : {
            messageId,
            outcome: 'ok',
            candidate: JSON.stringify(result.value),
          },
    );
    return result;
  };
}
