import type {
  ActionExecution,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { isErr } from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../../action-parameter-enum.js';
import type { Logger } from '../../logger.js';
import { parseParams } from './parse-params.js';
import {
  logResolveFailure,
  resolveAction,
  resolveFailureToSkipped,
  stateDriftSkipped,
} from './resolve-action.js';
import { updateSimulatedVariant } from './simulate-variant.js';
import type {
  SimulationState,
  SimulationStateWriter,
  ValidationLookups,
} from './state.js';
import { createSimulationState } from './state.js';
import type { ExecutionTurn } from './turn.js';
import type { RawActionExecution, SkippedAction } from './types.js';
import {
  hasInvalidActionParameterDefinitions,
  validateParams,
} from './validate-params.js';

interface ActionContext {
  /** Enum candidates frozen for the request, shared by every Action. */
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  /** What triggered the turn, which decides whether a replayed Action runs. */
  readonly turn: ExecutionTurn;
  /** Sink for per-Action skip and validation warnings. */
  readonly logger: Logger;
}

/**
 * Immutable inputs every Action in one plan resolves against.
 *
 * `parseSingleAction` takes the narrower {@link ActionContext} this extends,
 * so the same object satisfies both without unpacking.
 */
export interface PlanContext extends ActionContext {
  /** Instances the Actions may target, request and response merged. */
  readonly instances: readonly VesselInstanceSnapshot[];
  /** Registered Vessels the instances resolve against. */
  readonly vessels: readonly Vessel[];
}

/** Scratch state one `parseExecutionPlan` call threads through its Actions. */
interface PlanRun {
  readonly lookups: ValidationLookups;
  readonly simReader: SimulationState;
  readonly simWriter: SimulationStateWriter;
  readonly skippedActions: SkippedAction[];
}

/** Parses one Action without mutating simulated Variant state on any failure. */
function parseSingleAction(
  item: RawActionExecution,
  context: ActionContext,
  run: PlanRun,
): ActionExecution[] {
  const { enumSnapshot, turn, logger } = context;
  const { lookups, simReader, simWriter, skippedActions } = run;

  const resolution = resolveAction(item, lookups, turn, simReader);
  if (isErr(resolution)) {
    logResolveFailure(item, resolution.error, logger);
    skippedActions.push(resolveFailureToSkipped(item, resolution.error));
    return [];
  }
  const resolved = resolution.value;

  if (hasInvalidActionParameterDefinitions(resolved.actionDef)) {
    logger.warn('Invalid Action parameter definitions, skipping action');
    skippedActions.push({
      reason: 'invalid_action_definition',
    });
    return [];
  }

  let params: Record<string, unknown> | undefined;
  if (item.paramsJson !== undefined) {
    const parsed = parseParams(
      item.paramsJson,
      item.action,
      item.instanceId,
      logger,
    );

    if (parsed.kind === 'parse_failed') {
      skippedActions.push({
        reason: 'params_parse_failed',
        instanceId: item.instanceId,
        action: item.action,
      });
      return [];
    }
    if (parsed.kind === 'limit') {
      skippedActions.push({
        reason: 'params_limits_exceeded',
        limit: parsed.limit,
      });
      return [];
    }
    params = parsed.params;
  }

  const validation = validateParams(resolved.actionDef, params, enumSnapshot);
  if (validation.kind === 'limit') {
    skippedActions.push({
      reason: 'params_limits_exceeded',
      limit: validation.limit,
    });
    return [];
  }
  if (validation.kind === 'invalid') {
    logger.warn(
      `Invalid params for action "${item.action}" on "${item.instanceId}", skipping action`,
      { issues: validation.issues },
    );
    skippedActions.push({
      reason: 'params_validation_failed',
      instanceId: item.instanceId,
      action: item.action,
      issues: validation.issues,
    });
    return [];
  }

  const outcome = updateSimulatedVariant(item, resolved, logger, simWriter);
  if (outcome.kind === 'drift') {
    skippedActions.push(
      stateDriftSkipped(item, resolved, outcome.targetVariant),
    );
    return [];
  }
  return [
    {
      instanceId: item.instanceId,
      action: item.action,
      ...(params !== undefined ? { params } : {}),
    },
  ];
}

export interface ParsedExecutionPlan {
  readonly plan: ActionExecution[];
  readonly skippedActions: SkippedAction[];
}

/**
 * Parses Actions sequentially against one immutable request enum snapshot.
 * Rejected Actions, including ambiguous duplicate definitions, leave the
 * simulated Variant unchanged for every following Action.
 */
export function parseExecutionPlan(
  plan: readonly RawActionExecution[],
  context: PlanContext,
): ParsedExecutionPlan {
  const { instances, vessels } = context;

  const { reader: simReader, writer: simWriter } = createSimulationState(
    instances.map((i) => [i.instanceId, i.variant]),
  );
  const run: PlanRun = {
    lookups: {
      instanceMap: new Map(instances.map((i) => [i.instanceId, i])),
      vesselMap: new Map(vessels.map((v) => [v.id, v])),
    },
    simReader,
    simWriter,
    skippedActions: [],
  };

  // Sequential: simWriter mutates between iterations, so each action validates
  // against the variant left by the previous one. Reordering would break the
  // validation contract.
  const resultPlan: ActionExecution[] = [];
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    if (item === undefined) continue;
    const skippedBefore = run.skippedActions.length;
    resultPlan.push(...parseSingleAction(item, context, run));
    for (
      let skipped = skippedBefore;
      skipped < run.skippedActions.length;
      skipped += 1
    ) {
      const entry = run.skippedActions[skipped];
      if (entry !== undefined) {
        Object.defineProperty(entry, 'index', {
          configurable: false,
          enumerable: false,
          value: index,
        });
      }
    }
  }

  return { plan: resultPlan, skippedActions: run.skippedActions };
}
