import type {
  ChartDimensions,
  GridLayout,
  LayoutMode,
  TilingLayout,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import type { Orchestrator } from '../orchestrator/orchestrator.js';

/**
 * Terse, structural-only view of what is on screen. Deliberately excludes
 * vessel domain data: the engine plans structurally and the model grounds on
 * shape, never contents (MAE-300 D6 / open question 5).
 */
export interface UiStructuralSnapshot {
  readonly instances: readonly VesselInstanceSnapshot[];
  /** Current positions; null before the first layout applies. */
  readonly layout: GridLayout | TilingLayout | null;
  readonly layoutMode: LayoutMode;
  readonly chartDimensions: ChartDimensions;
}

/** Pure read of the Orchestrator's microkernel stores into a snapshot. */
export function readStructuralSnapshot(
  orchestrator: Orchestrator,
): UiStructuralSnapshot {
  const { instances, layout } = orchestrator.commandProcessor.store.state;
  return {
    // Branded ids flow through unchanged — no casts.
    instances: [...instances.values()].map(
      ({ instanceId, vesselId, variant }) => ({
        instanceId,
        vesselId,
        variant,
      }),
    ),
    layout,
    layoutMode: orchestrator.getConfig().layoutMode,
    chartDimensions: orchestrator.chartManager.getDimensions(),
  };
}
