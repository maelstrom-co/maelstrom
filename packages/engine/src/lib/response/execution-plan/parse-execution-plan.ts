import type {
  ActionExecution,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { isErr } from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../../action-parameter-enum.js';
import type { Logger } from '../../logger.js';
import { parseParams } from './parse-params.js';
import type { ExecutionPolicy } from './policy.js';
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
import type { RawActionExecution, SkippedAction } from './types.js';
import {
  hasInvalidActionParameterDefinitions,
  validateParams,
} from './validate-params.js';

/** Parses one Action without mutating simulated Variant state on any failure. */
function parseSingleAction(
  item: RawActionExecution,
  lookups: ValidationLookups,
  policy: ExecutionPolicy,
  simReader: SimulationState,
  simWriter: SimulationStateWriter,
  skippedActions: SkippedAction[],
  enumSnapshot: ActionParameterEnumSnapshot,
  logger: Logger,
): ActionExecution[] {
  const resolution = resolveAction(item, lookups, policy, simReader);
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
  instances: readonly VesselInstanceSnapshot[],
  vessels: readonly Vessel[],
  enumSnapshot: ActionParameterEnumSnapshot,
  logger: Logger,
  policy: ExecutionPolicy,
): ParsedExecutionPlan {
  const lookups: ValidationLookups = {
    instanceMap: new Map(instances.map((i) => [i.instanceId, i])),
    vesselMap: new Map(vessels.map((v) => [v.id, v])),
  };

  const { reader: simReader, writer: simWriter } = createSimulationState(
    instances.map((i) => [i.instanceId, i.variant]),
  );
  const skippedActions: SkippedAction[] = [];

  // Sequential: simWriter mutates between iterations, so each action validates
  // against the variant left by the previous one. Reordering would break the
  // validation contract.
  const resultPlan = plan.flatMap((item) =>
    parseSingleAction(
      item,
      lookups,
      policy,
      simReader,
      simWriter,
      skippedActions,
      enumSnapshot,
      logger,
    ),
  );

  return { plan: resultPlan, skippedActions };
}
