import {
  ActionName,
  type ChartRequest,
  type ChartSize,
  InstanceId,
  type Vessel,
} from '@maelstrom-co/protocol';

import type { JevActionPlan, SelectionDecision } from '../types.js';
import { keepAll } from './actions-fixtures.js';

/** An action plan over `request` that keeps its instances and runs `actions` (as `instanceId/action`). */
export function actionPlan(
  request: ChartRequest,
  actions: readonly string[] = [],
  decisions: Readonly<Record<string, SelectionDecision>> = {},
): JevActionPlan {
  return {
    selection: keepAll(request, [], decisions),
    actions: actions.map((entry) => {
      const [instanceId, action] = entry.split('/');
      return {
        instanceId: InstanceId(instanceId),
        action: ActionName(action),
        params: {},
        pending: [],
      };
    }),
    asks: [],
    answers: [],
  };
}

/** A copy of `catalog` with every variant's `minSize` replaced by `size(vesselId, variant)`. */
export function withMinSizes(
  catalog: readonly Vessel[],
  size: (vesselId: string, variant: string, current: ChartSize) => ChartSize,
): readonly Vessel[] {
  return catalog.map((vessel) => ({
    ...vessel,
    variants: Object.fromEntries(
      Object.entries(vessel.variants).map(([name, variant]) => [
        name,
        { ...variant, minSize: size(vessel.id, name, variant.minSize) },
      ]),
    ),
  }));
}
