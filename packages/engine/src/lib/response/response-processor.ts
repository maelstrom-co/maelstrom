import type {
  ActionExecution,
  ChartRequest,
  GridLayout,
  GridPosition,
  GridResponse,
  MessageId,
  NeedsClarification,
  Result,
  TilingInstance,
  TilingLayout,
  TilingNode,
  TilingResponse,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';

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
import type { RawActionExecution } from './execution-plan/types.js';
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
export function processResponse(
  input: ProcessResponseInput,
): Result<FullValidatedReplylessCandidate, EngineError> {
  const { llmOutput, request, messageId } = input;
  const { userMessage } = llmOutput;
  if (request.skipReply !== true && !userMessage?.trim()) {
    return err(parseError('LLM response missing userMessage', 'userMessage'));
  }
  const healed = healCandidate(input);
  if (isErr(healed)) return healed;
  const { layout, executionPlan, diagnostics } = healed.value;
  return ok({
    type: 'maelstrom_response',
    requestId: messageId,
    ...(userMessage === undefined ? {} : { userMessage }),
    rationale: llmOutput.rationale,
    executionPlan,
    layout,
    diagnostics,
  });
}

/** Input for {@link processPartialChanges}. */
export interface ProcessPartialChangesInput extends Omit<
  ProcessResponseInput,
  'llmOutput'
> {
  /**
   * The changes a needs-clarification result carries, already checked
   * against the clarification schema for the request's layout mode.
   */
  readonly changes: Pick<NeedsClarification, 'layout' | 'executionPlan'>;
}

/**
 * The partial changes of a needs-clarification result after healing. Each
 * field is present exactly when the clarification carried it, in the same
 * shape a healed plan ships.
 */
export interface HealedPartialChanges {
  readonly layout?: GridLayout | TilingLayout;
  readonly executionPlan?: readonly ActionExecution[];
  readonly diagnostics: FullDiagnostics;
}

/**
 * Heals the partial changes of a needs-clarification result the way
 * {@link processResponse} heals a plan's `layout` and `executionPlan`.
 *
 * A `layout` is healed together with the Actions, as a plan's would be. An
 * `executionPlan` without a `layout` is checked against the request's
 * Instances, as a plan that keeps the current layout would be. Records of
 * what healing dropped, skipped or repaired land in the diagnostics; whether
 * they are acceptable is the caller's decision.
 */
export function processPartialChanges({
  changes,
  ...input
}: ProcessPartialChangesInput): Result<HealedPartialChanges, EngineError> {
  const { layout, executionPlan } = changes;
  if (layout === undefined) {
    const planned = planActions(input, {
      instances: input.request.instances,
      proposed: executionPlan ?? [],
      // The current layout stays, so it is never an emptied layout.
      healedLayoutSize: input.request.instances.length,
      droppedEntries: [],
      warnings: [],
    });
    return ok(
      executionPlan === undefined
        ? { diagnostics: planned.diagnostics }
        : planned,
    );
  }
  // The clarification schema for the request's mode already matched, so the
  // layout has that mode's shape. A clarification carries no rationale, and
  // the placeholder keeps healing from warning that one is missing.
  const llmOutput = {
    type: 'plan',
    rationale: PARTIAL_CHANGES_RATIONALE,
    layout,
    executionPlan: executionPlan ?? [],
  } as ReplylessCandidate;
  const healed = healCandidate({ ...input, llmOutput });
  if (isErr(healed)) return healed;
  return ok(
    executionPlan === undefined
      ? { layout: healed.value.layout, diagnostics: healed.value.diagnostics }
      : healed.value,
  );
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

const PARTIAL_CHANGES_RATIONALE = 'Partial changes alongside a clarification.';

interface HealedChanges {
  readonly layout: GridLayout | TilingLayout;
  readonly executionPlan: readonly ActionExecution[];
  readonly diagnostics: FullDiagnostics;
}

function healCandidate({
  llmOutput,
  request,
  enumSnapshot,
  logger,
}: ProcessResponseInput): Result<HealedChanges, EngineError> {
  // `layoutMode` is the upstream discriminator: the candidate validator
  // checks `llmOutput`, or the clarification it was built from, against the
  // schema for `request.context.layoutMode` before calling this, so these casts are
  // type-safe narrowings. The narrowing lives here at the dispatch site
  // (rather than in a helper) so the discriminator → branch correspondence
  // is locally legible; each cast is paired with the case that justifies it.
  const mode = request.context.layoutMode;
  const turn = classifyExecutionTurn(request);
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
      healed = healTilingLayout(llmOutput as TilingResponse, request, {
        enumSnapshot,
        turn,
      });
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
  const planned = planActions(
    { request, enumSnapshot, logger },
    {
      instances: planInstances,
      proposed: llmOutput.executionPlan,
      healedLayoutSize: layoutEntryCount(healed),
      droppedEntries: healed.droppedEntries,
      warnings: healed.warnings,
    },
  );
  return ok({ layout, ...planned });
}

interface PlanActionsInput extends Pick<
  HealedLayout,
  'droppedEntries' | 'warnings'
> {
  /** The Instances the Actions are simulated against. */
  readonly instances: readonly VesselInstanceSnapshot[];
  readonly proposed: readonly RawActionExecution[];
  readonly healedLayoutSize: number;
}

function planActions(
  {
    request,
    enumSnapshot,
    logger,
  }: Pick<ProcessResponseInput, 'request' | 'enumSnapshot' | 'logger'>,
  {
    instances,
    proposed,
    healedLayoutSize,
    droppedEntries,
    warnings,
  }: PlanActionsInput,
): Omit<HealedChanges, 'layout'> {
  const { plan: executionPlan, skippedActions } = parseExecutionPlan(proposed, {
    instances,
    vessels: request.vessels,
    enumSnapshot,
    turn: classifyExecutionTurn(request),
    logger,
  });
  const retryHint = deriveRetryHint({
    healedLayoutSize,
    requestInstanceCount: request.instances.length,
    proposedActionCount: proposed.length,
    acceptedActionCount: executionPlan.length,
    skippedActions,
    droppedLayoutCount: droppedEntries.length,
    warningCount: warnings.length,
  });
  return {
    executionPlan,
    diagnostics: buildDiagnostics({
      skippedActions,
      droppedLayoutEntries: droppedEntries,
      warnings,
      retryHint,
    }),
  };
}
