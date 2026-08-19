import type {
  GridLayout,
  InstanceId,
  LayoutMode,
  TilingLayout,
} from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

/** Lifecycle status of the sequential command processor. */
export type CommandProcessingStatus = 'idle' | 'processing' | 'error';

/** Current command-processing state, including the retained Instances and layout. */
export type CommandProcessingState = {
  /** Current processor lifecycle status. */
  status: CommandProcessingStatus;
  /** Retained Instances keyed by identity. */
  instances: Map<InstanceId, VesselInstance>;
  /** Most recently applied layout, or `null` before one is applied. */
  layout: GridLayout | TilingLayout | null;
  /** Layout strategy expected by subsequent commands. */
  layoutMode: LayoutMode;
  /** Most recent processing failure, or `null` when none is retained. */
  lastError: Error | null;
};

/** Creates empty, idle command state for the selected layout mode. */
export function createInitialCommandProcessingState(
  layoutMode: LayoutMode = 'tiling',
): CommandProcessingState {
  return {
    status: 'idle' as CommandProcessingStatus,
    instances: new Map(),
    layout: null,
    layoutMode,
    lastError: null,
  };
}
