import {
  type ActionExecution,
  err,
  type InstanceId,
  ok,
  type Result,
  type VariantName,
  type Vessel,
  type VesselAction,
  type VesselId,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

type InstanceVariant = Readonly<
  Pick<VesselInstanceSnapshot, 'instanceId' | 'vesselId' | 'variant'>
>;

type ActionStep = Readonly<Pick<ActionExecution, 'instanceId' | 'action'>>;

/**
 * Why {@link finalVariants} stopped replaying an Execution Plan. Each case
 * carries the `step` it stopped at; the steps before it replayed cleanly.
 */
export type SimulationError =
  /** The step names an instance missing from `instances`, or one whose Vessel is missing from `vessels`. */
  | { readonly kind: 'unknown_instance'; readonly step: ActionStep }
  /** The instance's replayed variant does not offer the step's action. */
  | { readonly kind: 'action_not_valid'; readonly step: ActionStep }
  /** The action's `transitionsTo` names a variant the Vessel does not define. */
  | {
      readonly kind: 'unknown_target';
      readonly step: ActionStep;
      /** The missing variant the action transitions to. */
      readonly target: VariantName;
    };

/**
 * Replays an Execution Plan's actions in order and returns the variant each
 * instance ends in.
 *
 * An action with `transitionsTo` moves its instance to that variant, and each
 * later action resolves against the variant reached so far. Any other action
 * leaves the variant unchanged, as do instances no action targets.
 *
 * Where the Engine skips an action it cannot resolve and carries on, this
 * replay stops at the first such action and returns a {@link SimulationError},
 * so a planner can reject or repair the plan before handing it over.
 *
 * @param instances - The instances and their variants before the plan runs.
 * @param actions - The plan's actions, in execution order.
 * @param vessels - The catalog the instances belong to.
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

/**
 * The actions an instance of `vesselId` offers while in `variant`: the
 * variant's declared actions, in declaration order. Empty when the Vessel or
 * the variant is not in `vessels`.
 */
export function legalActions(
  vesselId: VesselId,
  variant: VariantName,
  vessels: readonly Vessel[],
): readonly VesselAction[] {
  const vessel = vessels.find((v) => v.id === vesselId);
  if (!vessel || !Object.hasOwn(vessel.variants, variant)) return [];
  return vessel.variants[variant].actions;
}
