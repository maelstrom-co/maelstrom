import {
  type ChartDimensions,
  type ChartRequest,
  // Referenced via `{@link}` in the JSDoc below — type-only import keeps IDE
  // hover/jump-to-definition uniform across resolvers.
  type ChartRequestMessage,
  type GridLayout,
  InstanceId,
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
 *
 * The wire schema requires `context.layoutMode` and `layout.type` to agree
 * on every request. `layout` may be `null` (nothing stored yet) or may
 * carry a `type` left over from before a layout-mode change — including
 * one written by a response that was already in flight when the mode
 * changed and landed afterward, which a mode-change-time reset cannot
 * prevent. Either way, this synthesizes a fresh layout of `config.layoutMode`
 * rather than forwarding a value that would violate the schema and get the
 * request rejected: an empty `positions: []` for grid, or an empty
 * `tree: []` paired with every live instance in `instances` for tiling — the
 * schema requires each top-level instance to be declared in tiling's
 * `layout.instances`, so a bare `instances: []` here would itself be
 * schema-invalid whenever the board is non-empty. Declared-but-untreed
 * instances are simply hidden until the engine places them. A stored layout
 * only rides through unchanged when its `type` already matches; the
 * previously arranged board's positions are lost otherwise, since a tiling
 * tree and grid positions aren't reinterpretable as each other.
 */
export function buildChartRequest(params: {
  updates: UpdateReason[];
  instances: Map<InstanceId, VesselInstance>;
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

  const layoutMatchesMode =
    layout !== null && layout.type === config.layoutMode;

  return {
    type: 'chart_request',
    context: {
      updateReasons: updates,
      chartDimensions,
      layoutMode: config.layoutMode,
    },
    instances: instanceSnapshots,
    vessels,
    layout: layoutMatchesMode
      ? layout
      : config.layoutMode === 'tiling'
        ? { type: 'tiling', tree: [], instances: instanceSnapshots }
        : { type: 'grid', positions: [] },
  };
}
