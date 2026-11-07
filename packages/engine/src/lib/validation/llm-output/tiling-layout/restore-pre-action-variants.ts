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

import type { Logger } from '../../../logger.js';
import { finalVariants } from '../../../response/execution-plan/final-variants.js';
import {
  type PlanContext,
  parseExecutionPlan,
} from '../../../response/execution-plan/parse-execution-plan.js';
import type { HealedTilingInstance, LayoutWarning } from '../healed-layout.js';

type PlannedAction = TilingResponse['executionPlan'][number];

export type ActionAcceptance = Pick<PlanContext, 'enumSnapshot' | 'turn'>;

/**
 * Resets each existing Instance that the response declared in its
 * post-action Variant back to the Variant it has in the request.
 *
 * The client applies the Layout before it runs the Execution Plan, so a
 * Layout that already names the Variant a transition Action leads to makes
 * that Action resolve against its own target. An Instance is restored only
 * when the Engine would accept every one of its Actions, replayed in plan
 * order from the request Variant under the same params and turn rules, and
 * the accepted Actions end exactly on the Layout Variant. That one rule
 * leaves a direct switch (no transition), an Action the request Variant does
 * not offer, an Action the Engine would skip, and a transition to some other
 * Variant untouched.
 *
 * An unrestored Instance whose Layout changes its Variant while one of its
 * Actions, looked up on the Layout Variant, transitions to a different
 * Variant is reported as a conflict and kept exactly as declared.
 */
export function restorePreActionVariants(
  healedInstances: readonly HealedTilingInstance[],
  executionPlan: readonly PlannedAction[],
  request: ChartRequest,
  acceptance: ActionAcceptance,
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
    if (
      acceptedActionsEndOn(
        instance.variant,
        requested,
        actions,
        request.vessels,
        acceptance,
      )
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

// The Engine parses the plan again after the heal and logs its skips there.
const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function acceptedActionsEndOn(
  layoutVariant: VariantName,
  requested: VesselInstanceSnapshot,
  actions: readonly PlannedAction[],
  vessels: readonly Vessel[],
  acceptance: ActionAcceptance,
): boolean {
  const { plan, skippedActions } = parseExecutionPlan(actions, {
    instances: [requested],
    vessels,
    ...acceptance,
    logger: silentLogger,
  });
  if (skippedActions.length > 0) return false;
  const replay = finalVariants([requested], plan, vessels);
  return (
    isOk(replay) && replay.value.get(requested.instanceId) === layoutVariant
  );
}

function firstTransitionAwayFromLayout(
  actions: readonly PlannedAction[],
  vesselId: VesselId,
  layoutVariant: VariantName,
  vessels: readonly Vessel[],
):
  | { readonly actionName: ActionName; readonly actionTarget: VariantName }
  | undefined {
  const vessel = vessels.find((candidate) => candidate.id === vesselId);
  if (vessel === undefined || !Object.hasOwn(vessel.variants, layoutVariant)) {
    return undefined;
  }

  for (const step of actions) {
    const target = vessel.variants[layoutVariant].actions.find(
      (action) => action.name === step.action,
    )?.transitionsTo;
    if (target !== undefined && target !== layoutVariant) {
      return { actionName: step.action, actionTarget: target };
    }
  }
  return undefined;
}
