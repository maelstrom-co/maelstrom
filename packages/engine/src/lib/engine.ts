import type {
  ChartRequestMessage,
  ChartResponseOutput,
  EngineMessage,
  EngineOutput,
  MessageId,
  Result,
} from '@maelstrom-co/protocol';
import {
  err,
  GridResponseSchema,
  isErr,
  isOk,
  ok,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import { assertNever } from './assert-never.js';
import type { EngineConfig } from './config.js';
import { resolveConfig } from './config.js';
import type { EngineError } from './errors.js';
import { historyError, validationError } from './errors.js';
import type { HistoryManager } from './history/history-manager.js';
import { createHistoryManager } from './history/history-manager.js';
import type { Logger } from './logger.js';
import { callLLM } from './pipeline/call-llm.js';
import { buildPrompt } from './prompt/prompt-builder.js';
import { processResponse } from './response/response-processor.js';
import { validateEngineConfig } from './validation/engine-config.js';

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

export interface Engine {
  handle(
    message: EngineMessage,
    signal?: AbortSignal,
  ): Promise<Result<EngineOutput, EngineError>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct an Engine from the given config.
 *
 * Unlike `Engine.process`, which surfaces runtime failures through
 * `Result<…, EngineError>`, this factory validates `config` synchronously
 * with Zod and **throws** on invalid input. Invalid config is a programmer
 * error, not a runtime condition — consumers outside TypeScript (or calling
 * with unknown input) should wrap in `try`/`catch`.
 *
 * @throws {Error} If `config` fails Zod validation. The message is prefixed
 *   with `Invalid EngineConfig:` followed by the list of offending paths.
 *   The original `z.ZodError` is attached as `cause` for programmatic
 *   inspection of structured issues.
 */
export function createEngine(config: EngineConfig): Engine {
  const validated = validateEngineConfig(config);
  const {
    adapter,
    logger,
    prompt: promptOptions,
    history: historyConfig,
  } = resolveConfig(validated);
  const history: HistoryManager | undefined = historyConfig
    ? createHistoryManager(historyConfig)
    : undefined;

  const runChartRequest = async (
    message: ChartRequestMessage,
    signal?: AbortSignal,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    const { request } = message;
    const mode = request.context.layoutMode;
    logger.debug('Processing chart_request', {
      messageId: message.id,
      sessionId: message.sessionId,
      layoutMode: mode,
    });

    // buildPrompt can throw when a consumer-supplied section customizer is
    // misconfigured (function on unknown key) or itself throws. Surface that
    // as an Err instead of breaking the Promise<Result> contract.
    let systemPrompt: string;
    let userPrompt: string;
    try {
      ({ systemPrompt, userPrompt } = buildPrompt(
        request,
        promptOptions,
        logger,
      ));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to build prompt', {
        messageId: message.id,
        error: errorMessage,
      });
      return err(validationError(errorMessage, 'prompt'));
    }

    const outputSchema =
      mode === 'grid' ? GridResponseSchema : TilingResponseSchema;

    // Prior conversation is what lets the LLM reason across turns.
    // Empty when history isn't configured — callLLM treats that case the
    // same as a fresh first turn.
    const historyContext = history
      ? await history.getLLMContext(message.sessionId)
      : [];

    const llmResult = await callLLM(
      adapter,
      systemPrompt,
      userPrompt,
      outputSchema,
      historyContext,
      signal,
    );

    if (isErr(llmResult)) {
      logEngineError(logger, message.id, llmResult.error);
      return llmResult;
    }

    logger.debug('LLM response received', { messageId: message.id });
    const processed = processResponse({
      llmOutput: llmResult.value,
      request,
      messageId: message.id,
      logger,
    });
    if (isErr(processed)) {
      logger.error('Failed to process LLM response', {
        messageId: message.id,
        error: processed.error.message,
      });
      return processed;
    }

    // Strip engine-internal diagnostics before crossing the engine boundary.
    const { diagnostics, ...response } = processed.value;
    if (diagnostics.skippedActions.length > 0) {
      logger.info('Response processed with skipped actions', {
        messageId: message.id,
        skipped: diagnostics.skippedActions.length,
        total: llmResult.value.executionPlan.length,
      });
    }

    return ok({
      type: 'chart_response',
      sessionId: message.sessionId,
      id: message.id,
      response,
    });
  };

  return {
    async handle(message, signal) {
      switch (message.type) {
        case 'chart_request': {
          const result = await runChartRequest(message, signal);
          if (isOk(result) && history !== undefined) {
            // Advisory write: the user already has their response, so a
            // history failure must not retroactively fail the turn.
            try {
              await history.recordTurn(message, result.value);
            } catch (error) {
              logger.error('Failed to record turn', {
                messageId: message.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return result;
        }
        case 'assistant_message': {
          if (history === undefined) {
            return err(validationError('history not configured', 'history'));
          }
          // Reject injections that alone would exceed the session's char
          // budget. Without this, a single oversized injection would always
          // win the "newest entry retained" rule in truncation and dwarf
          // every subsequent LLM call until something newer pushed it out.
          const maxChars = historyConfig?.maxChars;
          if (maxChars !== undefined && message.content.length > maxChars) {
            return err(
              validationError(
                `assistant_message content (${message.content.length} chars) exceeds maxChars (${maxChars})`,
                'content',
              ),
            );
          }
          // For injections, the history write IS the operation — a failed
          // write means the caller's side effect did not happen, so surface
          // it through the Result channel.
          let inserted: boolean;
          try {
            ({ inserted } = await history.addAssistantMessage(message));
          } catch (error) {
            logger.error('Failed to persist assistant_message', {
              messageId: message.id,
              error: error instanceof Error ? error.message : String(error),
            });
            return err(
              historyError(
                'failed to persist assistant_message',
                'add_assistant_message',
                error,
              ),
            );
          }
          return ok({
            type: 'assistant_message_result',
            sessionId: message.sessionId,
            id: message.id,
            outcome: inserted ? 'inserted' : 'deduped',
          });
        }
        default:
          return assertNever(message, 'engine.handle');
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
  } else {
    logger.error('LLM call failed', { messageId, error: error.message });
  }
}
