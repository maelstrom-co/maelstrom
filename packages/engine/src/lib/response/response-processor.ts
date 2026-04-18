import type { MaelstromResponse, Result } from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';
import type { ChartRequest } from '@maelstrom-co/protocol-old';

import type { EngineError } from '../errors.js';
import { parseError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LLMOutput } from '../pipeline/call-llm.js';
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

