import type { Vessel } from '@maelstrom/protocol';

export type VesselManagerState = {
  vessels: Map<string, Vessel>;
};

export function createInitialVesselManagerState(): VesselManagerState {
  return {
    vessels: new Map(),
  };
}
