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
  // Tiling allows the LLM to declare new instances in `layout.instances`
  // alongside an action that configures them (per the system prompt:
  // "To CREATE a new instance, add it to the instances array... add an
  // action in executionPlan to configure it"). Without merging those
  // healed declarations into the action resolver's instance map, every
  // new-instance + configure-action pair gets skipped as unknown_instance
  // and the retry loop wastes attempts on output the LLM has no reason
  // to change. Existing instances keep their pre-request variant —
  // mid-plan transitions are still simulated by `parseExecutionPlan`.
  // Grid mode has no separate instance-declaration channel (positions
  // reference existing instanceIds), so it stays as-is.
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
    ),
  };
}

// Existing instances win on conflict — the LLM declaring a different
// variant for an already-extant instance shouldn't silently overwrite
// the simulator's starting state. Variant transitions go through the
// executionPlan path so the simulator can validate them.
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
