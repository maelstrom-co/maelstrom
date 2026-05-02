import type {
  ActionName,
  GridResponse,
  InstanceId,
  Vessel,
  VesselId,
  VesselInstanceSnapshot,
  VariantName,
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
      readonly instanceId: InstanceId;
      readonly action: ActionName;
    }
  | {
      readonly reason: 'unknown_vessel';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
    }
  | {
      readonly reason: 'no_simulated_variant';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
    }
  | {
      readonly reason: 'variant_not_on_vessel';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly variant: VariantName;
    }
  | {
      readonly reason: 'action_not_valid';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly variant: VariantName;
      readonly validActions: readonly ActionName[];
    }
  | {
      readonly reason: 'params_parse_failed';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly paramsJson: string;
    }
  | {
      readonly reason: 'state_drift';
      readonly instanceId: InstanceId;
      readonly action: ActionName;
      readonly vesselId: VesselId;
      readonly targetVariant: VariantName;
    };

export interface ValidationLookups {
  readonly instanceMap: ReadonlyMap<InstanceId, VesselInstanceSnapshot>;
  readonly vesselMap: ReadonlyMap<VesselId, Vessel>;
  readonly logger: Logger;
}

/**
 * Read-only view of variant simulation state. Returned to all consumers of
 * `parseExecutionPlan`'s internals so reads are safe but writes are
 * impossible at the type level.
 */
export interface SimulationState {
  readonly variants: ReadonlyMap<InstanceId, VariantName>;
}

/**
 * Mutating view over the same underlying Map. The split exists so consumers
 * that only need to read take `SimulationState` (a `ReadonlyMap` view) and
 * cannot mutate at the type level.
 */
export interface SimulationStateWriter {
  readonly variants: Map<InstanceId, VariantName>;
}

/**
 * Constructs both views over a single underlying Map. Returns the writer
 * so the caller can populate / mutate; the reader is the same Map widened.
 *
 * @param seed Initial variant assignments (typically derived from
 *   `request.instances`).
 */
export const createSimulationState = (
  seed: Iterable<readonly [InstanceId, VariantName]>,
): { reader: SimulationState; writer: SimulationStateWriter } => {
  const map = new Map<InstanceId, VariantName>(seed);
  return { reader: { variants: map }, writer: { variants: map } };
};
