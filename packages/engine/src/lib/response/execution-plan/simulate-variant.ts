import type { VariantName } from '@maelstrom-co/protocol';

import type { Logger } from '../../logger.js';
import type { ResolvedAction } from './resolve-action.js';
import type { SimulationStateWriter } from './state.js';
import type { RawActionExecution } from './types.js';

/**
 * `drift` carries `targetVariant` so the caller can surface it without
 * re-deriving from `resolved.actionDef.transitionsTo`, which is only
 * conventionally non-null on the drift branch.
 */
export type SimulationOutcome =
  | { readonly kind: 'advanced' }
  | { readonly kind: 'drift'; readonly targetVariant: VariantName };

/**
 * VesselSchema statically rejects vessels whose `transitionsTo` targets are
 * missing, so the only way to reach the `drift` branch below at runtime is
 * live mutation of a registered vessel — i.e. state drift between the
 * validated definition and the object the engine is looking at now.
 *
 * The caller must drop the action on `drift`: returning it would let the
 * runtime attempt a transition the engine just declared impossible and
 * leave subsequent validation out of sync with runtime state.
 *
 * The reader/writer split is enforced at the type level — `SimulationState`
 * exposes a `ReadonlyMap` (no `.set()` / `.delete()`); the mutable Map is
 * only reachable through the `SimulationStateWriter` view.
 */
export function updateSimulatedVariant(
  item: RawActionExecution,
  resolved: ResolvedAction,
  logger: Logger,
  sim: SimulationStateWriter,
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
