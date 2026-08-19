import type { Vessel, VesselId } from '@maelstrom-co/protocol';

/** Registry state whose registrations are validated; caller-supplied initial state is trusted. */
export type VesselManagerState = {
  /** Successful registration replaces any Vessel with the same identity. */
  vessels: Map<VesselId, Vessel>;
};

/** Creates an empty Vessel registry. */
export function createInitialVesselManagerState(): VesselManagerState {
  return {
    vessels: new Map(),
  };
}
