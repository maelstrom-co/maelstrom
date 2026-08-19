import type { Vessel, VesselId } from '@maelstrom-co/protocol';

/** Registry state for validated Vessel definitions. */
export type VesselManagerState = {
  /** Registered Vessels keyed by Vessel identity. */
  vessels: Map<VesselId, Vessel>;
};

/** Creates an empty Vessel registry. */
export function createInitialVesselManagerState(): VesselManagerState {
  return {
    vessels: new Map(),
  };
}
