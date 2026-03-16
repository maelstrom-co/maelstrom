import type { GridLayout, TilingLayout } from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

/**
 * Converts a server layout into a Map of VesselInstances.
 *
 * Pure function — no store dependency, no side effects.
 * The caller is responsible for writing the result to state.
 *
 * @param layout - The layout from the server response
 * @param existingInstances - Current instances map, used by grid layout
 *   to preserve vesselId and variant (which GridPosition does not carry)
 */
export function applyLayout(
  layout: TilingLayout | GridLayout,
  existingInstances?: Map<string, VesselInstance>,
): Map<string, VesselInstance> {
  return layout.type === 'tiling'
    ? applyTilingLayout(layout)
    : applyGridLayout(layout, existingInstances);
}

function applyTilingLayout(layout: TilingLayout): Map<string, VesselInstance> {
  return new Map(
    layout.instances.map((snapshot) => [
      snapshot.instanceId,
      {
        instanceId: snapshot.instanceId,
        vesselId: snapshot.vesselId,
        variant: snapshot.variant,
        position: { column: 0, row: 0 },
        size: { width: 1, height: 1 },
      },
    ]),
  );
}

function applyGridLayout(
  layout: GridLayout,
  existingInstances?: Map<string, VesselInstance>,
): Map<string, VesselInstance> {
  return new Map(
    layout.positions.map((position) => {
      const existing = existingInstances?.get(position.instanceId);
      return [
        position.instanceId,
        {
          instanceId: position.instanceId,
          vesselId: existing?.vesselId ?? '',
          variant: existing?.variant ?? 'default',
          position: {
            column: position.position.column,
            row: position.position.row,
          },
          size: {
            width: position.size.width,
            height: position.size.height,
          },
        },
      ];
    }),
  );
}
