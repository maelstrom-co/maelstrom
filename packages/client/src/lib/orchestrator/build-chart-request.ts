import type {
  ChartDimensions,
  ChartRequest,
  GridLayout,
  LayoutMode,
  TilingLayout,
  UpdateReason,
  Vessel,
} from '@maelstrom/protocol';

import type { VesselInstance } from '../types.js';

/**
 * Builds a ChartRequest from the current state and pending updates.
 *
 * This is a pure function — no side effects, no I/O. All data
 * transformation for the engine request lives here.
 */
export function buildChartRequest(params: {
  requestId: string;
  updates: UpdateReason[];
  instances: Map<string, VesselInstance>;
  chartDimensions: ChartDimensions;
  layout: GridLayout | TilingLayout | null;
  vessels: Vessel[];
  config: { sessionId: string; layoutMode: LayoutMode };
}): ChartRequest {
  const {
    requestId,
    updates,
    instances,
    chartDimensions,
    layout,
    vessels,
    config,
  } = params;

  const instanceSnapshots = Array.from(instances.values()).map((i) => ({
    instanceId: i.instanceId,
    vesselId: i.vesselId,
    variant: i.variant,
  }));

  return {
    type: 'chart_request',
    id: requestId,
    context: {
      updateReasons: updates,
      chartDimensions,
      timestamp: Date.now(),
      sessionId: config.sessionId,
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
