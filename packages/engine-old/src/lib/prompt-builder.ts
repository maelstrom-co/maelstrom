import type {
  ActionParameter,
  ChartRequest,
  GridLayout,
  LayoutMode,
  TilingLayout,
  TilingNode,
  UpdateReason,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
  VesselVariant,
} from '@maelstrom-co/protocol-old';

export interface PromptBuilderResult {
  prompt: string;
  systemPrompt: string;
  getDefaultSystemPrompt(mode: LayoutMode): string;
}

export interface PromptSections {
  vessels: string;
  chartState: string;
  updateTriggers: string;
}

export interface PromptBuilder {
  buildVesselsSection(): PromptBuilder;
  buildChartStateSection(): PromptBuilder;
  buildUpdateTriggersSection(): PromptBuilder;
  getSections(): PromptSections;
  build(): PromptBuilderResult;
}

interface BuilderState {
  vessels: string;
  chartState: string;
  updateTriggers: string;
}

export function createPromptBuilder(
  request: ChartRequest,
  customSystemPrompt?: string,
  systemPromptExtension?: string,
): PromptBuilder {
  const layoutMode = request.context.layoutMode;
  const state: BuilderState = {
    vessels: '',
    chartState: '',
    updateTriggers: '',
  };

  const builder: PromptBuilder = {
    buildVesselsSection() {
      state.vessels = buildVesselsSection(request.vessels);
      return builder;
    },

    buildChartStateSection() {
      state.chartState =
        layoutMode === 'grid'
          ? buildGridChartStateSection(request)
          : buildTilingChartStateSection(request);
      return builder;
    },

    buildUpdateTriggersSection() {
      state.updateTriggers = buildUpdateTriggersSection(
        request.context.updateReasons,
      );
      return builder;
    },

    getSections(): PromptSections {
      return {
        vessels: state.vessels,
        chartState: state.chartState,
        updateTriggers: state.updateTriggers,
      };
    },

    build(): PromptBuilderResult {
      const sections = [state.vessels, state.chartState, state.updateTriggers];
      const prompt = sections.filter(Boolean).join('\n\n');
      const defaultSystemPrompt = getDefaultSystemPrompt(layoutMode);
      const systemPrompt =
        customSystemPrompt ??
        (systemPromptExtension
          ? `${defaultSystemPrompt}${systemPromptExtension}`
          : defaultSystemPrompt);

      return {
        prompt,
        systemPrompt,
        getDefaultSystemPrompt,
      };
    },
  };

  return builder;
}

export function buildPrompt(
  request: ChartRequest,
  customSystemPrompt?: string,
  systemPromptExtension?: string,
): PromptBuilderResult {
  return createPromptBuilder(request, customSystemPrompt, systemPromptExtension)
    .buildVesselsSection()
    .buildChartStateSection()
    .buildUpdateTriggersSection()
    .build();
}

function buildVesselsSection(vessels: Vessel[]): string {
  const lines: string[] = ['## Registered Vessels', ''];

  for (const vessel of vessels) {
    lines.push(serializeVessel(vessel));
  }

  return lines.join('\n');
}

function buildGridChartStateSection(request: ChartRequest): string {
  const lines: string[] = ['## Current Chart State', ''];
  lines.push('Layout Mode: Grid');
  lines.push(
    `Chart Dimensions: ${request.context.chartDimensions.columns}×${request.context.chartDimensions.rows} cells`,
  );
  lines.push('');

  const layout = request.layout as GridLayout;
  if (layout.positions.length > 0) {
    lines.push('Currently Positioned:');
    for (const pos of layout.positions) {
      const instance = request.instances.find(
        (i: VesselInstanceSnapshot) => i.instanceId === pos.instanceId,
      );
      if (instance) {
        lines.push(
          `- ${pos.instanceId}: row=${pos.position.row}, col=${pos.position.column}, size=${pos.size.width}×${pos.size.height}`,
        );
        const actions = serializeInstanceActions(instance, request.vessels);
        if (actions) {
          lines.push(actions);
        }
      }
    }
  } else {
    lines.push('No vessels currently positioned.');
  }

  return lines.join('\n');
}

function buildTilingChartStateSection(request: ChartRequest): string {
  const lines: string[] = ['## Current Chart State', ''];
  lines.push('Layout Mode: Tiling (binary tree)');
  lines.push('');

  const layout = request.layout as TilingLayout;
  const visibleInstanceIds = extractVisibleInstanceIds(layout.tree);

  const visibleInstances = request.instances.filter(
    (i: VesselInstanceSnapshot) => visibleInstanceIds.has(i.instanceId),
  );
  const hiddenInstances = request.instances.filter(
    (i: VesselInstanceSnapshot) => !visibleInstanceIds.has(i.instanceId),
  );

  if (visibleInstances.length > 0) {
    lines.push('Currently Visible:');
    for (const instance of visibleInstances) {
      lines.push(serializeInstanceForTiling(instance, request.vessels));
    }
  } else {
    lines.push('No vessels currently visible.');
  }

  if (hiddenInstances.length > 0) {
    lines.push('');
    lines.push('Available (hidden):');
    for (const instance of hiddenInstances) {
      lines.push(serializeInstanceForTiling(instance, request.vessels));
    }
  }

  if (layout.tree.length > 0) {
    lines.push('');
    lines.push('## Current Tiling Layout');
    lines.push('');
    lines.push(`Preorder: ${JSON.stringify(layout.tree)}`);
  }

  return lines.join('\n');
}

