import type { LLMContextMessage } from '@maelstrom-co/engine';
import {
  type ChartDimensions,
  ChartDimensionsSchema,
  type TilingNode,
  TilingNodeSchema,
  type UpdateReason,
  UpdateReasonSchema,
  type Vessel,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import { describeLayout } from './stages/layout-describe.js';

/**
 * Renders a value for a Decisions call. The select stage's state (an
 * object with `intent`, `instances` and `vessels` arrays) becomes short
 * plain prose: the reasons for the update in the order they arrived (the
 * user's requests verbatim, chart resizes and instance mutations), that
 * there is no request when there is none, that what is shown stays when
 * every reason is a resize, the earlier conversation turns, the visible and hidden
 * instances by name and id, the layout in words, the chart size, and one
 * line per widget type with its description, views and action names, but
 * no action parameter schemas. Any other value, including a state with a
 * malformed entry, is `JSON.stringify`d unchanged. Pass it as `render` to `createDecisionsClient`.
 *
 * @experimental
 */
export function renderSelectStateAsProse(value: unknown): string {
  if (!isSelectState(value)) return JSON.stringify(value);
  const sections = [
    requestLines(value.intent),
    historyLines(value.history ?? []),
    screenLines(value),
    widgetTypeLines(value.vessels),
  ];
  return sections
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join('\n'))
    .join('\n\n');
}

interface SelectStateInstance {
  readonly instanceId: string;
  readonly vesselId: string;
  readonly variant: string;
  readonly visible: boolean;
}

interface SelectState {
  readonly intent: readonly UpdateReason[];
  readonly history?: readonly LLMContextMessage[];
  readonly chartDimensions?: ChartDimensions;
  readonly currentLayout?: readonly TilingNode[];
  readonly instances: readonly SelectStateInstance[];
  readonly vessels: readonly Vessel[];
}

const SelectStateSchema = z.object({
  intent: z.array(UpdateReasonSchema),
  history: z
    .array(
      z.object({ role: z.enum(['user', 'assistant']), content: z.string() }),
    )
    .optional(),
  chartDimensions: ChartDimensionsSchema.optional(),
  currentLayout: z.array(TilingNodeSchema).optional(),
  instances: z.array(
    z.object({
      instanceId: z.string(),
      vesselId: z.string(),
      variant: z.string(),
      visible: z.boolean(),
    }),
  ),
  vessels: z.array(VesselSchema),
});

function isSelectState(value: unknown): value is SelectState {
  return SelectStateSchema.safeParse(value).success;
}

function requestLines(reasons: readonly UpdateReason[]): string[] {
  const hasRequest = reasons.some((reason) => reason.type === 'user_intent');
  const lines = hasRequest ? [] : ['There is no new request from the user.'];
  if (reasons.length === 1)
    lines.push(...reasons.map((reason) => reasonLine(reason, 'alone')));
  if (reasons.length > 1)
    lines.push(
      'What happened since the last turn, in order:',
      ...reasons.map((reason) => `- ${reasonLine(reason, 'listed')}`),
    );
  if (
    reasons.length > 0 &&
    reasons.every((reason) => reason.type === 'chart_resize')
  )
    lines[lines.length - 1] +=
      ' Only the size changed: keep showing what is shown now.';
  return lines;
}

function historyLines(history: readonly LLMContextMessage[]): string[] {
  if (history.length === 0) return [];
  return [
    'Earlier in the conversation:',
    ...history.map(
      (message) =>
        `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`,
    ),
  ];
}

function screenLines(state: SelectState): string[] {
  const names = new Map<string, string>(
    state.vessels.map((vessel) => [vessel.id, vessel.name]),
  );
  const listed = (instances: readonly SelectStateInstance[]) =>
    instances.length === 0
      ? 'nothing'
      : instances
          .map(
            (instance) =>
              `${names.get(instance.vesselId) ?? instance.vesselId} (${instance.instanceId}, ${instance.variant} view)`,
          )
          .join(', ');
  const lines = [
    `On screen now: ${listed(state.instances.filter((instance) => instance.visible))}.`,
    `Hidden: ${listed(state.instances.filter((instance) => !instance.visible))}.`,
  ];
  if (state.currentLayout !== undefined)
    lines.push(`Layout: ${describeLayout(state.currentLayout)}.`);
  if (state.chartDimensions !== undefined)
    lines.push(`Chart size: ${size(state.chartDimensions)}.`);
  return lines;
}

function widgetTypeLines(vessels: readonly Vessel[]): string[] {
  if (vessels.length === 0) return [];
  return [
    'Widget types:',
    ...vessels.map((vessel) => {
      const views = Object.keys(vessel.variants)
        .map((name) =>
          name === vessel.defaultVariant ? `${name} (default)` : name,
        )
        .join(', ');
      const actions = [
        ...new Set(
          Object.values(vessel.variants).flatMap((variant) =>
            variant.actions.map((action) => action.name),
          ),
        ),
      ];
      const actionText =
        actions.length === 0 ? '' : ` Actions: ${actions.join(', ')}.`;
      return `- ${vessel.name} (${vessel.id}): ${vessel.description} Views: ${views}.${actionText}`;
    }),
  ];
}

function size(dimensions: ChartDimensions): string {
  return `${dimensions.columns} columns by ${dimensions.rows} rows`;
}

function reasonLine(
  reason: UpdateReason,
  position: 'alone' | 'listed',
): string {
  switch (reason.type) {
    case 'user_intent':
      return position === 'alone'
        ? `The user's latest request: "${reason.intent}"`
        : `The user asked: "${reason.intent}"`;
    case 'chart_resize':
      return `The chart was resized from ${size(reason.previous)} to ${size(reason.current)}.`;
    case 'vessel_mutation':
      return `${reason.instanceId} changed: ${reason.changes}.`;
  }
}
