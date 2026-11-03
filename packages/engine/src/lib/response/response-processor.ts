import type {
  ChartRequest,
  GridLayout,
  GridPosition,
  GridResponse,
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
import type {
  DiagnosticRecords,
  FullDiagnostics,
  FullValidatedReplylessCandidate,
  ReplylessCandidate,
} from '../planner/candidate.js';
import { renderRetryDiagnostics } from '../planner/retry-diagnostics.js';
import type {
  HealedLayout,
  HealedTilingInstance,
} from '../validation/llm-output/healed-layout.js';
import {
  healGridLayout,
  healTilingLayout,
} from '../validation/llm-output/index.js';
import {
  deriveRetryHint,
  layoutEntryCount,
} from '../validation/llm-output/retry-hint.js';
import {
  classifyExecutionTurn,
  parseExecutionPlan,
} from './execution-plan/index.js';
import { buildGridLayout, buildTilingLayout } from './layout/index.js';

export interface ProcessResponseInput {
  readonly llmOutput: ReplylessCandidate;
  readonly request: ChartRequest;
  /** Exact normalized enum values displayed for this Engine request. */
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
}

/** Processes one LLM attempt against its Engine request's fixed enum snapshot. */
export function processResponse({
  llmOutput,
  request,
  enumSnapshot,
  messageId,
  logger,
}: ProcessResponseInput): Result<FullValidatedReplylessCandidate, EngineError> {
  const { userMessage } = llmOutput;
  if (request.skipReply !== true && !userMessage?.trim()) {
    return err(parseError('LLM response missing userMessage', 'userMessage'));
  }

  // `layoutMode` is the upstream discriminator: the candidate validator
  // checks `llmOutput` against the response schema for
  // `request.context.layoutMode` before calling this, so these casts are
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
  // The client applies the Layout before it runs the Execution Plan, so in
  // tiling mode every Instance the Layout keeps is simulated from its healed
  // Layout Variant, new and existing alike. Grid positions carry no Variant,
  // so grid mode simulates from the request.
  const planInstances: readonly VesselInstanceSnapshot[] =
    healed.mode === 'tiling'
      ? mergeTilingInstances(request.instances, healed.layout.instances)
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
    ...(userMessage === undefined ? {} : { userMessage }),
    rationale: llmOutput.rationale,
    executionPlan,
    layout,
    diagnostics: buildDiagnostics({
      skippedActions,
      droppedLayoutEntries: healed.droppedEntries,
      warnings: healed.warnings,
      retryHint,
    }),
  });
}

/** Derives the stage-facing summary (counts and rendered feedback) once. */
export function buildDiagnostics(records: DiagnosticRecords): FullDiagnostics {
  const { skippedActions, droppedLayoutEntries, warnings } = records;
  return {
    ...records,
    counts: {
      skippedActions: skippedActions.length,
      droppedLayoutEntries: droppedLayoutEntries.length,
      warnings: warnings.length,
    },
    feedback: renderRetryDiagnostics(
      droppedLayoutEntries,
      skippedActions,
      warnings,
      records.planIssues,
    ),
  };
}

// Request-only Instances stay in the simulation unchanged, so an Action on an
// Instance the Layout deletes resolves exactly as it would without the Layout.
function mergeTilingInstances(
  requestInstances: readonly VesselInstanceSnapshot[],
  healedInstances: readonly HealedTilingInstance[],
): readonly VesselInstanceSnapshot[] {
  const declaredById = new Map(
    healedInstances.map((instance) => [instance.instanceId, instance]),
  );
  const merged: VesselInstanceSnapshot[] = requestInstances.map(
    (instance) => declaredById.get(instance.instanceId) ?? instance,
  );
  const seen = new Set(requestInstances.map((i) => i.instanceId));
  for (const instance of healedInstances) {
    if (seen.has(instance.instanceId)) continue;
    merged.push(instance);
    seen.add(instance.instanceId);
  }
  return merged;
}