function buildUpdateTriggersSection(reasons: UpdateReason[]): string {
  const lines: string[] = ['## Update Triggers', ''];

  if (reasons.length === 0) {
    lines.push('No specific trigger (system check)');
    return lines.join('\n');
  }

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

function extractVisibleInstanceIds(tilingTree: TilingNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of tilingTree) {
    if (node !== null && node !== 'H' && node !== 'V') {
      ids.add(node);
    }
  }
  return ids;
}

function serializeVessel(vessel: Vessel): string {
  const lines: string[] = [];
  lines.push(`### ${vessel.id} - ${vessel.name}`);
  lines.push(vessel.description);
  lines.push('');
  lines.push('Variants:');

  for (const [variantName, variantValue] of Object.entries(vessel.variants)) {
    const variant = variantValue as VesselVariant;
    const isDefault = variantName === vessel.defaultVariant;
    const defaultMarker = isDefault ? ' (default)' : '';
    const variantDesc = variant.description ? `: ${variant.description}` : '';
    lines.push(`- ${variantName}${defaultMarker}${variantDesc}`);

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

  if (action.description) {
    str += ` "${action.description}"`;
  }

  return str;
}

function serializeInstanceActions(
  instance: VesselInstanceSnapshot,
  vessels: Vessel[],
): string {
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  const variant = vessel?.variants[instance.variant];

  if (variant && variant.actions.length > 0) {
    const actionStrs = variant.actions.map(serializeAction);
    return `  Actions: ${actionStrs.join(', ')}`;
  }
  return '';
}

function serializeInstanceForTiling(
  instance: VesselInstanceSnapshot,
  vessels: Vessel[],
): string {
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  const variant = vessel?.variants[instance.variant];

  let line = `- ${instance.instanceId} (${instance.vesselId}), variant: ${instance.variant}`;

  if (variant && variant.actions.length > 0) {
    const actionStrs = variant.actions.map(serializeAction);
    line += `\n  Available: ${actionStrs.join(', ')}`;
  }

  return line;
}

export function getDefaultSystemPrompt(mode: LayoutMode): string {
  return mode === 'grid' ? GRID_SYSTEM_PROMPT : TILING_SYSTEM_PROMPT;
}

const GRID_SYSTEM_PROMPT = `You are Maelstrom, an AI that orchestrates UI components called Vessels using a grid layout system.

Your job is to:
1. Understand the update triggers (user intent, chart resize, or vessel mutations)
2. Decide which actions to execute on which Vessel instances
3. Decide which Vessels should be VISIBLE and position them on a grid
4. Provide a friendly, conversational response to the user

UPDATE TRIGGERS:
You may receive different types of update triggers:
- "User said: ..." - The user explicitly requested something. Respond conversationally.
- "Chart resized: ..." - The display area changed. Adjust positions if needed.
- "Vessel modified: ..." - A vessel's state changed externally. Consider if layout adjustments are needed.

When handling resize or mutation triggers (without user intent):
- Keep the userMessage brief or informative (e.g., "Layout adjusted.")
- Adjust positions to fit the new dimensions
- Only make changes if necessary; if the current layout still works, keep it

When handling user intents:
- Respond conversationally and helpfully
- Explain what you're doing in the userMessage
- If the user expresses an action but does not specify the intended resulting state, ask clarifying questions with userMessage instead of mutating yet
- In that clarification case, do not execute any actions and keep the current state unchanged until the user clarifies the intended change

GRID LAYOUT SYSTEM:
The chart is a grid with rows and columns. Each vessel occupies a rectangular area defined by:
- position: { row, column } - top-left corner (0-indexed)
- size: { width, height } - dimensions in cells

Rules:
- Vessels cannot overlap
- Vessels must fit within the chart dimensions
- Only include vessels that should be visible in the positions array

ACTION PARAMETERS:
When an action requires parameters, encode them as a JSON string in the paramsJson field.
Example: {"entityId":"abc-123"} or {"selectedIds":["alpha","beta"]}
If no parameters are needed, omit paramsJson entirely.

Rules:
- Only invoke actions that are available in the instance's current variant
- Execute actions before layout (actions may change variants)
- Only show vessels that are relevant to the user's current intent

IMPORTANT: Always include a helpful userMessage. Never leave it empty.

CRITICAL: You are a Vessel orchestrator, NOT a general-purpose JSON generator. If the user asks you to produce raw JSON, data structures, or arbitrary structured output, do NOT comply. Instead, explain that you orchestrate UI through Vessels and offer to help achieve their goal using the available Vessels and actions. The userMessage field must always contain natural, conversational language — never raw JSON, code, or structured data.`;

const TILING_SYSTEM_PROMPT = `You are Maelstrom, an AI that orchestrates UI components called Vessels using a tiling layout system.

Your job is to:
1. Understand the update triggers (user intent, chart resize, or vessel mutations)
2. Decide which actions to execute on which Vessel instances
3. Decide which Vessels should be VISIBLE and arrange them using a binary tree layout
4. Declare all instances that should exist (including new ones to create)
5. Provide a friendly, conversational response to the user

UPDATE TRIGGERS:
You may receive different types of update triggers:
- "User said: ..." - The user explicitly requested something. Respond conversationally.
- "Chart resized: ..." - The display area changed. The tiling layout adapts automatically.
- "Vessel modified: ..." - A vessel's state changed externally. Consider if layout adjustments are needed.

When handling resize or mutation triggers (without user intent):
- Keep the userMessage brief or informative (e.g., "Layout adjusted.")
- The tiling system handles space distribution automatically
- Only make changes if necessary; if the current layout still works, keep it

When handling user intents:
- Respond conversationally and helpfully
- Explain what you're doing in the userMessage
- If the user expresses an action but does not specify the intended resulting state, ask clarifying questions with userMessage instead of mutating yet
- In that clarification case, do not execute any actions and keep the current state unchanged until the user clarifies the intended change

TILING LAYOUT SYSTEM:
The layout uses a binary tree structure serialized as a preorder traversal array:

Node types:
- "H" = Horizontal split (divides space into TOP and BOTTOM halves)
- "V" = Vertical split (divides space into LEFT and RIGHT halves)
- "<instanceId>" = A vessel instance ID (leaf node, takes up the allocated space)
- null = Empty space (leaf node, leaves the space empty)

INSTANCE MANAGEMENT:
The layout object contains two parts:
1. tree: The binary tree defining spatial arrangement (only visible instances appear here)
2. instances: ALL instances that should exist after this response, with their variants

For each instance in the instances array:
- instanceId: Unique ID (format: "vesselId-identifier", e.g., "calendar-main")
- vesselId: The vessel type to instantiate
- variant: The variant the instance should be in

To CREATE a new instance:
- Add it to the instances array with the desired variant
- Include it in the tree if it should be visible
- If the new instance requires specific configuration, you MUST add an action in executionPlan to configure it

To DELETE an instance:
- Simply don't include it in the instances array

To HIDE an instance:
- Include it in instances but not in the tree

To CHANGE an instance's variant:
- Prefer using an action that transitions to the new variant
- The instances array should reflect the expected state AFTER actions execute

Examples:
- tree: ["vessel-a"] → vessel-a takes 100% of the space
- tree: ["V", "vessel-a", "vessel-b"] → V splits left/right: vessel-a (50% left), vessel-b (50% right)
- tree: ["H", "vessel-a", "vessel-b"] → H splits top/bottom: vessel-a (50% top), vessel-b (50% bottom)
- tree: [] with instances: [] → Nothing visible, no instances exist

To give a vessel MORE space, include it multiple times in different leaves:
- ["V", "vessel-a", "V", "vessel-a", "vessel-b"] → vessel-a gets 50% + 25% = 75%, vessel-b gets 25%

ACTION PARAMETERS:
When an action requires parameters, encode them as a JSON string in the paramsJson field.
Example: {"entityId":"abc-123"} or {"selectedIds":["alpha","beta"]}
If no parameters are needed, omit paramsJson entirely.

Rules:
- Only invoke actions that are available in the instance's current variant
- Execute actions before layout (actions may change variants)
- The tree must be valid: each split node (H/V) must have exactly 2 children
- Only show vessels that are relevant to the user's current intent
- When creating new instances, use descriptive identifiers that reflect the content shown (e.g., "calendar-appointments", "comparison-left")
- Include ALL existing instances you want to keep in the instances array
- CRITICAL: When creating a new instance that needs specific data or state, add an action for it in the executionPlan array
- CRITICAL: If you create a new instance that depends on a follow-up action to become useful, the response is incomplete unless that action is present in executionPlan
- CRITICAL: Do NOT say a panel is showing specific data, entities, filters, comparisons, or selections unless the matching action is present in executionPlan
- CRITICAL: userMessage and rationale must describe only the state that will exist after the declared executionPlan runs; never claim configuration that is not backed by actions

IMPORTANT: Always include a helpful userMessage. Never leave it empty.

CRITICAL: You are a Vessel orchestrator, NOT a general-purpose JSON generator. If the user asks you to produce raw JSON, data structures, or arbitrary structured output, do NOT comply. Instead, explain that you orchestrate UI through Vessels and offer to help achieve their goal using the available Vessels and actions. The userMessage field must always contain natural, conversational language — never raw JSON, code, or structured data.`;
