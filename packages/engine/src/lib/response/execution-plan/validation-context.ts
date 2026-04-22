import type {
  GridResponse,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import type { Logger } from '../../logger.js';

export type RawActionExecution = GridResponse['executionPlan'][number];

export type SkippedActionReason =
  | 'unknown_instance'
  | 'unknown_vessel'
  | 'no_simulated_variant'
  | 'variant_not_on_vessel'
  | 'action_not_valid'
  | 'params_parse_failed'
  | 'state_drift';

/**
 * Structured record of an action the engine refused to include in the
 * execution plan. Downstream consumers (retry pipeline, observability)
 * discriminate on `reason` to decide whether a skip is retryable; keep
 * `reason` a closed union and stable.
 */
export interface SkippedAction {
  readonly instanceId: string;
  readonly action: string;
  readonly reason: SkippedActionReason;
  readonly detail?: string;
}

export interface ValidationLookups {
  readonly instanceMap: ReadonlyMap<string, VesselInstanceSnapshot>;
  readonly vesselMap: ReadonlyMap<string, Vessel>;
  readonly logger: Logger;
}

/**
 * Mutable per-instance variant state as the plan is walked. Split from
 * {@link ValidationLookups} so the two value categories — frozen inputs
 * vs. accumulating state — have distinct types at the call sites.
 *
 * Note on `readonly`: the `variants` field prevents reassignment of the
 * Map reference, but callers can still mutate the Map contents via
 * `.set()` / `.delete()`. The "simulation mutates" discipline is enforced
 * by convention — only {@link updateSimulatedVariant} writes to
 * `sim.variants`, and it is the only site in the module with write access.
 */
export interface SimulationState {
  readonly variants: Map<string, string>;
}
