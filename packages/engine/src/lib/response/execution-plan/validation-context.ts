import type {
  GridResponse,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import type { Logger } from '../../logger.js';

export type RawActionExecution = GridResponse['executionPlan'][number];

/**
 * Discriminated record of an action the engine refused to plan. Keep the
 * union closed and the per-arm field set stable — callers exhaust it via
 * `switch (s.reason)` and read the structured fields directly.
 */
export type SkippedAction =
  | {
      readonly reason: 'unknown_instance';
      readonly instanceId: string;
      readonly action: string;
    }
  | {
      readonly reason: 'unknown_vessel';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
    }
  | {
      readonly reason: 'no_simulated_variant';
      readonly instanceId: string;
      readonly action: string;
    }
  | {
      readonly reason: 'variant_not_on_vessel';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly variant: string;
    }
  | {
      readonly reason: 'action_not_valid';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly variant: string;
      readonly validActions: readonly string[];
    }
  | {
      readonly reason: 'params_parse_failed';
      readonly instanceId: string;
      readonly action: string;
      readonly paramsJson: string;
    }
  | {
      readonly reason: 'state_drift';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly targetVariant: string;
    };

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
