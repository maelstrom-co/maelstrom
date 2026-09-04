import type {
  GridLayout,
  InstanceId,
  LayoutMode,
  TilingLayout,
} from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

/** Processor phase; errors return to `idle` after the queue drains. */
export type CommandProcessingStatus = 'idle' | 'processing' | 'error';

/** Observable command state; failures preserve the last applied layout and Instances. */
export type CommandProcessingState = {
  /** Returns to `idle` after the queue drains, including after a command error. */
  status: CommandProcessingStatus;
  /** Reconciled by `set_layout`; omitted Instances are removed. */
  instances: Map<InstanceId, VesselInstance>;
  /** Last successfully applied layout; Action and failed layout commands leave it unchanged. */
  layout: GridLayout | TilingLayout | null;
  /** Initial-state metadata that {@link CommandProcessor} does not read or update. */
  layoutMode: LayoutMode;
  /**
   * Last thrown command error. Individual Action failures emit `action_error`;
   * this field clears when the next command starts. `waitForIdle()` is the
   * supported way to observe a failure after the fact; it does not read this
   * field.
   */
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
