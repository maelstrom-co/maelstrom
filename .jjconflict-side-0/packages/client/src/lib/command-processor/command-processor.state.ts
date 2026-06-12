import type {
  GridLayout,
  InstanceId,
  LayoutMode,
  TilingLayout,
} from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

export type CommandProcessingStatus = 'idle' | 'processing' | 'error';

export type CommandProcessingState = {
  status: CommandProcessingStatus;
  instances: Map<InstanceId, VesselInstance>;
  layout: GridLayout | TilingLayout | null;
  layoutMode: LayoutMode;
  lastError: Error | null;
};

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
