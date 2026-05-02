import type { VesselManagerState } from './vessel-manager.state.js';

/**
 * Configuration options for the VesselManager.
 */
export interface VesselManagerOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Optional initial state (default: createInitialVesselManagerState()) */
  initialState?: VesselManagerState;
}
