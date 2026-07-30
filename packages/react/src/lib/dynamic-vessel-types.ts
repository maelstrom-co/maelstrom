import type { ActionRunner } from '@maelstrom-co/client';
import type {
  ActionName,
  InstanceId,
  VariantName,
  VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';

import type {
  RepublishableVessel,
  TypedVesselProps,
  UpdateVesselResult,
} from './vessel-entry-types.js';

/** Untyped vessel props — escape hatch for heterogeneous instance lists */
export interface UntypedVesselProps {
  instanceId: InstanceId;
  vesselId: VesselId;
  variantProps: { variant: VariantName } & Record<string, unknown>;
  executeAction: (name: ActionName, params?: Record<string, unknown>) => void;
}

/**
 * Handle returned by `m.registerVessel()` for dynamically registered vessels.
 * Provides typed hooks scoped to the registered vessel and a cleanup method.
 */
export interface DynamicVesselHandle<V extends VesselDefinition> {
  /** Typed vessel props hook — equivalent to `m.useVessel(vesselId, instanceId)` but pre-scoped */
  useVessel: (instanceId: string) => TypedVesselProps<V> | null;
  /** Typed action runner registration — equivalent to `m.useActions(vesselId, instanceId, runner)` but pre-scoped */
  useActions: (instanceId: string, runner: ActionRunner<V>) => void;
  /**
   * Republish this vessel's definition — its description, variants, and
   * action parameters — without touching its component registration, so the
   * vessel does not remount and keeps any DOM/canvas state it owns.
   *
   * This is the runtime-registration counterpart to `m.updateVessel()`: a
   * vessel registered via `registerVessel()` never appears in the factory's
   * `vessels` tuple, so `m.updateVessel()` cannot name its id at the type
   * level. `handle.update()` closes that gap — `V` is exactly the
   * definition inferred at the `registerVessel()` call site, fixed at
   * compile time, so `definition` is checked against it the same way
   * `m.updateVessel()` checks a factory-declared vessel's payload against
   * the entry passed to `createMaelstrom({ vessels })`.
   *
   * Enforces the same runtime guards as `m.updateVessel()`: throws a plain
   * `Error` if no Provider is mounted, the vessel id is not registered, or
   * the definition fails validation. Returns `{ ok: false, conflict }`
   * instead of throwing if a live instance's current variant is missing
   * from the new definition (`'variant_dropped'`), if the new definition
   * drops an action that instance's variant still declares
   * (`'action_dropped'`), or if a command batch is already queued or in
   * flight (`'batch_in_flight'`) — see `m.updateVessel()`'s JSDoc for the
   * full result contract.
   *
   * @example
   * const handle = m.registerVessel(widgetEntry);
   * const result = handle.update({ ...widgetEntry.vessel, description: 'Updated widget' });
   * if (!result.ok) {
   *   console.warn(result.conflict.message);
   * }
   */
  update: (definition: RepublishableVessel<V>) => UpdateVesselResult;
  /** Remove vessel from all registries (vesselManager, componentMap, loadingMap) */
  unregister: () => void;
}
