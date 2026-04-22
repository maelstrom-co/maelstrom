import {
  InstanceId,
  type ChartDimensions,
  type ChartRequest,
  type GridLayout,
  type LayoutMode,
  type MessageId,
  type SessionId,
  type TilingLayout,
  type UpdateReason,
  type Vessel,
} from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

/**
 * Builds a ChartRequest from the current state and pending updates.
 *
 * This is a pure function — no side effects, no I/O. All data
 * transformation for the engine request lives here.
 */
export function buildChartRequest(params: {
  requestId: MessageId;
  updates: UpdateReason[];
  instances: Map<string, VesselInstance>;
  chartDimensions: ChartDimensions;
  layout: GridLayout | TilingLayout | null;
  vessels: Vessel[];
  config: { sessionId: SessionId; layoutMode: LayoutMode };
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
    instanceId: InstanceId(i.instanceId),
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
