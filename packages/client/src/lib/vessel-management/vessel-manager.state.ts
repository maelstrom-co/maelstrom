import type { Vessel } from '@maelstrom-co/protocol';

export type VesselManagerState = {
  vessels: Map<string, Vessel>;
};

export function createInitialVesselManagerState(): VesselManagerState {
  return {
    vessels: new Map(),
  };
}
