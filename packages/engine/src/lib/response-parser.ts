import type {
  ActionExecution,
  ChartRequest,
  GridLayout,
  MaelstromResponse,
  TilingLayout,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

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
    executionPlan: validateExecutionPlan(llmResponse.executionPlan, request),
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

function validateExecutionPlan<V extends Vessel = Vessel>(
  plan: LLMResponse['executionPlan'],
  request: ChartRequest,
): ActionExecution<V, string>[] {
  const valid: ActionExecution<V, string>[] = [];

  for (const item of plan) {
    const instance = request.instances.find(
      (i: VesselInstanceSnapshot) => i.instanceId === item.instanceId,
    );
    if (!instance) {
      console.warn(`Skipping action: instance "${item.instanceId}" not found`);
      continue;
    }

    const vessel = request.vessels.find((v) => v.id === instance.vesselId);
    const variant = vessel?.variants[instance.variant];
    const actionDef = variant?.actions.find(
      (a: VesselAction) => a.name === item.action,
    );

    if (!actionDef) {
      console.warn(
        `Skipping action: "${item.action}" not available in variant "${instance.variant}"`,
      );
      continue;
    }

    const parsedAction: ActionExecution<V, string> = {
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
  }

  return valid;
}
