import type {
  ChartRequest,
  GridLayout,
  GridPosition,
  GridResponse,
  MaelstromResponse,
  MessageId,
  Result,
  TilingInstance,
  TilingLayout,
  TilingNode,
  TilingResponse,
} from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';

import type { EngineError } from '../errors.js';
import { parseError, validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LLMOutput } from '../pipeline/call-llm.js';
import {
  healGridLayout,
  healTilingLayout,
} from '../validation/llm-output/index.js';
import type {
  DroppedLayoutEntry,
  HealedLayout,
  LayoutWarning,
  RetryHint,
} from '../validation/llm-output/healed-layout.js';
import {
  deriveRetryHint,
  layoutEntryCount,
} from '../validation/llm-output/retry-hint.js';
import type { SkippedAction } from './execution-plan/index.js';
import { parseExecutionPlan } from './execution-plan/index.js';
import { buildGridLayout, buildTilingLayout } from './layout/index.js';

/**
 * Stripped from the response before it crosses the engine boundary.
 */
export interface EngineDiagnostics {
  readonly skippedActions: readonly SkippedAction[];
  readonly droppedLayoutEntries: readonly DroppedLayoutEntry[];
  readonly warnings: readonly LayoutWarning[];
  readonly retryHint: RetryHint;
}

/**
 * `diagnostics` is stripped at the engine boundary; the public response is
 * just `MaelstromResponse`.
 */
export type InternalResponse = MaelstromResponse & {
  readonly diagnostics: EngineDiagnostics;
};

export interface ProcessResponseInput {
  readonly llmOutput: LLMOutput;
  readonly request: ChartRequest;
  readonly messageId: MessageId;
  readonly logger: Logger;
}

export function processResponse({
  llmOutput,
  request,
  messageId,
  logger,
}: ProcessResponseInput): Result<InternalResponse, EngineError> {
  if (!llmOutput.userMessage?.trim()) {
    return err(
      parseError('LLM response missing userMessage', JSON.stringify(llmOutput)),
    );
  }

  // `layoutMode` is the upstream discriminator: the schema that produced
  // `llmOutput` matches `request.context.layoutMode`, so these casts are
  // type-safe narrowings. The narrowing lives here at the dispatch site
  // (rather than in a helper) so the discriminator → branch correspondence
  // is locally legible; each cast is paired with the case that justifies it.
  const mode = request.context.layoutMode;
  let healed: HealedLayout;
  let layout: GridLayout | TilingLayout;
  switch (mode) {
    case 'grid': {
      healed = healGridLayout(llmOutput as GridResponse, request);
      // Union-narrowing on `healed.layout`: `mode === 'grid'` selected the
      // grid-shaped heal function above, so the layout payload matches
      // `buildGridLayout`'s expected shape.
      layout = buildGridLayout(
        healed.layout as { positions: readonly GridPosition[] },
      );
      break;
    }
    case 'tiling': {
      healed = healTilingLayout(llmOutput as TilingResponse, request);
      // Same union-narrowing rationale as the `grid` arm.
      layout = buildTilingLayout(
        healed.layout as {
          tree: readonly TilingNode[];
          instances: readonly TilingInstance[];
        },
      );
      break;
    }
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
  const { plan: executionPlan, skippedActions } = parseExecutionPlan(
    llmOutput.executionPlan,
    request.instances,
    request.vessels,
    logger,
  );

  const retryHint = deriveRetryHint({
    healedLayoutSize: layoutEntryCount(healed),
    requestInstanceCount: request.instances.length,
    proposedActionCount: llmOutput.executionPlan.length,
    acceptedActionCount: executionPlan.length,
    skippedActions,
    droppedLayoutCount: healed.droppedEntries.length,
    warningCount: healed.warnings.length,
  });

  return ok({
    type: 'maelstrom_response',
    requestId: messageId,
    userMessage: llmOutput.userMessage,
    rationale: llmOutput.rationale,
    executionPlan,
    layout,
    diagnostics: {
      skippedActions,
      droppedLayoutEntries: healed.droppedEntries,
      warnings: healed.warnings,
      retryHint,
    },
  });
}
