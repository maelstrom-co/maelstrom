import type {
  ChartRequestMessage,
  ChartResponseOutput,
  EngineMessage,
  EngineOutput,
  MessageId,
  Result,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';

import { assertNever } from './assert-never.js';
import { createChartRequestDedup } from './chart-request-dedup.js';
import type { EngineConfig, ExplicitPlannerConfig } from './config.js';
import { resolveConfig } from './config.js';
import type { EngineError } from './errors.js';
import { historyError, validationError } from './errors.js';
import type { HistoryManager } from './history/history-manager.js';
import { createHistoryManager } from './history/history-manager.js';
import type { HistoryEntry } from './history/history-store.js';
import { loadPlanningHistoryContext } from './history/load-history-context.js';
import { toSessionHistoryEntry } from './history/wire-projection.js';
import type { Logger } from './logger.js';
import { createLlmPlanner } from './planning/llm-planner.js';
import type { PlanningSnapshot } from './planning/operation.js';
import {
  createPlanningSnapshot,
  executePlanningOperation,
  withPlanningHistory,
} from './planning/operation.js';
import type {
  SkippedAction,
  SkippedActionIdentity,
} from './response/execution-plan/index.js';
import { skippedActionIdentity } from './response/execution-plan/index.js';
import type { EngineDiagnostics } from './response/response-processor.js';
import { logAtSeverity } from './severity-router.js';
import { validateEngineConfig } from './validation/engine-config.js';
import {
  logValidationFailure,
  validateEngineMessage,
} from './validation/engine-message.js';
import type { DroppedLayoutEntry } from './validation/llm-output/healed-layout.js';
import {
  formatDroppedEntry,
  formatLayoutWarnings,
  MAX_LOGGED_ENTRIES,
} from './validation/llm-output/healed-layout.js';

/** The engine's public request and history seam. */
export interface Engine {
  /** Handles one validated engine message and returns a typed output or error. */
  handle(
    message: EngineMessage,
    signal?: AbortSignal,
  ): Promise<Result<EngineOutput, EngineError>>;
  /** Returns wire-projected history for one session. */
  getHistory(
    sessionId: SessionId,
  ): Promise<Result<readonly SessionHistoryEntry[], EngineError>>;
}

/**
 * Constructs an engine. Invalid configuration throws synchronously because it
 * is a programmer error; runtime planning failures are returned through
 * {@link Engine.handle}.
 */
export function createEngine(config: EngineConfig): Engine {
  const validated = validateEngineConfig(config);
  const resolved = resolveConfig(validated);
  const logger = resolved.logger;
  const history: HistoryManager | undefined = resolved.history
    ? createHistoryManager(resolved.history)
    : undefined;
  let plannerConfig: ExplicitPlannerConfig;
  if ('planner' in resolved) {
    plannerConfig = resolved.planner;
  } else {
    try {
      plannerConfig = {
        primary: {
          implementation: createLlmPlanner({
            adapter: resolved.adapter,
            prompt: resolved.prompt,
            modelOptions: resolved.modelOptions,
            logger,
          }),
          finalization: 'heal-and-ship' as const,
          maxRepairAttempts: resolved.maxRetries,
        },
        operation: {
          timeoutMs: resolved.operationTimeoutMs,
          maxProviderCalls: resolved.maxProviderCalls,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid EngineConfig: prompt.system: ${message}`, {
        cause: error,
      });
    }
  }

  const runChartRequest = async (
    message: ChartRequestMessage,
    signal?: AbortSignal,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    logger.debug('Processing chart_request', {
      messageId: message.id,
      sessionId: message.sessionId,
      layoutMode: message.request.context.layoutMode,
    });
    let snapshot: PlanningSnapshot;
    try {
      snapshot = createPlanningSnapshot(message.request);
    } catch (cause) {
      const failure = validationError(
        cause instanceof Error ? cause.message : String(cause),
        'prompt',
        cause,
      );
      logger.error('Failed to build planning snapshot', cause, {
        messageId: message.id,
      });
      return err(failure);
    }
    const historyContext = await loadPlanningHistoryContext(
      history,
      message.sessionId,
      message.id,
      logger,
    );
    if (isErr(historyContext)) return historyContext;
    snapshot = withPlanningHistory(snapshot, historyContext.value);

    const planned = await executePlanningOperation({
      planner: plannerConfig,
      snapshot,
      messageId: message.id,
      logger,
      signal,
    });
    if (isErr(planned)) {
      logEngineError(logger, message.id, planned.error);
      return planned;
    }
    const { diagnostics, ...response } = planned.value;
    logHealing(logger, message.id, diagnostics);
    return ok({
      type: 'chart_response',
      sessionId: message.sessionId,
      id: message.id,
      response,
    });
  };

  const dedup = createChartRequestDedup({ runChartRequest, history, logger });
  return {
    async handle(rawMessage, signal) {
      const validatedMessage = validateEngineMessage(rawMessage);
      if (isErr(validatedMessage)) {
        logValidationFailure(logger, rawMessage, validatedMessage.error);
        return validatedMessage;
      }
      const message = validatedMessage.value;
      switch (message.type) {
        case 'chart_request':
          return dedup.handle(message, signal);
        case 'assistant_message': {
          if (history === undefined) {
            return err(validationError('history not configured', 'history'));
          }
          const maxChars = resolved.history?.maxChars;
          if (maxChars !== undefined && message.content.length > maxChars) {
            return err(
              validationError(
                `assistant_message content (${message.content.length} chars) exceeds maxChars (${maxChars})`,
                'content',
              ),
            );
          }
          try {
            const { inserted } = await history.addAssistantMessage(message);
            return ok({
              type: 'assistant_message_result',
              sessionId: message.sessionId,
              id: message.id,
              outcome: inserted ? 'inserted' : 'deduped',
            });
          } catch (cause) {
            logger.error('Failed to persist assistant_message', cause, {
              messageId: message.id,
              sessionId: message.sessionId,
            });
            return err(
              historyError.addAssistantMessage(
                'failed to persist assistant_message',
                cause,
              ),
            );
          }
        }
        default:
          return assertNever(message, 'engine.handle');
      }
    },

    async getHistory(sessionId) {
      if (history === undefined) {
        return err(validationError('history not configured', 'history'));
      }
      let entries: readonly HistoryEntry[];
      try {
        entries = await history.getHistory(sessionId);
      } catch (cause) {
        logger.error('Failed to load session history from store', cause, {
          op: 'get_history',
          sessionId,
        });
        return err(
          historyError.getHistory(
            'failed to load session history from store',
            cause,
          ),
        );
      }
      try {
        return ok(entries.map(toSessionHistoryEntry));
      } catch (cause) {
        logger.error(
          'Failed to project session history entry to wire DTO',
          cause,
          {
            op: 'get_history',
            sessionId,
          },
        );
        return err(
          historyError.getHistory(
            'failed to project session history entry',
            cause,
          ),
        );
      }
    },
  };
}

function logEngineError(
  logger: Logger,
  messageId: MessageId,
  error: EngineError,
): void {
  if (error._tag === 'CancellationError') {
    logger.info('Request cancelled', { messageId, reason: error.reason });
    return;
  }
  logger.error('LLM call failed', error, { messageId, errorTag: error._tag });
}

function logHealing(
  logger: Logger,
  messageId: MessageId,
  diagnostics: EngineDiagnostics,
): void {
  if (
    diagnostics.skippedActions.length === 0 &&
    diagnostics.droppedLayoutEntries.length === 0 &&
    diagnostics.warnings.length === 0
  )
    return;
  logAtSeverity(logger, diagnostics.retryHint.severity, 'Response healed', {
    messageId,
    skippedActions: diagnostics.skippedActions.length,
    droppedLayoutEntries: diagnostics.droppedLayoutEntries.length,
    warnings: diagnostics.warnings.length,
    retrySeverity: diagnostics.retryHint.severity,
    retryRecommend: diagnostics.retryHint.recommend,
    detail: {
      drops: formatDroppedEntries(diagnostics.droppedLayoutEntries),
      warnings: formatLayoutWarnings(diagnostics.warnings),
      skips: formatSkippedActions(diagnostics.skippedActions),
    },
  });
}

function formatDroppedEntries(
  entries: readonly DroppedLayoutEntry[],
): string[] {
  const visible = entries.slice(0, MAX_LOGGED_ENTRIES).map(formatDroppedEntry);
  const omitted = entries.length - visible.length;
  return omitted > 0
    ? [
        ...visible,
        `${omitted} additional drop${omitted === 1 ? '' : 's'} omitted`,
      ]
    : visible;
}

function formatSkippedActions(
  entries: readonly SkippedAction[],
): SkippedActionIdentity[] {
  return entries.slice(0, MAX_LOGGED_ENTRIES).map(skippedActionIdentity);
}
