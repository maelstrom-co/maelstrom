import type {
  ActionParameter,
  ChartRequest,
  LayoutMode,
  TilingNode,
  UpdateReason,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol-old';

import type {
  PromptSection,
  SectionCustomizer,
  SystemSectionOverrides,
  UserSectionOverrides,
} from './sections.js';
import { isSectionExtension, UserSection } from './sections.js';
import { getDefaultSystemSections } from './system-prompts.js';
import type { Logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Default template variables
// ---------------------------------------------------------------------------

const DEFAULT_VARS: PromptVars = {
  assistantName: 'Maelstrom',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVars {
  /** Assistant name substituted into the identity section. Default: 'Maelstrom' */
  readonly assistantName?: string;
  /** Arbitrary extra variables for custom sections */
  readonly [key: string]: string | undefined;
}

export interface PromptOptions {
  /** Template variables substituted into section defaults (e.g. assistantName) */
  readonly vars?: PromptVars;
  /** System prompt section customizations (identity, triggers, layout, actions, rules) */
  readonly system?: Readonly<SystemSectionOverrides>;
  /** User prompt section customizations (vessels, chartState, updateTriggers) */
  readonly user?: Readonly<UserSectionOverrides>;
}

export interface PromptResult {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly sections: {
    readonly system: readonly PromptSection[];
    readonly user: readonly PromptSection[];
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildPrompt(
  request: ChartRequest,
  options?: PromptOptions,
  logger?: Logger,
): PromptResult {
  const mode = request.context.layoutMode;
  const vars = resolveVars(options?.vars);

  const defaultSystem = recordToSections(getDefaultSystemSections(mode));
  const interpolated = interpolateVars(defaultSystem, vars);
  const systemSections = applySectionOverrides(interpolated, options?.system);

  const defaultUserSections = buildDefaultUserSections(request, logger);
  const userSections = applySectionOverrides(
    defaultUserSections,
    options?.user,
  );

  return {
    systemPrompt: joinSections(systemSections),
    userPrompt: joinSections(userSections),
    sections: { system: systemSections, user: userSections },
  };
}

export function buildSystemPrompt(
  mode: LayoutMode,
  options?: Pick<PromptOptions, 'vars' | 'system'>,
): string {
  const vars = resolveVars(options?.vars);
  const defaults = recordToSections(getDefaultSystemSections(mode));
  const interpolated = interpolateVars(defaults, vars);
  const sections = applySectionOverrides(interpolated, options?.system);
  return joinSections(sections);
}

// ---------------------------------------------------------------------------
// Template variable interpolation
// ---------------------------------------------------------------------------

function resolveVars(vars?: PromptVars): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...DEFAULT_VARS, ...vars })) {
    if (value !== undefined) {
      resolved[key] = value;
    }
  }
  return resolved;
}

function interpolateVars(
  sections: readonly PromptSection[],
  vars: Record<string, string>,
): readonly PromptSection[] {
  return sections.map((section) => ({
    key: section.key,
    content: replaceVars(section.content, vars),
  }));
}

function replaceVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? (vars[key] ?? match) : match,
  );
}

// ---------------------------------------------------------------------------
// Section composition
// ---------------------------------------------------------------------------

function recordToSections(
  record: Record<string, string>,
): readonly PromptSection[] {
  return Object.entries(record).map(([key, content]) => ({ key, content }));
}

