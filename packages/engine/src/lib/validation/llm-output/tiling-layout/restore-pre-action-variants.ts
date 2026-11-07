import type {
  ActionExecution,
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
 * that Action resolve against its own target. Each Instance's Actions are
 * replayed in plan order twice under the same params and turn rules, once
 * from the request Variant and once from the Layout Variant. The Instance is
 * restored when the Actions accepted from the request Variant end exactly on
 * the Layout Variant and every Action accepted from the Layout Variant is
 * also accepted, in the same order, from the request Variant. Rejected
 * Actions keep their own skip diagnostics either way. That rule leaves a
 * direct switch (no transition), a transition the request Variant does not
 * offer, a transition to some other Variant, and an Action only the Layout
 * Variant offers untouched.
 *
 * An unrestored Instance whose Layout changes its Variant while an Action
 * accepted from the Layout Variant transitions to a different Variant is
 * reported as a conflict and kept exactly as declared.
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
    const acceptedFromRequest = acceptedActions(
      requested,
      actions,
      request.vessels,
      acceptance,
    );
    const acceptedFromLayout = acceptedActions(
      { ...requested, variant: instance.variant },
      actions,
      request.vessels,
      acceptance,
    );
    if (
      acceptedActionsEndOn(
        instance.variant,
        requested,
        acceptedFromRequest,
        request.vessels,
      ) &&
      containsInOrder(acceptedFromRequest, acceptedFromLayout)
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
      acceptedFromLayout,
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

function acceptedActions(
  instance: VesselInstanceSnapshot,
  actions: readonly PlannedAction[],
  vessels: readonly Vessel[],
  acceptance: ActionAcceptance,
): readonly ActionExecution[] {
  return parseExecutionPlan(actions, {
    instances: [instance],
    vessels,
    ...acceptance,
    logger: silentLogger,
  }).plan;
}

function acceptedActionsEndOn(
  layoutVariant: VariantName,
  requested: VesselInstanceSnapshot,
  accepted: readonly ActionExecution[],
  vessels: readonly Vessel[],
): boolean {
  const replay = finalVariants([requested], accepted, vessels);
  return (
    isOk(replay) && replay.value.get(requested.instanceId) === layoutVariant
  );
}

// Accepted params are parsed from the plan's paramsJson, so the same step
// serializes identically in both replays.
function containsInOrder(
  plan: readonly ActionExecution[],
  subsequence: readonly ActionExecution[],
): boolean {
  let next = 0;
  for (const step of plan) {
    const wanted = subsequence[next];
    if (
      wanted !== undefined &&
      wanted.action === step.action &&
      JSON.stringify(wanted.params) === JSON.stringify(step.params)
    ) {
      next += 1;
    }
  }
  return next === subsequence.length;
}

// Every accepted step up to the first transition away resolves on the Layout
// Variant, so the lookup never needs to follow the simulation further.
function firstTransitionAwayFromLayout(
  accepted: readonly ActionExecution[],
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

  for (const step of accepted) {
    const target = vessel.variants[layoutVariant].actions.find(
      (action) => action.name === step.action,
    )?.transitionsTo;
    if (target !== undefined && target !== layoutVariant) {
      return { actionName: step.action, actionTarget: target };
    }
  }
  return undefined;
}
