import type {
  ActionExecution,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { isErr } from '@maelstrom-co/protocol';

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
  SimulationStateWriter,
  SkippedAction,
  ValidationLookups,
} from './validation-context.js';
import { createSimulationState } from './validation-context.js';

function parseSingleAction(
  item: RawActionExecution,
  lookups: ValidationLookups,
  simReader: SimulationState,
  simWriter: SimulationStateWriter,
  skippedActions: SkippedAction[],
): ActionExecution[] {
  const resolution = resolveAction(item, lookups, simReader);
  if (isErr(resolution)) {
    logResolveFailure(item, resolution.error, lookups.logger);
    skippedActions.push(resolveFailureToSkipped(item, resolution.error));
    return [];
  }
  const resolved = resolution.value;

  if (!item.paramsJson) {
    const outcome = updateSimulatedVariant(
      item,
      resolved,
      lookups.logger,
      simWriter,
    );
    if (outcome.kind === 'drift') {
      skippedActions.push(
        stateDriftSkipped(item, resolved, outcome.targetVariant),
      );
      return [];
    }
    return [{ instanceId: item.instanceId, action: item.action }];
  }

  const params = parseParams(
    item.paramsJson,
    item.action,
    item.instanceId,
    lookups.logger,
  );

  if (params === undefined) {
    skippedActions.push({
      reason: 'params_parse_failed',
      instanceId: item.instanceId,
      action: item.action,
      paramsJson: item.paramsJson,
    });
    return [];
  }

  const outcome = updateSimulatedVariant(
    item,
    resolved,
    lookups.logger,
    simWriter,
  );
  if (outcome.kind === 'drift') {
    skippedActions.push(
      stateDriftSkipped(item, resolved, outcome.targetVariant),
    );
    return [];
  }
  return [{ instanceId: item.instanceId, action: item.action, params }];
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

  const { reader: simReader, writer: simWriter } = createSimulationState(
    instances.map((i) => [i.instanceId, i.variant]),
  );
  const skippedActions: SkippedAction[] = [];

  // Sequential: simWriter mutates between iterations, so each action validates
  // against the variant left by the previous one. Reordering would break the
  // validation contract.
  const resultPlan = plan.flatMap((item) =>
    parseSingleAction(item, lookups, simReader, simWriter, skippedActions),
  );

  return { plan: resultPlan, skippedActions };
}
