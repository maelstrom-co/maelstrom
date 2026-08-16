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
  SimulationState,
  SimulationStateWriter,
  ValidationLookups,
} from './state.js';
import { createSimulationState } from './state.js';
import type { RawActionExecution, SkippedAction } from './types.js';
import { validateParams } from './validate-params.js';

function parseSingleAction(
  item: RawActionExecution,
  lookups: ValidationLookups,
  simReader: SimulationState,
  simWriter: SimulationStateWriter,
  skippedActions: SkippedAction[],
  logger: Logger,
): ActionExecution[] {
  const resolution = resolveAction(item, lookups, simReader);
  if (isErr(resolution)) {
    logResolveFailure(item, resolution.error, logger);
    skippedActions.push(resolveFailureToSkipped(item, resolution.error));
    return [];
  }
  const resolved = resolution.value;

  let params: Record<string, unknown> | undefined;
  if (item.paramsJson !== undefined) {
    params = parseParams(item.paramsJson, item.action, item.instanceId, logger);

    if (params === undefined) {
      skippedActions.push({
        reason: 'params_parse_failed',
        instanceId: item.instanceId,
        action: item.action,
      });
      return [];
    }
  }

  const issues = validateParams(resolved.actionDef, params);
  if (issues.length > 0) {
    logger.warn(
      `Invalid params for action "${item.action}" on "${item.instanceId}", skipping action`,
      { issues },
    );
    skippedActions.push({
      reason: 'params_validation_failed',
      instanceId: item.instanceId,
      action: item.action,
      issues,
    });
    return [];
  }

  if (params === undefined) {
    const outcome = updateSimulatedVariant(item, resolved, logger, simWriter);
    if (outcome.kind === 'drift') {
      skippedActions.push(
        stateDriftSkipped(item, resolved, outcome.targetVariant),
      );
      return [];
    }
    return [{ instanceId: item.instanceId, action: item.action }];
  }

  const outcome = updateSimulatedVariant(item, resolved, logger, simWriter);
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
      simReader,
      simWriter,
      skippedActions,
      logger,
    ),
  );

  return { plan: resultPlan, skippedActions };
}
