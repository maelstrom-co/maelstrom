import type { Vessel } from '@maelstrom/protocol';

/**
 * Registry for managing Vessel definitions.
 * Tracks which vessels are available in the system.
 */
export interface VesselRegistry {
  /** Register a vessel definition */
  register(vessel: Vessel): void;
  /** Unregister a vessel by ID */
  unregister(vesselId: string): void;
  /** Get a vessel by ID */
  get(vesselId: string): Vessel | undefined;
  /** Get all registered vessels */
  getAll(): Vessel[];
  /** Check if a vessel is registered */
  has(vesselId: string): boolean;
}

/**
 * Creates a new vessel registry.
 */
export function createVesselRegistry(): VesselRegistry {
  const vessels = new Map<string, Vessel>();

  return {
    register(vessel: Vessel): void {
      vessels.set(vessel.id, vessel);
    },

    unregister(vesselId: string): void {
      vessels.delete(vesselId);
    },

    get(vesselId: string): Vessel | undefined {
      return vessels.get(vesselId);
    },

    getAll(): Vessel[] {
      return Array.from(vessels.values());
    },

    has(vesselId: string): boolean {
      return vessels.has(vesselId);
    },
  };
}
