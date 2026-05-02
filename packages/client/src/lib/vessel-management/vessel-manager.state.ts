import type { Vessel, VesselId } from '@maelstrom-co/protocol';

export type VesselManagerState = {
  vessels: Map<VesselId, Vessel>;
};

export function createInitialVesselManagerState(): VesselManagerState {
  return {
    vessels: new Map(),
  };
}
