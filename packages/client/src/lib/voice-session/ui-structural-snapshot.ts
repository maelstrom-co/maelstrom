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
 * in the command-processor store for Engine requests and remount. Every ID in
 * the emitted grid positions, tiling tree, and tiling declarations resolves to
 * an emitted top-level Instance. The copied tiling tree preserves split and
 * `null` tokens, including consumed partial-root geometry, but replaces every
 * Instance token outside the rendered set with `null`. This includes retained
 * tokens after the first parsed preorder root: trailing tokens remain ignored
 * rather than becoming rendered. `layout` is null before the first layout
 * applies, and then `instances` is empty.
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
 * Reads Orchestrator stores without mutating the retained Instance map or
 * stored layout used by Engine requests and remount. Rendered IDs are the
 * intersection of retained IDs and {@link getVisibleInstanceIds}. Grid
 * positions, tiling declarations, and top-level Instances are copied and
 * filtered to that set. The complete tiling token array is copied iteratively;
 * split and existing `null` tokens keep their positions, while every other
 * token outside the rendered set becomes `null`. This preserves consumed
 * partial roots and nulls retained trailing tokens without promoting them.
 */
export function readStructuralSnapshot(
  orchestrator: Orchestrator,
): UIStructuralSnapshot {
  const { instances, layout } = orchestrator.commandProcessor.store.state;
  const retainedInstanceIds = new Set(instances.keys());
  const renderedInstanceIds = new Set(
    [...getVisibleInstanceIds(layout)].filter((instanceId) =>
      retainedInstanceIds.has(instanceId),
    ),
  );
  let visibleLayout: GridLayout | TilingLayout | null = layout;

  if (layout?.type === 'grid') {
    visibleLayout = {
      ...layout,
      positions: layout.positions.filter(({ instanceId }) =>
        renderedInstanceIds.has(instanceId),
      ),
    };
  } else if (layout?.type === 'tiling') {
    visibleLayout = {
      ...layout,
      tree: layout.tree.map((token) => {
        if (token === null || token === 'H' || token === 'V') return token;
        return renderedInstanceIds.has(token) ? token : null;
      }),
      instances: layout.instances.filter(({ instanceId }) =>
        renderedInstanceIds.has(instanceId),
      ),
    };
  }

  return {
    // Branded ids flow through unchanged — no casts.
    instances: [...instances.values()]
      .filter(({ instanceId }) => renderedInstanceIds.has(instanceId))
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
