import type {
  ChartRequest,
  GridResponse,
  InstanceId,
  Vessel,
  VesselId,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import {
  pushMissingRationaleWarningIfEmpty,
  seenInstancesTracker,
} from './heal-common.js';
import type {
  DroppedLayoutEntry,
  HealedGridLayout,
  LayoutWarning,
} from './healed-layout.js';

/**
 * Recovery rules:
 * - Duplicate instanceId → keep the first occurrence; subsequent duplicates
 *   become `duplicate_instance_id` drops without further validation.
 * - One position can produce multiple drops if it has multiple issues
 *   (e.g. overflow AND unknown_vessel) — the position is dropped once,
 *   each detected issue is recorded as its own drop entry.
 * - missing rationale → warning, response accepted as-is.
 */
export function healGridLayout(
  response: GridResponse,
  request: ChartRequest,
): HealedGridLayout {
  const droppedEntries: DroppedLayoutEntry[] = [];
  const warnings: LayoutWarning[] = [];

  pushMissingRationaleWarningIfEmpty(response, warnings);

  const instanceById = new Map<InstanceId, VesselInstanceSnapshot>();
  for (const instance of request.instances) {
    instanceById.set(instance.instanceId, instance);
  }
  const vesselById = new Map<VesselId, Vessel>();
  for (const vessel of request.vessels) {
    vesselById.set(vessel.id, vessel);
  }

  const { columns: chartColumns, rows: chartRows } =
    request.context.chartDimensions;

  const tracker = seenInstancesTracker(droppedEntries);
  const kept: GridResponse['layout']['positions'] = [];

  for (const pos of response.layout.positions) {
    const instanceId = pos.instanceId;

    if (tracker.isDuplicate(instanceId)) continue;

    const { row, column } = pos.position;
    const { width, height } = pos.size;
    let dropped = false;

    if (column + width > chartColumns || row + height > chartRows) {
      droppedEntries.push({
        reason: 'position_overflow',
        instanceId,
        row,
        column,
        width,
        height,
        chartColumns,
        chartRows,
      });
      dropped = true;
    }

    const instance = instanceById.get(instanceId);
    if (!instance) {
      droppedEntries.push({ reason: 'unknown_instance', instanceId });
      dropped = true;
    } else {
      const vessel = vesselById.get(instance.vesselId);
      if (!vessel) {
        droppedEntries.push({
          reason: 'unknown_vessel',
          instanceId,
          vesselId: instance.vesselId,
        });
        dropped = true;
      } else {
        const variant = vessel.variants[instance.variant];
        if (!variant) {
          droppedEntries.push({
            reason: 'unknown_variant',
            instanceId,
            variant: instance.variant,
          });
          dropped = true;
        } else {
          const { width: minWidth, height: minHeight } = variant.minSize;
          if (width < minWidth || height < minHeight) {
            droppedEntries.push({
              reason: 'size_below_minimum',
              instanceId,
              width,
              height,
              minWidth,
              minHeight,
            });
            dropped = true;
          }
        }
      }
    }

    if (!dropped) {
      kept.push(pos);
      tracker.markSeen(instanceId);
    }
  }

  return {
    mode: 'grid',
    layout: { positions: kept },
    droppedEntries,
    warnings,
  };
}
