import type {
  ActionParameter,
  ChartRequest,
  Vessel,
  VesselAction,
  VesselInstanceState,
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
    `Dimensions: ${request.context.chartDimensions.columns} columns × ${request.context.chartDimensions.rows} rows\n`,
  );

  // Determine which instances are visible based on currentLayout
  const currentLayout = request.currentLayout ?? [];
  const visibleInstanceIds = new Set(currentLayout.map((d) => d.instanceId));

  const visibleInstances = request.instances.filter((i) =>
    visibleInstanceIds.has(i.instanceId),
  );
  const hiddenInstances = request.instances.filter(
    (i) => !visibleInstanceIds.has(i.instanceId),
  );

  if (visibleInstances.length > 0) {
    sections.push('\nCurrently Visible:');
    for (const instance of visibleInstances) {
      sections.push(serializeInstance(instance, request.vessels));
    }
  } else {
    sections.push('\nNo vessels currently visible.');
  }

  if (hiddenInstances.length > 0) {
    sections.push('\n\nAvailable (hidden):');
    for (const instance of hiddenInstances) {
      sections.push(serializeInstance(instance, request.vessels));
    }
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
      `- ${variantName}${defaultMarker}: ${variant.minSize.width}×${variant.minSize.height} min`,
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
  vessels: Vessel[],
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
3. Decide which Vessels should be VISIBLE and how to position them
4. Provide a friendly, conversational response to the user

VISIBILITY CONTROL:
The layoutDirective is the source of truth for what's displayed:
- Vessels included in layoutDirective are VISIBLE
- Vessels NOT included in layoutDirective are HIDDEN
- You must include ALL vessels you want visible in the layoutDirective
- To hide a vessel, simply omit it from the layoutDirective

Rules:
- Only invoke actions that are available in the instance's current variant
- Respect minimum size requirements for each variant
- Position Vessels within the Chart bounds (0 to columns-1, 0 to rows-1)
- Vessels should not overlap
- Execute actions before layout (actions may change variants and sizes)
- Only show vessels that are relevant to the user's current intent

REQUIRED RESPONSE FORMAT (JSON only):
{
  "userMessage": "...",
  "rationale": "...",
  "executionPlan": [...],
  "layoutDirective": [...]
}

FIELD DESCRIPTIONS:
- userMessage (REQUIRED): A friendly, conversational response to the user. This will be displayed in the chat UI and spoken aloud via text-to-speech. Examples: "Here's your calendar for this week.", "I've opened the weather widget for you.", "Sure, let me show you that."
- rationale: Your internal reasoning for debugging. This is NOT shown to the user.
- executionPlan: Array of actions to execute. Empty array [] if no actions needed.
- layoutDirective: Array of vessel positions. Empty array [] hides all vessels.

EXAMPLE RESPONSE:
{
  "userMessage": "Here's the weather for your location.",
  "rationale": "User asked for weather. Showing weather vessel at top-right.",
  "executionPlan": [
    { "instanceId": "weather-1", "action": "refresh", "params": {} }
  ],
  "layoutDirective": [
    { "instanceId": "weather-1", "position": { "row": 0, "column": 8 }, "size": { "width": 4, "height": 3 } }
  ]
}

IMPORTANT: Always include a helpful userMessage. Never leave it empty.`;
