import type {
  ActionExecution,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { InstanceId, isErr } from '@maelstrom-co/protocol';

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
  RawActionExecution,
  SimulationState,
  SkippedAction,
  ValidationLookups,
} from './validation-context.js';

function parseSingleAction(
  item: RawActionExecution,
  lookups: ValidationLookups,
  sim: SimulationState,
  skippedActions: SkippedAction[],
): ActionExecution[] {
  const resolution = resolveAction(item, lookups, sim);
  if (isErr(resolution)) {
    logResolveFailure(item, resolution.error, lookups.logger);
    skippedActions.push(resolveFailureToSkipped(item, resolution.error));
    return [];
  }
  const resolved = resolution.value;

  const brandedInstanceId = InstanceId(item.instanceId);

  if (!item.paramsJson) {
    if (!updateSimulatedVariant(item, resolved, lookups.logger, sim)) {
      skippedActions.push(stateDriftSkipped(item, resolved));
      return [];
    }
    return [{ instanceId: brandedInstanceId, action: item.action }];
  }

  const params = parseParams(
    item.paramsJson,
    item.action,
    item.instanceId,
    lookups.logger,
  );

  if (params === undefined) {
    skippedActions.push({
      instanceId: item.instanceId,
      action: item.action,
      reason: 'params_parse_failed',
      detail: item.paramsJson,
    });
    return [];
  }

  if (!updateSimulatedVariant(item, resolved, lookups.logger, sim)) {
    skippedActions.push(stateDriftSkipped(item, resolved));
    return [];
  }
  return [{ instanceId: brandedInstanceId, action: item.action, params }];
}

export interface ParsedExecutionPlan {
  readonly plan: ActionExecution[];
  readonly skippedActions: SkippedAction[];
}

export function parseExecutionPlan(
  plan: readonly RawActionExecution[],
  instances: readonly VesselInstanceSnapshot[],
  vessels: readonly Vessel[],
  logger: Logger,
): ParsedExecutionPlan {
  const lookups: ValidationLookups = {
    instanceMap: new Map(instances.map((i) => [i.instanceId, i])),
    vesselMap: new Map(vessels.map((v) => [v.id, v])),
    logger,
  };

  const sim: SimulationState = {
    variants: new Map(instances.map((i) => [i.instanceId, i.variant])),
  };
  const skippedActions: SkippedAction[] = [];

  // Sequential: `sim` mutates between iterations, so each action validates
  // against the variant left by the previous one. Reordering would break the
  // validation contract.
  const resultPlan = plan.flatMap((item) =>
    parseSingleAction(item, lookups, sim, skippedActions),
  );

  return { plan: resultPlan, skippedActions };
}
