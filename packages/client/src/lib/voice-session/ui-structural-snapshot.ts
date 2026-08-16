import {
  type ChartDimensions,
  type GridLayout,
  getVisibleInstanceIds,
  type LayoutMode,
  type TilingLayout,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import type { Orchestrator } from '../orchestrator/orchestrator.js';

/**
 * Terse, structural-only view of what is on screen. Deliberately excludes
 * vessel domain data: the engine plans structurally and the model grounds on
 * shape, never contents.
 *
 * `instances` lists only rendered Instances. Hidden retained Instances stay
 * in the command-processor store for Engine requests and remount. Tiling
 * `layout.instances` is projected to those same visible IDs; the tree is
 * unchanged. Grid `positions` are unchanged. `layout` is null before the
 * first layout applies, and then `instances` is empty.
 */
export interface UIStructuralSnapshot {
  readonly instances: readonly VesselInstanceSnapshot[];
  readonly layout: GridLayout | TilingLayout | null;
  readonly layoutMode: LayoutMode;
  readonly chartDimensions: ChartDimensions;
}

/**
 * Visible-only structural snapshot of the Chart.
 *
 * Reads Orchestrator stores without mutating them. Top-level `instances` and
 * tiling `layout.instances` include only IDs from {@link getVisibleInstanceIds}.
 */
export function readStructuralSnapshot(
  orchestrator: Orchestrator,
): UIStructuralSnapshot {
  const { instances, layout } = orchestrator.commandProcessor.store.state;
  const visibleInstanceIds = getVisibleInstanceIds(layout);
  const visibleLayout =
    layout?.type === 'tiling'
      ? {
          ...layout,
          instances: layout.instances.filter(({ instanceId }) =>
            visibleInstanceIds.has(instanceId),
          ),
        }
      : layout;

  return {
    // Branded ids flow through unchanged — no casts.
    instances: [...instances.values()]
      .filter(({ instanceId }) => visibleInstanceIds.has(instanceId))
      .map(({ instanceId, vesselId, variant }) => ({
        instanceId,
        vesselId,
        variant,
      })),
    layout: visibleLayout,
    layoutMode: orchestrator.getConfig().layoutMode,
    chartDimensions: orchestrator.chartManager.getDimensions(),
  };
}
