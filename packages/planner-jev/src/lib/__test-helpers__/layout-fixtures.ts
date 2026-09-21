import {
  ActionName,
  type ChartRequest,
  type ChartSize,
  InstanceId,
  type Vessel,
} from '@maelstrom-co/protocol';

import type {
  JevActionPlan,
  JevLayoutPlan,
  ParameterAsk,
  PendingParameter,
  PlannedAction,
  SelectionDecision,
} from '../types.js';
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

/** A planned action as jevActions produces it. */
export function planned(
  target: string,
  params: Record<string, unknown> = {},
  pending: readonly PendingParameter[] = [],
): PlannedAction {
  const [instanceId, action] = target.split('/');
  return {
    instanceId: InstanceId(instanceId),
    action: ActionName(action),
    params,
    pending,
  };
}

/** A layout plan ready for llmComplete. */
export function completionPlan(
  request: ChartRequest,
  options: {
    readonly actions?: readonly PlannedAction[];
    readonly asks?: readonly ParameterAsk[];
    readonly decisions?: Readonly<Record<string, SelectionDecision>>;
    readonly tree?: readonly string[];
  } = {},
): JevLayoutPlan {
  const base = actionPlan(request, [], options.decisions);
  return {
    plan: {
      ...base,
      actions: options.actions ?? [],
      asks: options.asks ?? [],
    },
    layoutId: 'preserve',
    tree: (options.tree ??
      (request.layout.type === 'tiling'
        ? request.layout.tree
        : [])) as JevLayoutPlan['tree'],
    answers: [],
  };
}
