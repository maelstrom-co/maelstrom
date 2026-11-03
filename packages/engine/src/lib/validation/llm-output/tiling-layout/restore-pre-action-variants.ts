import type {
  ActionName,
  ChartRequest,
  InstanceId,
  TilingResponse,
  VariantName,
  Vessel,
  VesselId,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { isOk } from '@maelstrom-co/protocol';

import { finalVariants } from '../../../response/execution-plan/final-variants.js';
import type { HealedTilingInstance, LayoutWarning } from '../healed-layout.js';

type PlannedAction = TilingResponse['executionPlan'][number];

/**
 * Resets each existing Instance that the response declared in its
 * post-action Variant back to the Variant it has in the request.
 *
 * The client applies the Layout before it runs the Execution Plan, so a
 * Layout that already names the Variant a transition Action leads to makes
 * that Action resolve against its own target. An Instance is restored only
 * when its Actions, replayed in plan order from the request Variant, all
 * resolve and end exactly on the Layout Variant. That one rule leaves a
 * direct switch (no transition), an Action the request Variant does not
 * offer, and a transition to some other Variant untouched.
 *
 * An unrestored Instance whose Layout changes its Variant while one of its
 * transition Actions targets a different Variant is reported as a conflict
 * and kept exactly as declared.
 */
export function restorePreActionVariants(
  healedInstances: readonly HealedTilingInstance[],
  executionPlan: readonly PlannedAction[],
  request: ChartRequest,
): {
  readonly instances: HealedTilingInstance[];
  readonly warnings: LayoutWarning[];
} {
  const requestInstanceById = new Map<InstanceId, VesselInstanceSnapshot>(
    request.instances.map((instance) => [instance.instanceId, instance]),
  );
  const warnings: LayoutWarning[] = [];

  const instances = healedInstances.map((instance) => {
    const requested = requestInstanceById.get(instance.instanceId);
    if (
      requested === undefined ||
      requested.vesselId !== instance.vesselId ||
      requested.variant === instance.variant
    ) {
      return instance;
    }

    const actions = executionPlan.filter(
      (step) => step.instanceId === instance.instanceId,
    );
    const replay = finalVariants([requested], actions, request.vessels);
    if (
      isOk(replay) &&
      replay.value.get(instance.instanceId) === instance.variant
    ) {
      warnings.push({
        kind: 'pre_action_variant_restored',
        instanceId: instance.instanceId,
        declaredVariant: instance.variant,
        restoredVariant: requested.variant,
      });
      return { ...instance, variant: requested.variant };
    }

    const conflict = firstTransitionAwayFromLayout(
      actions,
      instance.vesselId,
      [requested.variant, instance.variant],
      instance.variant,
      request.vessels,
    );
    if (conflict !== undefined) {
      warnings.push({
        kind: 'layout_variant_and_action_transition_conflict',
        instanceId: instance.instanceId,
        requestVariant: requested.variant,
        layoutVariant: instance.variant,
        actionName: conflict.actionName,
        actionTarget: conflict.actionTarget,
      });
    }
    return instance;
  });

  return { instances, warnings };
}

/**
 * Finds the first Action whose transition, looked up on each of
 * `lookupVariants` in order, targets a Variant other than `layoutVariant`.
 */
function firstTransitionAwayFromLayout(
  actions: readonly PlannedAction[],
  vesselId: VesselId,
  lookupVariants: readonly VariantName[],
  layoutVariant: VariantName,
  vessels: readonly Vessel[],
):
  | { readonly actionName: ActionName; readonly actionTarget: VariantName }
  | undefined {
  const vessel = vessels.find((candidate) => candidate.id === vesselId);
  if (vessel === undefined) return undefined;

  for (const step of actions) {
    const target = transitionTarget(vessel, lookupVariants, step.action);
    if (target !== undefined && target !== layoutVariant) {
      return { actionName: step.action, actionTarget: target };
    }
  }
  return undefined;
}

function transitionTarget(
  vessel: Vessel,
  lookupVariants: readonly VariantName[],
  actionName: ActionName,
): VariantName | undefined {
  for (const variant of lookupVariants) {
    if (!Object.hasOwn(vessel.variants, variant)) continue;
    const definition = vessel.variants[variant].actions.find(
      (action) => action.name === actionName,
    );
    if (definition !== undefined) return definition.transitionsTo;
  }
  return undefined;
}
