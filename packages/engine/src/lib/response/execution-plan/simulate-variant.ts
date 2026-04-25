import type { Logger } from '../../logger.js';
import type { ResolvedAction } from './resolve-action.js';
import type {
  RawActionExecution,
  SimulationState,
} from './validation-context.js';

/**
 * `drift` carries `targetVariant` so the caller can surface it without
 * re-deriving from `resolved.actionDef.transitionsTo`, which is only
 * conventionally non-null on the drift branch.
 */
export type SimulationOutcome =
  | { readonly kind: 'advanced' }
  | { readonly kind: 'drift'; readonly targetVariant: string };

/**
 * VesselSchema statically rejects vessels whose `transitionsTo` targets are
 * missing, so the only way to reach the `drift` branch below at runtime is
 * live mutation of a registered vessel — i.e. state drift between the
 * validated definition and the object the engine is looking at now.
 *
 * The caller must drop the action on `drift`: returning it would let the
 * runtime attempt a transition the engine just declared impossible and
 * leave subsequent validation out of sync with runtime state.
 */
export function updateSimulatedVariant(
  item: RawActionExecution,
  resolved: ResolvedAction,
  logger: Logger,
  sim: SimulationState,
): SimulationOutcome {
  const { actionDef, vessel, instance, currentVariant } = resolved;
  if (!actionDef.transitionsTo) return { kind: 'advanced' };

  const targetVariant = actionDef.transitionsTo;
  if (!vessel.variants[targetVariant]) {
    logger.error(
      `Vessel state drift: action "${item.action}" transitions to variant "${targetVariant}" which is no longer present on vessel "${vessel.id}" (schema would reject this; vessel object must have been mutated after registration), dropping action`,
    );
    return { kind: 'drift', targetVariant };
  }

  logger.debug(
    `Simulated variant transition: instance "${item.instanceId}" (${instance.vesselId}) "${currentVariant}" -> "${targetVariant}"`,
  );
  sim.variants.set(item.instanceId, targetVariant);
  return { kind: 'advanced' };
}
