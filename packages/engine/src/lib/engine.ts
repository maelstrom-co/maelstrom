import type {
  ChartRequestMessage,
  ChartResponseOutput,
  EngineMessage,
  EngineOutput,
  LayoutMode,
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
import { callWithRetry } from './pipeline/retry.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt/prompt-builder.js';
import { processResponse } from './response/response-processor.js';
import { logAtSeverity } from './severity-router.js';
import { validateEngineConfig } from './validation/engine-config.js';

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

/**
 * The engine's public surface. Construct via {@link createEngine}.
 *
 * Stateful at the session level (per-session async mutex serializes
 * `chart_request` processing; in-process only — multi-instance deployments
 * must close that gap externally, see the README's Concurrency section).
 * Stateless at the request level: a `chart_request` flows prompt → LLM →
 * response-processor → optional retry → history record without retained
 * inter-call state beyond what the configured `HistoryStore` persists.
 */
export interface Engine {
  /**
   * Routes on `message.type`:
   *
   * - `chart_request` → builds a prompt from request + prior history,
   *   invokes the LLM, heals the response (drops broken pieces, returns a
   *   renderable layout), optionally retries when heal recommends, and
   *   records the turn. Returns `Ok(chart_response)` for any renderable
   *   outcome (including healed-with-drops).
   * - `assistant_message` → persists developer-supplied content into
   *   session history. Does NOT invoke the LLM. Returns
   *   `Ok(assistant_message_result)` with `outcome: 'inserted' | 'deduped'`.
   *
   * `Err` is reserved for genuinely unrecoverable conditions (provider
   * fault, cancellation, prompt-build failure, history error, missing
   * `userMessage`). Layout problems heal into diagnostics rather than
   * surfacing here — see {@link EngineDiagnostics} (engine-internal,
   * stripped before crossing the boundary).
   *
   * `signal` cancels mid-flight: a pre-aborted signal short-circuits to
   * `CancellationError` without invoking the LLM; an abort during the LLM
   * call is mapped to `CancellationError` via the adapter.
   */
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
 * Unlike `Engine.handle`, which surfaces runtime failures through
 * `Result<…, EngineError>`, this factory validates `config` synchronously
 * and **throws** on invalid input. Invalid config is a programmer error,
 * not a runtime condition — consumers outside TypeScript (or calling with
 * unknown input) should wrap in `try`/`catch`.
 *
 * @throws {Error} If `config` fails Zod validation, or if a system-prompt
 *   customizer (`config.prompt.system`) is misconfigured (function on an
 *   unknown key, or a customizer that itself throws). System prompts are
 *   derived once at factory time, so misconfiguration surfaces here rather
 *   than degrading every `chart_request` into a `Result` err. The message
 *   is prefixed with `Invalid EngineConfig:` and the original error is
 *   attached as `cause`.
 */
export function createEngine(config: EngineConfig): Engine {
  const validated = validateEngineConfig(config);
  const {
    adapter,
    logger,
    prompt: promptOptions,
    history: historyConfig,
    maxRetries,
  } = resolveConfig(validated);
  const history: HistoryManager | undefined = historyConfig
    ? createHistoryManager(historyConfig)
    : undefined;

  // System prompts depend only on engine config, so derive them once at
  // factory time and look them up by layoutMode per request. Customizer
  // errors are wrapped in the same `Invalid EngineConfig:` shape the Zod
  // path uses so a single try/catch around `createEngine` catches both.
  let systemPrompts: Record<LayoutMode, string>;
  try {
    systemPrompts = {
      grid: buildSystemPrompt('grid', promptOptions),
      tiling: buildSystemPrompt('tiling', promptOptions),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid EngineConfig: prompt.system: ${message}`, {
      cause: error,
    });
  }

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

    const systemPrompt = systemPrompts[mode];

    // buildUserPrompt can throw when a consumer-supplied user-section
    // customizer is misconfigured (function on unknown key) or itself
    // throws. Surface that as an Err instead of breaking the
    // Promise<Result> contract.
    let userPrompt: string;
    try {
      userPrompt = buildUserPrompt(request, promptOptions, logger);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to build user prompt', error, {
        messageId: message.id,
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

    const runOnce = async (
      attemptUserPrompt: string,
      attemptSignal?: AbortSignal,
    ) => {
      const llmResult = await callLLM(
        adapter,
        systemPrompt,
        attemptUserPrompt,
        outputSchema,
        historyContext,
        attemptSignal,
      );
      if (isErr(llmResult)) {
        logEngineError(logger, message.id, llmResult.error);
        return llmResult;
      }
      logger.debug('LLM response received', { messageId: message.id });
      // `processResponse` calls heal helpers and `assertNever` defaults that
      // throw on engine-internal contract violations (broken pruner invariant,
      // unknown discriminator arm). Without this catch those throws become
      // unhandled rejections at the engine boundary, breaking the documented
      // `Promise<Result<...>>` contract. Catch synchronously, log with the
      // structured-error slot, and return an Err so callWithRetry can surface
      // it through the same path as any other fatal `EngineError`.
      try {
        const processed = processResponse({
          llmOutput: llmResult.value,
          request,
          messageId: message.id,
          logger,
        });
        if (isErr(processed)) {
          logger.error('Failed to process LLM response', processed.error, {
            messageId: message.id,
          });
        }
        return processed;
      } catch (error) {
        logger.error(
          'Engine invariant violation while processing LLM response',
          error,
          { messageId: message.id },
        );
        return err(
          validationError(
            error instanceof Error ? error.message : String(error),
            'response',
          ),
        );
      }
    };

    const retried = await callWithRetry({
      runOnce,
      originalUserPrompt: userPrompt,
      maxRetries,
      logger,
      signal,
    });
    if (isErr(retried)) {
      return retried;
    }

    // Strip engine-internal diagnostics before crossing the engine boundary.
    // Anything healed silently here is the only operator-visible signal that
    // the LLM produced bad output, so emit a single summary log line — drops
    // and warnings would otherwise be invisible to observability. Severity
    // drives the level so blank-UI responses (`unrecoverable`) cross default
    // `warn`-threshold paging filters.
    const { diagnostics, ...response } = retried.value;
    if (
      diagnostics.skippedActions.length > 0 ||
      diagnostics.droppedLayoutEntries.length > 0 ||
      diagnostics.warnings.length > 0
    ) {
      logAtSeverity(
        logger,
        diagnostics.retryHint.severity,
        'Response healed',
        {
          messageId: message.id,
          skippedActions: diagnostics.skippedActions.length,
          droppedLayoutEntries: diagnostics.droppedLayoutEntries.length,
          warnings: diagnostics.warnings.length,
          retrySeverity: diagnostics.retryHint.severity,
          retryRecommend: diagnostics.retryHint.recommend,
        },
      );
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
              logger.error('Failed to record turn', error, {
                messageId: message.id,
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
            logger.error('Failed to persist assistant_message', error, {
              messageId: message.id,
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
    return;
  }
  // 3-arg form: structured EngineError into the dedicated error slot so
  // _tag, stack, and per-variant context (cause / raw / timeoutMs) reach
  // structured loggers; correlation fields stay in the data slot.
  logger.error('LLM call failed', error, { messageId, errorTag: error._tag });
}
