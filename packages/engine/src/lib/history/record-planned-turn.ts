import type {
  ChartRequestMessage,
  ChartResponseOutput,
} from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import type { HistoryManager } from './history-manager.js';

/** Records planning evidence; storage failure does not invalidate a usable plan. */
export async function recordPlannedTurn(
  history: Pick<HistoryManager, 'recordTurn'> | undefined,
  message: ChartRequestMessage,
  output: ChartResponseOutput,
  logger: Logger,
): Promise<void> {
  try {
    await history?.recordTurn(message, output);
  } catch (error) {
    logger.error('Failed to record turn', error, {
      op: 'record_turn',
      messageId: message.id,
      sessionId: message.sessionId,
    });
  }
}
