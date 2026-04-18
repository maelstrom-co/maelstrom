import type { Logger } from '../../logger.js';
import type { ResolvedAction } from './resolve-action.js';
import type {
  RawActionExecution,
  SimulationState,
} from './validation-context.js';

/**
 * VesselSchema statically rejects vessels whose `transitionsTo` targets are
 * missing, so the only way to reach the drift branch below at runtime is
 * live mutation of a registered vessel — i.e. state drift between the
 * validated definition and the object the engine is looking at now.
 *
 * Returns `true` when the simulation either advanced cleanly or the action
 * had no `transitionsTo`, and `false` when drift was detected. The caller
 * must drop the action on `false`: returning it would let the runtime
 * attempt a transition the engine just declared impossible and leave
 * subsequent validation out of sync with runtime state.
 */
export function updateSimulatedVariant(
  item: RawActionExecution,
  resolved: ResolvedAction,
  logger: Logger,
  sim: SimulationState,
): boolean {
  const { actionDef, vessel, instance, currentVariant } = resolved;
  if (!actionDef.transitionsTo) return true;

  const targetVariant = actionDef.transitionsTo;
  if (!vessel.variants[targetVariant]) {
    logger.error(
      `Vessel state drift: action "${item.action}" transitions to variant "${targetVariant}" which is no longer present on vessel "${vessel.id}" (schema would reject this; vessel object must have been mutated after registration), dropping action`,
    );
    return false;
  }

  logger.debug(
    `Simulated variant transition: instance "${item.instanceId}" (${instance.vesselId}) "${currentVariant}" -> "${targetVariant}"`,
  );
  sim.variants.set(item.instanceId, targetVariant);
  return true;
}
