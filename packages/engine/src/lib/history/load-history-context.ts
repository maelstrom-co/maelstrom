import type { MessageId, Result, SessionId } from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';

import type { EngineError } from '../errors.js';
import { historyError } from '../errors.js';
import type { Logger } from '../logger.js';
import type {
  HistoryManager,
  LLMContextMessage,
  PlanningHistoryContext,
} from './history-manager.js';

/**
 * Minimal-surface DI typing — this helper only calls `getLLMContext`. Typing
 * the parameter as `Pick<HistoryManager, 'getLLMContext'>` (instead of the
 * full interface) lets tests pass a lightweight stub without `as unknown as`
 * casts and pins the production contract that this module never reaches
 * for `recordTurn`/`addAssistantMessage`/`clear`.
 */
type HistoryContextSource = Pick<HistoryManager, 'getLLMContext'>;
type PlanningHistoryContextSource = Pick<HistoryManager, 'getPlanningContext'>;

/**
 * Translates throws from {@link HistoryManager.getLLMContext} into the
 * engine's `Promise<Result<…>>` contract — so a remote-store blip surfaces
 * the same `Err(HistoryError)` shape as `assistant_message` persistence
 * failures, instead of an unhandled rejection at the engine boundary.
 */
/**
 * Loads both planner projections from one retained-history read. The engine
 * uses this path so a planner cannot see conversation and structure from
 * different retention snapshots.
 */
export async function loadPlanningHistoryContext(
  history: PlanningHistoryContextSource | undefined,
  sessionId: SessionId,
  messageId: MessageId,
  logger: Logger,
): Promise<Result<PlanningHistoryContext, EngineError>> {
  if (history === undefined) {
    return ok({
      structured: Object.freeze([]),
      conversation: Object.freeze([]),
    });
  }
  try {
    return ok(await history.getPlanningContext(sessionId));
  } catch (error) {
    logger.error('Failed to load planning history context', error, {
      op: 'get_planning_context',
      messageId,
      sessionId,
    });
    return err(
      historyError.getLLMContext(
        'failed to load planning history context',
        error,
      ),
    );
  }
}

export async function loadHistoryContext(
  history: HistoryContextSource | undefined,
  sessionId: SessionId,
  messageId: MessageId,
  logger: Logger,
): Promise<Result<readonly LLMContextMessage[], EngineError>> {
  if (history === undefined) {
    return ok([]);
  }
  try {
    return ok(await history.getLLMContext(sessionId));
  } catch (error) {
    logger.error('Failed to load history context', error, {
      op: 'get_llm_context',
      messageId,
      sessionId,
    });
    return err(
      historyError.getLLMContext('failed to load history context', error),
    );
  }
}
