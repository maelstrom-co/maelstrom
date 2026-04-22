import type {
  ActionParameter,
  ChartRequest,
  InstanceId,
  TilingNode,
  UpdateReason,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { isInstanceIdNode } from '@maelstrom-co/protocol';

import type { PromptSection } from './sections.js';
import { UserSection } from './sections.js';
import type { Logger } from '../logger.js';

const CHART_STATE_HEADING: readonly string[] = ['## Current Chart State', ''];

export function buildUserSections(
  request: ChartRequest,
  logger?: Logger,
): readonly PromptSection[] {
  const mode = request.context.layoutMode;

  const chartStateContent = (() => {
    switch (mode) {
      case 'grid':
        return buildGridChartState(request, logger);
      case 'tiling':
        return buildTilingChartState(request, logger);
      default: {
        const _exhaustive: never = mode;
        throw new Error(`Unhandled layout mode: ${String(_exhaustive)}`);
      }
    }
  })();

  return [
    { key: UserSection.VESSELS, content: buildVesselsSection(request.vessels) },
    { key: UserSection.CHART_STATE, content: chartStateContent },
    {
      key: UserSection.UPDATE_TRIGGERS,
      content: buildUpdateTriggersSection(request.context.updateReasons),
    },
  ];
}

export function buildVesselsSection(vessels: readonly Vessel[]): string {
  const lines: string[] = ['## Registered Vessels', ''];

  for (const vessel of vessels) {
    lines.push(serializeVessel(vessel));
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
    const variantDesc = variant.description ? `: ${variant.description}` : '';
    lines.push(`- ${variantName}${defaultMarker}${variantDesc}`);

    if (variant.actions.length > 0) {
      lines.push(`  Actions: ${formatActions(variant.actions)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function serializeAction(action: VesselAction): string {
  let str = action.name;

  if (action.parameters && action.parameters.length > 0) {
    const params = action.parameters
      .map((p: ActionParameter) =>
        p.enum ? `${p.name}: ${p.enum.join('|')}` : `${p.name}: ${p.type}`,
      )
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

function formatActions(actions: readonly VesselAction[]): string {
  return actions.map(serializeAction).join(', ');
}

function lookupVesselForInstance(
  instance: VesselInstanceSnapshot,
  vessels: readonly Vessel[],
  logger?: Logger,
): Vessel | undefined {
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  if (!vessel) {
    logger?.warn(
      `Instance "${instance.instanceId}" references unknown vessel "${instance.vesselId}"`,
    );
  }
  return vessel;
}

export function buildGridChartState(
  request: ChartRequest,
  logger?: Logger,
): string {
  const lines: string[] = [...CHART_STATE_HEADING];
  lines.push('Layout Mode: Grid');
  lines.push(
    `Chart Dimensions: ${request.context.chartDimensions.columns}×${request.context.chartDimensions.rows} cells`,
  );
  lines.push('');

  const { layout } = request;
  if (layout.type !== 'grid') return lines.join('\n');

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
        const actions = serializeInstanceActions(
          instance,
          request.vessels,
          logger,
        );
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

function serializeInstanceActions(
  instance: VesselInstanceSnapshot,
  vessels: readonly Vessel[],
  logger?: Logger,
): string {
  const vessel = lookupVesselForInstance(instance, vessels, logger);
  if (!vessel) return '';

  const variant = vessel.variants[instance.variant];
  if (!variant) {
    logger?.warn(
      `Instance "${instance.instanceId}" references unknown variant "${instance.variant}" on vessel "${instance.vesselId}"`,
    );
    return '';
  }
  if (variant.actions.length > 0) {
    return `  Actions: ${formatActions(variant.actions)}`;
  }
  return '';
}

export function buildTilingChartState(
  request: ChartRequest,
  logger?: Logger,
): string {
  const lines: string[] = [...CHART_STATE_HEADING];
  lines.push('Layout Mode: Tiling (binary tree)');
  lines.push('');

  const { layout } = request;
  if (layout.type !== 'tiling') return lines.join('\n');

  const visibleIds = extractVisibleInstanceIds(layout.tree);

  const visible = request.instances.filter((i: VesselInstanceSnapshot) =>
    visibleIds.has(i.instanceId),
  );
  const hidden = request.instances.filter(
    (i: VesselInstanceSnapshot) => !visibleIds.has(i.instanceId),
  );

  if (visible.length > 0) {
    lines.push('Currently Visible:');
    for (const instance of visible) {
      lines.push(serializeInstanceForTiling(instance, request.vessels, logger));
    }
  } else {
    lines.push('No vessels currently visible.');
  }

  if (hidden.length > 0) {
    lines.push('');
    lines.push('Available (hidden):');
    for (const instance of hidden) {
      lines.push(serializeInstanceForTiling(instance, request.vessels, logger));
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

function serializeInstanceForTiling(
  instance: VesselInstanceSnapshot,
  vessels: readonly Vessel[],
  logger?: Logger,
): string {
  const vessel = lookupVesselForInstance(instance, vessels, logger);
  const variant = vessel?.variants[instance.variant];
  if (vessel && !variant) {
    logger?.warn(
      `Instance "${instance.instanceId}" references unknown variant "${instance.variant}" on vessel "${instance.vesselId}"`,
    );
  }

  let line = `- ${instance.instanceId} (${instance.vesselId}), variant: ${instance.variant}`;

  if (variant && variant.actions.length > 0) {
    line += `\n  Available: ${formatActions(variant.actions)}`;
  }

  return line;
}

function extractVisibleInstanceIds(
  tree: readonly TilingNode[],
): Set<InstanceId> {
  const ids = new Set<InstanceId>();
  for (const node of tree) {
    if (isInstanceIdNode(node)) {
      ids.add(node);
    }
  }
  return ids;
}

export function buildUpdateTriggersSection(
  reasons: readonly UpdateReason[],
): string {
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
