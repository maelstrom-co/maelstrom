import type { LLMContextMessage } from '@maelstrom-co/engine';
import type {
  ChartDimensions,
  TilingNode,
  UpdateReason,
  Vessel,
} from '@maelstrom-co/protocol';

import { describeLayout } from './stages/layout-describe.js';

/**
 * Renders a value for a Decisions call. The select stage's state (an
 * object with `intent`, `instances` and `vessels` arrays) becomes short
 * plain prose: the user's requests verbatim, the visible and hidden
 * instances by name and id, the layout in words, the chart size, and one
 * line per widget type with its description, views and action names, but
 * no action parameter schemas. Any other value is `JSON.stringify`d
 * unchanged. Pass it as `render` to `createDecisionsClient`.
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

function isSelectState(value: unknown): value is SelectState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.intent) &&
    Array.isArray(record.instances) &&
    Array.isArray(record.vessels)
  );
}

function requestLines(reasons: readonly UpdateReason[]): string[] {
  const requests = reasons.flatMap((reason) =>
    reason.type === 'user_intent' ? [`"${reason.intent}"`] : [],
  );
  const lines =
    requests.length === 1
      ? [`The user's latest request: ${requests[0]}`]
      : requests.length > 1
        ? [
            "The user's latest requests, in order:",
            ...requests.map((request) => `- ${request}`),
          ]
        : [];
  for (const reason of reasons) {
    if (reason.type === 'chart_resize')
      lines.push(
        `The chart was resized from ${size(reason.previous)} to ${size(reason.current)}.`,
      );
    if (reason.type === 'vessel_mutation')
      lines.push(`${reason.instanceId} changed: ${reason.changes}.`);
  }
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
