import type {
  ChartRequest,
  GridResponse,
  MaelstromResponse,
  Result,
  TilingResponse,
} from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';

import type { EngineError, LayoutValidationError } from '../errors.js';
import { parseError, validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LLMOutput } from '../pipeline/call-llm.js';
import {
  validateGridLayout,
  validateTilingLayout,
} from '../validation/llm-output/index.js';
import type { SkippedAction } from './execution-plan/index.js';
import { parseExecutionPlan } from './execution-plan/index.js';
import { buildLayout } from './layout/index.js';

export interface EngineDiagnostics {
  readonly skippedActions: readonly SkippedAction[];
}

/**
 * Engine-internal response shape. `diagnostics` never crosses the engine
 * boundary — it is stripped in `engine.process()` before the response is
 * returned to callers.
 */
export type InternalResponse = MaelstromResponse & {
  readonly diagnostics: EngineDiagnostics;
};

export function processResponse(
  llmOutput: LLMOutput,
  request: ChartRequest,
  logger: Logger,
): Result<InternalResponse, EngineError> {
  if (!llmOutput.userMessage?.trim()) {
    return err(
      parseError('LLM response missing userMessage', JSON.stringify(llmOutput)),
    );
  }

  // `layoutMode` is the upstream discriminator: the schema that produced
  // `llmOutput` matches `request.context.layoutMode`, so these casts are
  // type-safe narrowings.
  const mode = request.context.layoutMode;
  let layoutValidation: Result<void, LayoutValidationError>;
  switch (mode) {
    case 'grid':
      layoutValidation = validateGridLayout(llmOutput as GridResponse, request);
      break;
    case 'tiling':
      layoutValidation = validateTilingLayout(
        llmOutput as TilingResponse,
        request,
      );
      break;
    default: {
      const _exhaustive: never = mode;
      return err(
        validationError(
          `Unsupported layoutMode: ${String(_exhaustive)}`,
          'context.layoutMode',
        ),
      );
    }
  }
  if (isErr(layoutValidation)) {
    return err(layoutValidation.error);
  }

  const layout = buildLayout(llmOutput.layout, request.context.layoutMode);
  const { plan: executionPlan, skippedActions } = parseExecutionPlan(
    llmOutput.executionPlan,
    request.instances,
    request.vessels,
    logger,
  );

  return ok({
    type: 'maelstrom_response',
    requestId: request.id,
    userMessage: llmOutput.userMessage,
    rationale: llmOutput.rationale,
    executionPlan,
    layout,
    diagnostics: { skippedActions },
  });
}

