import type { ReplylessCandidate } from '@maelstrom-co/engine';
import type { ChartRequest, NeedsClarification } from '@maelstrom-co/protocol';

import type { ParameterAsk } from './types.js';

/**
 * Turns the parameters Jev must ask for into a needs-clarification result
 * that carries the partial plan alongside one question covering every ask.
 */
export function parameterClarification(
  _asks: readonly ParameterAsk[],
  _partial: ReplylessCandidate,
  _request: ChartRequest,
): NeedsClarification {
  throw new Error('not implemented');
}
