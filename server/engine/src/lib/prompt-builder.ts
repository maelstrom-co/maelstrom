import type {
  ChartRequest,
  Vessel,
  VesselAction,
  VesselInstanceState,
  ActionParameter,
} from '@maelstrom/protocol';

/**
 * Builds the LLM prompt from a ChartRequest.
 */
export function buildPrompt(request: ChartRequest): string {
  const sections: string[] = [];

  // Registered Vessels
  sections.push('## Registered Vessels\n');
  for (const vessel of request.vessels) {
    sections.push(serializeVessel(vessel));
  }

  // Current Chart State
  sections.push('\n## Current Chart State\n');
  sections.push(
    `Dimensions: ${request.context.chartDimensions.columns} columns × ${request.context.chartDimensions.rows} rows\n`
  );

  if (request.instances.length > 0) {
    sections.push('\nInstances:');
    for (const instance of request.instances) {
      sections.push(serializeInstance(instance, request.vessels));
    }
  } else {
    sections.push('\nNo vessels currently visible.');
  }

  // User Intent
  sections.push('\n\n## User Intent\n');
  sections.push(`"${request.context.userIntent}"`);

  return sections.join('\n');
}

function serializeVessel(vessel: Vessel): string {
  const lines: string[] = [];
  lines.push(`### ${vessel.id} - ${vessel.name}`);
  lines.push(vessel.description);
  lines.push('');
  lines.push('Variants:');

  for (const [variantName, variant] of Object.entries(vessel.variants)) {
    const isDefault = variantName === vessel.defaultVariant;
    const defaultMarker = isDefault ? ' (default)' : '';
    lines.push(
      `- ${variantName}${defaultMarker}: ${variant.minSize.width}×${variant.minSize.height} min`
    );

    if (variant.actions.length > 0) {
      const actionStrs = variant.actions.map(serializeAction);
      lines.push(`  Actions: ${actionStrs.join(', ')}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function serializeAction(action: VesselAction): string {
  let str = action.name;

  if (action.parameters && action.parameters.length > 0) {
    const params = action.parameters
      .map((p: ActionParameter) => {
        if (p.enum) {
          return `${p.name}: ${p.enum.join('|')}`;
        }
        return `${p.name}: ${p.type}`;
      })
      .join(', ');
    str += `(${params})`;
  }

  if (action.transitionsTo) {
    str += ` → ${action.transitionsTo}`;
  }

  return str;
}

function serializeInstance(
  instance: VesselInstanceState,
  vessels: Vessel[]
): string {
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  const variant = vessel?.variants[instance.variant];

  let line = `\n- ${instance.instanceId} (${instance.vesselId})`;
  line += ` at row=${instance.position.row}, col=${instance.position.column}`;
  line += ` size=${instance.size.width}×${instance.size.height}`;
  line += `, variant: ${instance.variant}`;

  if (variant && variant.actions.length > 0) {
    const actionStrs = variant.actions.map(serializeAction);
    line += `\n  Available: ${actionStrs.join(', ')}`;
  }

  return line;
}

/**
 * Default system prompt for Maelstrom.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Maelstrom, an AI that orchestrates UI components called Vessels.

Your job is to:
1. Understand the user's intent
2. Decide which actions to execute on which Vessel instances
3. Decide how to position and size Vessels on the Chart

Rules:
- Only invoke actions that are available in the instance's current variant
- Respect minimum size requirements for each variant
- Position Vessels within the Chart bounds (0 to columns-1, 0 to rows-1)
- Vessels should not overlap
- Execute actions before layout (actions may change variants and sizes)

Respond with JSON only, in this exact format:
{
  "rationale": "Brief explanation of your decision",
  "executionPlan": [
    { "instanceId": "...", "action": "...", "params": { ... } }
  ],
  "layoutDirective": [
    { "instanceId": "...", "position": { "row": 0, "column": 0 }, "size": { "width": 4, "height": 4 } }
  ]
}

If no changes are needed, return empty arrays for executionPlan and layoutDirective.`;
