import {
  type ActionName,
  err,
  type InstanceId,
  ok,
  type Result,
  type VariantName,
  type Vessel,
  type VesselAction,
  type VesselId,
} from '@maelstrom-co/protocol';

interface InstanceVariant {
  readonly instanceId: InstanceId;
  readonly vesselId: VesselId;
  readonly variant: VariantName;
}

interface ActionStep {
  readonly instanceId: InstanceId;
  readonly action: ActionName;
}

/** Why {@link finalVariants} could not simulate an action. */
export type SimulationError =
  | { readonly kind: 'unknown_instance'; readonly step: ActionStep }
  | { readonly kind: 'action_not_valid'; readonly step: ActionStep }
  | {
      readonly kind: 'unknown_target';
      readonly step: ActionStep;
      readonly target: VariantName;
    };

/**
 * The variant each instance ends in once `actions` run in order: an action
 * with `transitionsTo` moves its instance to that variant, any other action
 * leaves it. This is the engine's simulate-variant rule. An action the
 * instance's simulated variant does not offer, or whose target the Vessel
 * lacks, is an error rather than the engine's silent skip, because a Jev
 * plan that needs the skip should defer instead.
 */
export function finalVariants(
  instances: readonly InstanceVariant[],
  actions: readonly ActionStep[],
  vessels: readonly Vessel[],
): Result<ReadonlyMap<InstanceId, VariantName>, SimulationError> {
  const variants = new Map(
    instances.map((instance) => [instance.instanceId, instance.variant]),
  );
  const vesselOf = new Map(
    instances.map((instance) => [instance.instanceId, instance.vesselId]),
  );
  for (const step of actions) {
    const current = variants.get(step.instanceId);
    const vessel = vessels.find((v) => v.id === vesselOf.get(step.instanceId));
    if (current === undefined || vessel === undefined)
      return err({ kind: 'unknown_instance', step });
    const definition = vessel.variants[current]?.actions.find(
      (action) => action.name === step.action,
    );
    if (definition === undefined)
      return err({ kind: 'action_not_valid', step });
    const target = definition.transitionsTo;
    if (target === undefined) continue;
    if (!Object.hasOwn(vessel.variants, target))
      return err({ kind: 'unknown_target', step, target });
    variants.set(step.instanceId, target);
  }
  return ok(variants);
}

/** The actions an instance of `vesselId` offers in `variant`. */
export function legalActions(
  vesselId: VesselId,
  variant: VariantName,
  vessels: readonly Vessel[],
): readonly VesselAction[] {
  const vessel = vessels.find((v) => v.id === vesselId);
  if (!vessel || !Object.hasOwn(vessel.variants, variant)) return [];
  return vessel.variants[variant].actions;
}
