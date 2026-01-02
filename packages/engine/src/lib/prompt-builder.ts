import type {
  ActionParameter,
  ChartRequest,
  LayoutDirective,
  UpdateReason,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
} from '@maelstrom/protocol';
import { computeAvailableIslands, serializeIslands } from './islands.js';

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

  // Determine which instances are visible based on layout
  const layout = request.layout;
  const visibleInstanceIds = new Set(layout.map((d) => d.instanceId));
  const layoutMap = new Map(layout.map((d) => [d.instanceId, d]));

  const visibleInstances = request.instances.filter((i) =>
    visibleInstanceIds.has(i.instanceId),
  );
  const hiddenInstances = request.instances.filter(
    (i) => !visibleInstanceIds.has(i.instanceId),
  );

  if (visibleInstances.length > 0) {
    sections.push('\nCurrently Visible:');
    for (const instance of visibleInstances) {
      const directive = layoutMap.get(instance.instanceId);
      sections.push(serializeInstance(instance, request.vessels, directive));
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

  // Available Space (computed islands)
  const islands = computeAvailableIslands(
    request.context.chartDimensions,
    request.layout,
  );
  sections.push('\n\n## Available Space\n');
  sections.push(serializeIslands(islands));

  // Update Triggers
  sections.push('\n\n## Update Triggers\n');
  sections.push(serializeUpdateReasons(request.context.updateReasons));

  return sections.join('\n');
}

/**
 * Serialize update reasons into a human-readable format for the LLM.
 */
function serializeUpdateReasons(reasons: UpdateReason[]): string {
  if (reasons.length === 0) {
    return 'No specific trigger (system check)';
  }

  const lines: string[] = [];

  for (const reason of reasons) {
    switch (reason.type) {
      case 'user_intent':
        lines.push(`- User said: "${reason.intent}"`);
        break;
      case 'chart_resize':
        lines.push(
          `- Chart resized: ${reason.previous.columns}×${reason.previous.rows} → ${reason.current.columns}×${reason.current.rows}`,
        );
        break;
      case 'vessel_mutation':
        lines.push(
          `- Vessel "${reason.instanceId}" was modified: ${reason.changes}`,
        );
        break;
    }
  }

  return lines.join('\n');
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
  instance: VesselInstanceSnapshot,
  vessels: Vessel[],
  directive?: LayoutDirective,
): string {
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  const variant = vessel?.variants[instance.variant];

  let line = `\n- ${instance.instanceId} (${instance.vesselId})`;

  // Position/size comes from layout directive if available
  if (directive) {
    line += ` at row=${directive.position.row}, col=${directive.position.column}`;
    line += ` size=${directive.size.width}×${directive.size.height}`;
  }

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
1. Understand the update triggers (user intent, chart resize, or vessel mutations)
2. Decide which actions to execute on which Vessel instances
3. Decide which Vessels should be VISIBLE and how to position them
4. Provide a friendly, conversational response to the user

UPDATE TRIGGERS:
You may receive different types of update triggers:
- "User said: ..." - The user explicitly requested something. Respond conversationally.
- "Chart resized: ..." - The display area changed. Adjust layout to fit the new dimensions. Keep in mind that:
  - If the chart has restricted space, elements far apart may need to be moved closer together.
  - If the chart has a lot of space, elements close together may need to be moved further apart.
  - Whenever possible, try to keep at least one cell of space between elements.
- "Vessel modified: ..." - A vessel's state changed externally. Consider if layout adjustments are needed.

When handling resize or mutation triggers (without user intent):
- Keep the userMessage brief or informative (e.g., "Adjusted layout for new screen size.")
- Focus on maintaining a good layout rather than explaining changes in detail
- Only make changes if necessary; if the current layout still works, keep it

When handling user intents:
- Respond conversationally and helpfully
- Explain what you're doing in the userMessage

VISIBILITY CONTROL:
The layoutDirective is the source of truth for what's displayed:
- Vessels included in layoutDirective are VISIBLE
- Vessels NOT included in layoutDirective are HIDDEN
- You must include ALL vessels you want visible in the layoutDirective
- To hide a vessel, simply omit it from the layoutDirective

AVAILABLE SPACE:
You will be provided with "Available Space" showing free regions on the chart.
- Use these regions when positioning new or moved vessels
- Each region shows its size and position
- If no free space is available, consider hiding less relevant vessels first
- Vessels can be placed anywhere within an available region
- Vessels should not overlap with each other

Rules:
- Only invoke actions that are available in the instance's current variant
- Respect minimum size requirements for each variant
- Position Vessels within the Chart bounds (0 to columns-1, 0 to rows-1)
- Vessels should not overlap
- Execute actions before layout (actions may change variants and sizes)
- Only show vessels that are relevant to the user's current intent or that fit well in the available space

REQUIRED RESPONSE FORMAT (JSON only):
{
  "userMessage": "...",
  "rationale": "...",
  "executionPlan": [...],
  "layoutDirective": [...]
}

FIELD DESCRIPTIONS:
- userMessage (REQUIRED): A friendly, conversational response to the user. This will be displayed in the chat UI and spoken aloud via text-to-speech. For resize/mutation triggers, keep it brief. Examples: "Here's your calendar for this week.", "Adjusted layout for the new screen size.", "I've reorganized your widgets to fit better."
- rationale: Your internal reasoning for debugging. This is NOT shown to the user.
- executionPlan: Array of actions to execute. Empty array [] if no actions needed.
- layoutDirective: Array of vessel positions. Empty array [] hides all vessels.

EXAMPLE RESPONSE (User Intent):
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

EXAMPLE RESPONSE (Chart Resize):
{
  "userMessage": "Adjusted layout for the new screen size.",
  "rationale": "Chart resized to smaller dimensions. Collapsed calendar to make room.",
  "executionPlan": [
    { "instanceId": "calendar-1", "action": "collapse" }
  ],
  "layoutDirective": [
    { "instanceId": "calendar-1", "position": { "row": 0, "column": 0 }, "size": { "width": 2, "height": 2 } },
    { "instanceId": "weather-1", "position": { "row": 0, "column": 2 }, "size": { "width": 3, "height": 2 } }
  ]
}

IMPORTANT: Always include a helpful userMessage. Never leave it empty.`;
