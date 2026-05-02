import type { ActionRunner } from '@maelstrom-co/client';
import type {
  ActionName,
  InstanceId,
  VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';

import type { TypedVesselProps } from './vessel-entry-types.js';

/** Untyped vessel props — escape hatch for heterogeneous instance lists */
export interface UntypedVesselProps {
  instanceId: InstanceId;
  vesselId: VesselId;
  variantProps: { variant: string } & Record<string, unknown>;
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
  /** Remove vessel from all registries (vesselManager, componentMap, loadingMap) */
  unregister: () => void;
}
