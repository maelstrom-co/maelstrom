import type {
  InstanceId,
  VariantName,
  Vessel,
  VesselId,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

export interface ValidationLookups {
  readonly instanceMap: ReadonlyMap<InstanceId, VesselInstanceSnapshot>;
  readonly vesselMap: ReadonlyMap<VesselId, Vessel>;
}

export interface SimulationState {
  readonly variants: ReadonlyMap<InstanceId, VariantName>;
}

export interface SimulationStateWriter {
  readonly variants: Map<InstanceId, VariantName>;
}

export const createSimulationState = (
  seed: Iterable<readonly [InstanceId, VariantName]>,
): { reader: SimulationState; writer: SimulationStateWriter } => {
  const map = new Map<InstanceId, VariantName>(seed);
  return { reader: { variants: map }, writer: { variants: map } };
};