function applySectionOverrides(
  defaults: readonly PromptSection[],
  overrides?: Readonly<Record<string, SectionCustomizer | undefined>>,
): readonly PromptSection[] {
  if (!overrides) return defaults;

  const result: PromptSection[] = [];
  const defaultKeys = new Set(defaults.map((s) => s.key));

  for (const section of defaults) {
    const customizer = overrides[section.key];

    if (customizer === undefined) {
      result.push(section);
    } else if (customizer === null) {
      // Section removed
    } else if (typeof customizer === 'string') {
      result.push({ key: section.key, content: customizer });
    } else if (isSectionExtension(customizer)) {
      const parts = [
        customizer.prepend,
        section.content,
        customizer.append,
      ].filter(Boolean);
      result.push({ key: section.key, content: parts.join('\n\n') });
    } else {
      try {
        result.push({
          key: section.key,
          content: customizer(section.content),
        });
      } catch (error) {
        throw new Error(
          `Prompt section customizer for "${section.key}" threw: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
  }

  // Append new sections from overrides that don't match any default key.
  for (const [key, customizer] of Object.entries(overrides)) {
    if (defaultKeys.has(key) || customizer == null) continue;

    if (typeof customizer === 'function') {
      throw new Error(
        `Prompt section customizer for "${key}" is a function, but "${key}" is not a default section. ` +
          'Use a string value or { prepend, append } to add new sections.',
      );
    }

    if (typeof customizer === 'string') {
      result.push({ key, content: customizer });
    } else if (isSectionExtension(customizer)) {
      const parts = [customizer.prepend, customizer.append].filter(Boolean);
      result.push({ key, content: parts.join('\n\n') });
    }
  }

  return result;
}

function joinSections(sections: readonly PromptSection[]): string {
  return sections
    .filter((s) => s.content.length > 0)
    .map((s) => s.content)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Default user prompt sections (built from ChartRequest)
// ---------------------------------------------------------------------------

function buildDefaultUserSections(
  request: ChartRequest,
  logger?: Logger,
): readonly PromptSection[] {
  const mode = request.context.layoutMode;

  return [
    { key: UserSection.VESSELS, content: buildVesselsSection(request.vessels) },
    {
      key: UserSection.CHART_STATE,
      content:
        mode === 'grid'
          ? buildGridChartState(request, logger)
          : buildTilingChartState(request, logger),
    },
    {
      key: UserSection.UPDATE_TRIGGERS,
      content: buildUpdateTriggersSection(request.context.updateReasons),
    },
  ];
}

// ---------------------------------------------------------------------------
// Vessels section
// ---------------------------------------------------------------------------

function buildVesselsSection(vessels: readonly Vessel[]): string {
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

// ---------------------------------------------------------------------------
// Chart state — Grid
// ---------------------------------------------------------------------------

function buildGridChartState(request: ChartRequest, logger?: Logger): string {
  const lines: string[] = ['## Current Chart State', ''];
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
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  if (!vessel) {
    logger?.warn(
      `Instance "${instance.instanceId}" references unknown vessel "${instance.vesselId}"`,
    );
    return '';
  }

  const variant = vessel.variants[instance.variant];
  if (variant && variant.actions.length > 0) {
    const actionStrs = variant.actions.map(serializeAction);
    return `  Actions: ${actionStrs.join(', ')}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Chart state — Tiling
// ---------------------------------------------------------------------------

function buildTilingChartState(request: ChartRequest, logger?: Logger): string {
  const lines: string[] = ['## Current Chart State', ''];
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
  const vessel = vessels.find((v) => v.id === instance.vesselId);
  if (!vessel) {
    logger?.warn(
      `Instance "${instance.instanceId}" references unknown vessel "${instance.vesselId}"`,
    );
  }
  const variant = vessel?.variants[instance.variant];

  let line = `- ${instance.instanceId} (${instance.vesselId}), variant: ${instance.variant}`;

  if (variant && variant.actions.length > 0) {
    const actionStrs = variant.actions.map(serializeAction);
    line += `\n  Available: ${actionStrs.join(', ')}`;
  }

  return line;
}

function extractVisibleInstanceIds(tree: TilingNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of tree) {
    if (node !== null && node !== 'H' && node !== 'V') {
      ids.add(node);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Update triggers
// ---------------------------------------------------------------------------

function buildUpdateTriggersSection(reasons: readonly UpdateReason[]): string {
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
