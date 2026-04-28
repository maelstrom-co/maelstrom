import {
  InstanceId,
  type ChartDimensions,
  type ChartRequest,
  // Referenced via `{@link}` in the JSDoc below — type-only import keeps IDE
  // hover/jump-to-definition uniform across resolvers.
  type ChartRequestMessage,
  type GridLayout,
  type LayoutMode,
  type TilingLayout,
  type UpdateReason,
  type Vessel,
} from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

/**
 * Builds the inner {@link ChartRequest} payload from the current state and
 * pending updates. The caller wraps this in a {@link ChartRequestMessage}
 * envelope to supply session + message identity + timestamp.
 *
 * This is a pure function — no side effects, no I/O.
 */
export function buildChartRequest(params: {
  updates: UpdateReason[];
  instances: Map<string, VesselInstance>;
  chartDimensions: ChartDimensions;
  layout: GridLayout | TilingLayout | null;
  vessels: Vessel[];
  config: { layoutMode: LayoutMode };
}): ChartRequest {
  const { updates, instances, chartDimensions, layout, vessels, config } =
    params;

  const instanceSnapshots = Array.from(instances.values()).map((i) => ({
    instanceId: InstanceId(i.instanceId),
    vesselId: i.vesselId,
    variant: i.variant,
  }));

  return {
    type: 'chart_request',
    context: {
      updateReasons: updates,
      chartDimensions,
      layoutMode: config.layoutMode,
    },
    instances: instanceSnapshots,
    vessels,
    layout:
      layout ??
      (config.layoutMode === 'tiling'
        ? { type: 'tiling', tree: [], instances: [] }
        : { type: 'grid', positions: [] }),
  };
}
