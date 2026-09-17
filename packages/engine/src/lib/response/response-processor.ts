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
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { parseError, validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LLMOutput } from '../pipeline/call-llm.js';
import type {
  DroppedLayoutEntry,
  HealedLayout,
  HealedTilingInstance,
  LayoutWarning,
  RetryHint,
} from '../validation/llm-output/healed-layout.js';
import {
  healGridLayout,
  healTilingLayout,
} from '../validation/llm-output/index.js';
import {
  deriveRetryHint,
  layoutEntryCount,
} from '../validation/llm-output/retry-hint.js';
import type { SkippedAction } from './execution-plan/index.js';
import {
  classifyExecutionTurn,
  parseExecutionPlan,
} from './execution-plan/index.js';
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

export type ProcessResponseOutput = Omit<
  LLMOutput,
  'userMessage' | 'rationale'
> & {
  /** Optional presentation text from any planner. */
  readonly userMessage?: string;
  /** Optional diagnostics from any planner. */
  readonly rationale?: string;
};

export interface ProcessResponseInput {
  readonly llmOutput: ProcessResponseOutput;
  /** Keeps legacy LLM prose validation unless a structured planner opts out. */
  readonly allowMissingPresentation?: boolean;
  /** Strict routes validate actions against the layout state applied before execution. */
  readonly usePostLayoutInstances?: boolean;
  readonly request: ChartRequest;
  /** Exact normalized enum values displayed for this Engine request. */
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
}

/** Processes one LLM attempt against its Engine request's fixed enum snapshot. */
export function processResponse({
  llmOutput,
  allowMissingPresentation = false,
  usePostLayoutInstances = false,
  request,
  enumSnapshot,
  messageId,
  logger,
}: ProcessResponseInput): Result<InternalResponse, EngineError> {
  if (!allowMissingPresentation && !llmOutput.userMessage?.trim()) {
    return err(parseError('LLM response missing userMessage', 'userMessage'));
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
  // Strict action validation follows the client's layout-first replacement.
  // Tiling retains declared hidden instances; grid retains positioned instances.
  // Heal-and-ship preserves the legacy request-first resolver.
  const positionedIds =
    healed.mode === 'grid'
      ? new Set(healed.layout.positions.map((position) => position.instanceId))
      : undefined;
  const planInstances: readonly VesselInstanceSnapshot[] =
    healed.mode === 'tiling'
      ? usePostLayoutInstances
        ? healed.layout.instances
        : mergeTilingInstances(request.instances, healed.layout.instances)
      : usePostLayoutInstances
        ? request.instances.filter((instance) =>
            positionedIds?.has(instance.instanceId),
          )
        : request.instances;
  const { plan: executionPlan, skippedActions } = parseExecutionPlan(
    llmOutput.executionPlan,
    {
      instances: planInstances,
      vessels: request.vessels,
      enumSnapshot,
      turn: classifyExecutionTurn(request),
      logger,
    },
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
    ...nonBlankPresentation(llmOutput.userMessage, 'userMessage'),
    ...nonBlankPresentation(llmOutput.rationale, 'rationale'),
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

function nonBlankPresentation(
  value: string | undefined,
  key: 'userMessage' | 'rationale',
): Partial<Pick<MaelstromResponse, typeof key>> {
  return value?.trim().length ? { [key]: value } : {};
}

// Legacy healing resolves existing identities from the request, even when the
// layout removes them or declares another variant. Strict routes bypass this.
function mergeTilingInstances(
  requestInstances: readonly VesselInstanceSnapshot[],
  healedInstances: readonly HealedTilingInstance[],
): readonly VesselInstanceSnapshot[] {
  const seen = new Set(requestInstances.map((i) => i.instanceId));
  const merged: VesselInstanceSnapshot[] = [...requestInstances];
  for (const instance of healedInstances) {
    if (seen.has(instance.instanceId)) continue;
    merged.push(instance);
    seen.add(instance.instanceId);
  }
  return merged;
}
