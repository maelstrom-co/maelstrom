import type { Result } from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';
import type {
  ChartRequest,
  GridResponse,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol-old';

import type {
  LayoutValidationError,
  LayoutValidationFailure,
} from '../../errors.js';
import { layoutValidationError } from '../../errors.js';
import { checkRationale, findDuplicateInstanceIds } from './common.js';

export function validateGridLayout(
  response: GridResponse,
  request: ChartRequest,
): Result<void, LayoutValidationError> {
  const failures: LayoutValidationFailure[] = [];

  checkRationale(response.rationale, failures);

  const instanceById = new Map<string, VesselInstanceSnapshot>();
  for (const instance of request.instances) {
    instanceById.set(instance.instanceId, instance);
  }
  const vesselById = new Map<string, Vessel>();
  for (const vessel of request.vessels) {
    vesselById.set(vessel.id, vessel);
  }

  const positionIds = response.layout.positions.map((p) => p.instanceId);
  for (const dup of findDuplicateInstanceIds(positionIds)) {
    failures.push({ kind: 'duplicate_instance_id', instanceId: dup });
  }

  const { columns: chartColumns, rows: chartRows } =
    request.context.chartDimensions;

  for (const pos of response.layout.positions) {
    const { instanceId } = pos;
    const { row, column } = pos.position;
    const { width, height } = pos.size;

    if (column + width > chartColumns || row + height > chartRows) {
      failures.push({
        kind: 'position_overflow',
        instanceId,
        row,
        column,
        width,
        height,
        chartColumns,
        chartRows,
      });
    }

    const instance = instanceById.get(instanceId);
    if (!instance) {
      failures.push({ kind: 'unknown_instance', instanceId });
      continue;
    }

    const vessel = vesselById.get(instance.vesselId);
    if (!vessel) {
      failures.push({
        kind: 'unknown_vessel',
        instanceId,
        vesselId: instance.vesselId,
      });
      continue;
    }

    const variant = vessel.variants[instance.variant];
    if (!variant) {
      failures.push({
        kind: 'unknown_variant',
        instanceId,
        variant: instance.variant,
      });
      continue;
    }

    const { width: minWidth, height: minHeight } = variant.minSize;
    if (width < minWidth || height < minHeight) {
      failures.push({
        kind: 'size_below_minimum',
        instanceId,
        width,
        height,
        minWidth,
        minHeight,
      });
    }
  }

  return failures.length === 0 ? ok(undefined) : err(layoutValidationError(failures));
}
