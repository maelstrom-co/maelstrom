import type {
  GridLayout,
  InstanceId,
  TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

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
  existingInstances?: Map<InstanceId, VesselInstance>,
): Map<InstanceId, VesselInstance> {
  return layout.type === 'tiling'
    ? applyTilingLayout(layout)
    : applyGridLayout(layout, existingInstances);
}

function applyTilingLayout(
  layout: TilingLayout,
): Map<InstanceId, VesselInstance> {
  return new Map(
    layout.instances.map((snapshot) => [
      snapshot.instanceId,
      {
        instanceId: snapshot.instanceId,
        // The TilingInstance interface declares vesselId/variant as plain
        // strings, but at runtime they're already branded by the schema's
        // .transform() step (see TilingLayoutSchema). Brand at the seam to
        // keep the runtime store typed without a protocol-wide interface
        // change that would ripple into out-of-tree consumers.
        vesselId: snapshot.vesselId as VesselId,
        variant: snapshot.variant as VariantName,
        position: { column: 0, row: 0 },
        size: { width: 1, height: 1 },
      },
    ]),
  );
}

function applyGridLayout(
  layout: GridLayout,
  existingInstances?: Map<InstanceId, VesselInstance>,
): Map<InstanceId, VesselInstance> {
  return new Map(
    layout.positions.flatMap((position): [InstanceId, VesselInstance][] => {
      const existing = existingInstances?.get(position.instanceId);
      if (!existing) {
        // State drift: the engine emitted a GridPosition for an instance
        // not in our store. GridPosition carries no vesselId/variant, so
        // we cannot construct a VesselInstance — skip rather than fabricate
        // identities. Surface via console.warn so the drop is observable;
        // a structured logger is not yet plumbed through this pure helper.
        console.warn(
          `[Maelstrom] applyGridLayout: dropping position for unknown instance "${position.instanceId}" (no matching entry in existingInstances)`,
        );
        return [];
      }
      return [
        [
          position.instanceId,
          {
            ...existing,
            position: {
              column: position.position.column,
              row: position.position.row,
            },
            size: {
              width: position.size.width,
              height: position.size.height,
            },
          },
        ],
      ];
    }),
  );
}
