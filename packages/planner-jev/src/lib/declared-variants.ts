import { finalVariants, type SimulationError } from '@maelstrom-co/engine';
import {
  type InstanceId,
  isErr,
  ok,
  type Result,
  type VariantName,
  type Vessel,
  type VesselId,
} from '@maelstrom-co/protocol';

import type { PlannedAction } from './types.js';

interface RetainedInstance {
  readonly instanceId: InstanceId;
  readonly vesselId: VesselId;
  readonly variant: VariantName;
}

/** What a candidate declares, and the variants its actions leave each instance in. */
export interface DeclaredVariants {
  /** Each retained instance's variant before the planned actions run: what the layout declares. */
  readonly variants: ReadonlyMap<InstanceId, VariantName>;
  /** Each retained instance's variant after the planned actions run: what the layout must fit. */
  readonly finalVariants: ReadonlyMap<InstanceId, VariantName>;
  /** The planned actions, every one of them, in order. */
  readonly actions: readonly PlannedAction[];
}

/**
 * Declares every retained instance in its variant before the planned actions
 * run, and replays the actions to find the variants they leave it in.
 *
 * The client applies the declared variant first, then runs each action and
 * applies its transition, so every action ships, view switches included. The
 * layout is sized for the variants after the actions, which is what stays on
 * screen. A replay that fails returns its {@link SimulationError}.
 */
export function declaredVariants(
  instances: readonly RetainedInstance[],
  actions: readonly PlannedAction[],
  vessels: readonly Vessel[],
): Result<DeclaredVariants, SimulationError> {
  const final = finalVariants(instances, actions, vessels);
  if (isErr(final)) return final;
  return ok({
    variants: new Map(
      instances.map((instance) => [instance.instanceId, instance.variant]),
    ),
    finalVariants: final.value,
    actions,
  });
}
