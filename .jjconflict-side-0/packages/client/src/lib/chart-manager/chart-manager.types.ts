import type { ChartManagerState } from './chart-manager.state.js';

/**
 * Configuration options for the ChartManager.
 */
export interface ChartManagerOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Optional initial state (default: createInitialChartManagerState()) */
  initialState?: ChartManagerState;
}
