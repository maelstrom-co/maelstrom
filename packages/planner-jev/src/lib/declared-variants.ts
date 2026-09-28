import {
  finalVariants,
  legalActions,
  type SimulationError,
} from '@maelstrom-co/engine';
import {
  type InstanceId,
  isErr,
  ok,
  type Result,
  type VariantName,
  type Vessel,
  type VesselAction,
  type VesselId,
} from '@maelstrom-co/protocol';

import type { PlannedAction } from './types.js';

interface RetainedInstance {
  readonly instanceId: InstanceId;
  readonly vesselId: VesselId;
  readonly variant: VariantName;
  readonly fresh: boolean;
}

/** What a candidate declares: each retained instance's variant and the actions it ships. */
export interface DeclaredVariants {
  readonly variants: ReadonlyMap<InstanceId, VariantName>;
  /** The planned actions still to run, in order. */
  readonly actions: readonly PlannedAction[];
}

/**
 * Declares every retained instance in the variant the planned actions leave
 * it in, because clients show the declared variant and never apply the
 * transition of an Engine-issued action.
 *
 * The Engine seeds a new instance's action simulation from its declared
 * variant, so for a new instance the planned actions are replayed from that
 * final variant: a parameterless view switch it no longer offers is dropped,
 * having nothing left to do. When an action with parameters is not offered
 * on replay, or the replay ends elsewhere, the new instance keeps its
 * created variant and all its actions, so no parameter value is lost.
 */
export function declaredVariants(
  instances: readonly RetainedInstance[],
  actions: readonly PlannedAction[],
  vessels: readonly Vessel[],
): Result<DeclaredVariants, SimulationError> {
  const final = finalVariants(instances, actions, vessels);
  if (isErr(final)) return final;
  const variants = new Map(final.value);
  const dropped = new Set<PlannedAction>();
  for (const instance of instances) {
    const target = variants.get(instance.instanceId);
    if (!instance.fresh || target === undefined || target === instance.variant)
      continue;
    const redundant = redundantSwitches(
      instance,
      target,
      actions.filter((action) => action.instanceId === instance.instanceId),
      vessels,
    );
    if (redundant === undefined)
      variants.set(instance.instanceId, instance.variant);
    else for (const action of redundant) dropped.add(action);
  }
  return ok({
    variants,
    actions: actions.filter((action) => !dropped.has(action)),
  });
}

function redundantSwitches(
  instance: RetainedInstance,
  target: VariantName,
  actions: readonly PlannedAction[],
  vessels: readonly Vessel[],
): readonly PlannedAction[] | undefined {
  let planned = instance.variant;
  let replayed = target;
  const redundant: PlannedAction[] = [];
  for (const action of actions) {
    const original = offered(instance.vesselId, planned, action, vessels);
    const replay = offered(instance.vesselId, replayed, action, vessels);
    planned = original?.transitionsTo ?? planned;
    if (replay !== undefined) {
      replayed = replay.transitionsTo ?? replayed;
      continue;
    }
    const viewSwitch =
      original?.transitionsTo !== undefined &&
      Object.keys(action.params).length === 0 &&
      action.pending.length === 0;
    if (!viewSwitch) return undefined;
    redundant.push(action);
  }
  return replayed === target ? redundant : undefined;
}

function offered(
  vesselId: VesselId,
  variant: VariantName,
  action: PlannedAction,
  vessels: readonly Vessel[],
): VesselAction | undefined {
  return legalActions(vesselId, variant, vessels).find(
    (definition) => definition.name === action.action,
  );
}
