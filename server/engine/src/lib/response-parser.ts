import type {
  MaelstromResponse,
  ActionExecution,
  LayoutDirective,
  ChartRequest,
  VesselInstanceState,
  Vessel,
  VesselAction,
} from '@maelstrom/protocol';
import { EngineError } from './types.js';

interface RawResponse {
  rationale?: string;
  executionPlan?: unknown[];
  layoutDirective?: unknown[];
}

/**
 * Parses the LLM response into a structured MaelstromResponse.
 */
export function parseResponse(
  llmResponse: string,
  request: ChartRequest
): MaelstromResponse {
  // Extract JSON from response (may be wrapped in markdown code blocks)
  const json = extractJson(llmResponse);

  // Parse JSON
  let parsed: RawResponse;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new EngineError(
      'PARSE_ERROR',
      'Failed to parse LLM response as JSON',
      { response: llmResponse }
    );
  }

  // Validate and build response
  const response: MaelstromResponse = {
    type: 'maelstrom_response',
    requestId: request.id,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    executionPlan: validateExecutionPlan(parsed.executionPlan, request),
    layoutDirective: validateLayoutDirective(parsed.layoutDirective, request),
  };

  return response;
}

/**
 * Extracts JSON from LLM response, handling markdown code blocks.
 */
function extractJson(response: string): string {
  // Try to find JSON in code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  throw new EngineError('PARSE_ERROR', 'No JSON found in LLM response', {
    response,
  });
}

/**
 * Validates and filters the execution plan.
 */
function validateExecutionPlan(
  plan: unknown[] | undefined,
  request: ChartRequest
): ActionExecution[] {
  if (!Array.isArray(plan)) {
    return [];
  }

  const valid: ActionExecution[] = [];

  for (const item of plan) {
    if (!isObject(item)) continue;
    if (typeof item.instanceId !== 'string') continue;
    if (typeof item.action !== 'string') continue;

    // Verify instance exists
    const instance = request.instances.find(
      (i: VesselInstanceState) => i.instanceId === item.instanceId
    );
    if (!instance) {
      console.warn(
        `Skipping action: instance "${item.instanceId}" not found`
      );
      continue;
    }

    // Verify action exists for current variant
    const vessel = request.vessels.find((v: Vessel) => v.id === instance.vesselId);
    const variant = vessel?.variants[instance.variant];
    const actionDef = variant?.actions.find((a: VesselAction) => a.name === item.action);

    if (!actionDef) {
      console.warn(
        `Skipping action: "${item.action}" not available in variant "${instance.variant}"`
      );
      continue;
    }

    valid.push({
      instanceId: item.instanceId,
      action: item.action,
      params: isObject(item.params) ? item.params : undefined,
    });
  }

  return valid;
}

/**
 * Validates and filters layout directives.
 */
function validateLayoutDirective(
  directives: unknown[] | undefined,
  request: ChartRequest
): LayoutDirective[] {
  if (!Array.isArray(directives)) {
    return [];
  }

  const { columns, rows } = request.context.chartDimensions;
  const valid: LayoutDirective[] = [];

  for (const item of directives) {
    if (!isObject(item)) continue;
    if (typeof item.instanceId !== 'string') continue;
    if (!isObject(item.position)) continue;
    if (!isObject(item.size)) continue;

    const position = item.position;
    const size = item.size;

    // Validate position
    if (typeof position.row !== 'number' || typeof position.column !== 'number') {
      continue;
    }

    // Validate size
    if (typeof size.width !== 'number' || typeof size.height !== 'number') {
      continue;
    }

    // Clamp position to valid bounds
    const clampedRow = Math.max(0, Math.min(position.row, rows - 1));
    const clampedColumn = Math.max(0, Math.min(position.column, columns - 1));

    // Ensure size is at least 1
    const clampedWidth = Math.max(1, size.width);
    const clampedHeight = Math.max(1, size.height);

    valid.push({
      instanceId: item.instanceId,
      position: { row: clampedRow, column: clampedColumn },
      size: { width: clampedWidth, height: clampedHeight },
    });
  }

  return valid;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
