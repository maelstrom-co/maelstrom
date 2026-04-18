import type { MaelstromResponse, MessageId, Result } from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';
import type { ChartRequest } from '@maelstrom-co/protocol-old';
import {
  GridResponseSchema,
  TilingResponseSchema,
} from '@maelstrom-co/protocol-old';

import type { EngineConfig } from './config.js';
import { resolveConfig } from './config.js';
import type { EngineError } from './errors.js';
import { validationError } from './errors.js';
import type { Logger } from './logger.js';
import { callLLM } from './pipeline/call-llm.js';
import { buildPrompt } from './prompt/prompt-builder.js';
import { processResponse } from './response/response-processor.js';

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

export interface Engine {
  process(
    request: ChartRequest,
    signal?: AbortSignal,
  ): Promise<Result<MaelstromResponse, EngineError>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEngine(config: EngineConfig): Engine {
  const { adapter, logger, prompt: promptOptions } = resolveConfig(config);

  return {
    async process(
      request: ChartRequest,
      signal?: AbortSignal,
    ): Promise<Result<MaelstromResponse, EngineError>> {
      const mode = request.context.layoutMode;
      logger.debug('Processing request', {
        requestId: request.id,
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
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error('Failed to build prompt', {
          requestId: request.id,
          error: message,
        });
        return err(validationError(message, 'prompt'));
      }

      const outputSchema =
        mode === 'grid' ? GridResponseSchema : TilingResponseSchema;

      const llmResult = await callLLM(
        adapter,
        systemPrompt,
        userPrompt,
        outputSchema,
        signal,
      );

      if (isErr(llmResult)) {
        logEngineError(logger, request.id, llmResult.error);
        return llmResult;
      }

      logger.debug('LLM response received', { requestId: request.id });
      const processed = processResponse(llmResult.value, request, logger);
      if (isErr(processed)) {
        logger.error('Failed to process LLM response', {
          requestId: request.id,
          error: processed.error.message,
        });
        return processed;
      }

      // Strip engine-internal diagnostics before crossing the engine boundary.
      const { diagnostics, ...response } = processed.value;
      if (diagnostics.skippedActions.length > 0) {
        logger.info('Response processed with skipped actions', {
          requestId: request.id,
          skipped: diagnostics.skippedActions.length,
          total: llmResult.value.executionPlan.length,
        });
      }
      return ok(response);
    },
  };
}

function logEngineError(
  logger: Logger,
  requestId: MessageId,
  error: EngineError,
): void {
  if (error._tag === 'CancellationError') {
    logger.info('Request cancelled', { requestId, reason: error.reason });
  } else {
    logger.error('LLM call failed', { requestId, error: error.message });
  }
}
