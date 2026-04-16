import type {
  ActionExecution,
  GridLayout,
  GridPosition,
  MaelstromResponse,
  Result,
  TilingInstance,
  TilingLayout,
  TilingNode,
} from '@maelstrom-co/protocol';
import { err, InstanceId, ok } from '@maelstrom-co/protocol';
import type {
  ChartRequest,
  GridResponse,
  TilingResponse,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol-old';

import type { EngineError } from '../errors.js';
import { parseError } from '../errors.js';
import type { Logger } from '../logger.js';

export type LLMOutput = GridResponse | TilingResponse;
type RawActionExecution = GridResponse['executionPlan'][number];

export function processResponse(
  llmOutput: LLMOutput,
  request: ChartRequest,
  logger: Logger,
): Result<MaelstromResponse, EngineError> {
  if (!llmOutput.userMessage?.trim()) {
    return err(
      parseError('LLM response missing userMessage', JSON.stringify(llmOutput)),
    );
  }

  const layout = buildLayout(llmOutput.layout, request.context.layoutMode);
  const executionPlan = parseExecutionPlan(
    llmOutput.executionPlan,
    request.instances,
    request.vessels,
    logger,
  );

  return ok({
    type: 'maelstrom_response',
    requestId: request.id,
    userMessage: llmOutput.userMessage,
    rationale: llmOutput.rationale,
    executionPlan,
    layout,
  });
}

// ---------------------------------------------------------------------------
// Layout construction
// ---------------------------------------------------------------------------

// The LLM output schemas (GridResponseSchema, TilingResponseSchema) intentionally
// omit the `type` discriminant — the LLM should not have to emit it. We add it
// back here based on the layout mode, which is guaranteed to match the schema
// used for the chat() call (both selected by request.context.layoutMode).
function buildLayout(
  llmLayout: LLMOutput['layout'],
  mode: 'grid' | 'tiling',
): GridLayout | TilingLayout {
  switch (mode) {
    case 'grid': {
      const gl = llmLayout as {
        positions: ReadonlyArray<
          Omit<GridPosition, 'instanceId'> & { instanceId: string }
        >;
      };
      const positions: readonly GridPosition[] = gl.positions.map((p) => ({
        ...p,
        instanceId: InstanceId(p.instanceId),
      }));
      return { type: 'grid', positions };
    }
    case 'tiling': {
      const tl = llmLayout as {
        tree: ReadonlyArray<string | null>;
        instances: ReadonlyArray<
          Omit<TilingInstance, 'instanceId'> & { instanceId: string }
        >;
      };
      const tree: readonly TilingNode[] = tl.tree.map(brandTilingNode);
      const instances: readonly TilingInstance[] = tl.instances.map((i) => ({
        ...i,
        instanceId: InstanceId(i.instanceId),
      }));
      return { type: 'tiling', tree, instances };
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unsupported layout mode: ${_exhaustive}`);
    }
  }
}

function brandTilingNode(node: string | null): TilingNode {
  if (node === null || node === 'H' || node === 'V') return node;
  return InstanceId(node);
}

// ---------------------------------------------------------------------------
// Execution plan parsing (paramsJson → params)
// ---------------------------------------------------------------------------

function parseParams(
  paramsJson: string,
  action: string,
  instanceId: string,
  logger: Logger,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    logger.error(
      `Failed to parse paramsJson for action "${action}" on "${instanceId}", skipping action`,
      { paramsJson },
    );
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.error(
      `paramsJson for action "${action}" on "${instanceId}" is not a JSON object, skipping action`,
      { paramsJson },
    );
    return undefined;
  }

  return parsed as Record<string, unknown>;
}

function parseExecutionPlan(
  plan: readonly RawActionExecution[],
  instances: readonly VesselInstanceSnapshot[],
  vessels: readonly Vessel[],
  logger: Logger,
): ActionExecution[] {
  const instanceMap = new Map(instances.map((i) => [i.instanceId, i]));
  const vesselMap = new Map(vessels.map((v) => [v.id, v]));

  return plan.flatMap((item) => {
    // Validate: does the instanceId exist in the request?
    const instance = instanceMap.get(item.instanceId);
    if (!instance) {
      logger.warn(
        `Execution plan references unknown instanceId "${item.instanceId}", skipping action "${item.action}"`,
      );
      return [];
    }

    // Validate: is the action valid for the instance's current variant?
    const vessel = vesselMap.get(instance.vesselId);
    if (!vessel) {
      logger.warn(
        `Action "${item.action}" on "${item.instanceId}" references vessel "${instance.vesselId}" which has no definition — skipping validation`,
      );
    } else {
      const variant = vessel.variants[instance.variant];
      if (variant) {
        const validActions = variant.actions.map((a) => a.name);
        if (!validActions.includes(item.action)) {
          logger.warn(
            `Action "${item.action}" is not valid for vessel "${instance.vesselId}" in variant "${instance.variant}" (valid: ${validActions.join(', ') || 'none'}), skipping`,
          );
          return [];
        }
      }
    }

    const brandedInstanceId = InstanceId(item.instanceId);

    if (!item.paramsJson) {
      return [{ instanceId: brandedInstanceId, action: item.action }];
    }

    const params = parseParams(
      item.paramsJson,
      item.action,
      item.instanceId,
      logger,
    );

    // paramsJson was provided but couldn't be parsed — skip the action entirely.
    // An action that was supposed to have params executing without them is worse
    // than skipping it.
    if (params === undefined) return [];

    return [
      { instanceId: brandedInstanceId, action: item.action, params },
    ];
  });
}
