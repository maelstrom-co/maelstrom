import type {
  ActionExecution,
  ChartRequest,
  GridLayout,
  MaelstromResponse,
  TilingLayout,
  VesselAction,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol-old';

import type { LLMResponse } from './types.js';

export function buildResponse(
  llmResponse: LLMResponse,
  request: ChartRequest,
): MaelstromResponse {
  const layout = buildLayout(llmResponse.layout, request.context.layoutMode);

  return {
    type: 'maelstrom_response',
    requestId: request.id,
    userMessage: llmResponse.userMessage,
    rationale: llmResponse.rationale,
    executionPlan: validateExecutionPlan(
      llmResponse.executionPlan,
      request,
      layout,
    ),
    layout,
  };
}

function buildLayout(
  llmLayout: LLMResponse['layout'],
  layoutMode: 'grid' | 'tiling',
): GridLayout | TilingLayout {
  if (layoutMode === 'grid') {
    return {
      type: 'grid',
      positions: (llmLayout as { positions: GridLayout['positions'] })
        .positions,
    };
  }

  const tilingLayout = llmLayout as {
    tree: TilingLayout['tree'];
    instances: TilingLayout['instances'];
  };
  return {
    type: 'tiling',
    tree: tilingLayout.tree,
    instances: tilingLayout.instances,
  };
}

function validateExecutionPlan(
  plan: LLMResponse['executionPlan'],
  request: ChartRequest,
  layout: GridLayout | TilingLayout,
): ActionExecution[] {
  const valid: ActionExecution[] = [];
  const knownInstances = new Map(
    request.instances.map((instance) => [instance.instanceId, instance]),
  );

  if (layout.type === 'tiling') {
    for (const instance of layout.instances) {
      if (knownInstances.has(instance.instanceId)) continue;

      knownInstances.set(instance.instanceId, {
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
        variant: instance.variant,
      });
    }
  }

  // Validate against a simulated per-instance variant state so a single plan can
  // include deterministic follow-up actions that only become legal after an
  // earlier transition in the same executionPlan.
  const simulatedVariants = new Map(
    Array.from(knownInstances.values(), (instance) => [
      instance.instanceId,
      instance.variant,
    ]),
  );

  for (const item of plan) {
    const instance = knownInstances.get(item.instanceId) as
      | VesselInstanceSnapshot
      | {
          instanceId: string;
          vesselId: string;
          variant: string;
        }
      | undefined;
    if (!instance) {
      console.warn(`Skipping action: instance "${item.instanceId}" not found`);
      continue;
    }

    const vessel = request.vessels.find((v) => v.id === instance.vesselId);
    const currentVariant =
      simulatedVariants.get(item.instanceId) ?? instance.variant;
    const variant = vessel?.variants[currentVariant];
    const actionDef = variant?.actions.find(
      (a: VesselAction) => a.name === item.action,
    );

    if (!actionDef) {
      console.warn(
        `Skipping action: "${item.action}" not available in variant "${currentVariant}"`,
      );
      continue;
    }

    const parsedAction: ActionExecution = {
      instanceId: item.instanceId,
      action: item.action,
    };
    if (item.paramsJson) {
      try {
        parsedAction.params = JSON.parse(item.paramsJson);
      } catch {
        console.warn(
          `Failed to parse paramsJson for action "${item.action}": ${item.paramsJson}`,
        );
      }
    }
    valid.push(parsedAction);

    if (actionDef.transitionsTo) {
      // Carry the transition forward so later actions for this instance are
      // checked against the state the client will reach after executing prior steps.
      simulatedVariants.set(item.instanceId, actionDef.transitionsTo);
    }
  }

  return valid;
}
