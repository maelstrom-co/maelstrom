import type { ReplylessCandidate, Stage } from '@maelstrom-co/engine';
import { isErr, type NeedsClarification, ok } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import { completionMode } from '../completion-mode.js';
import {
  type Completion,
  outputSchema,
  parseFill,
  type ReplylessCompletion,
  type Slot,
} from '../completion-schema.js';
import { declaredVariants } from '../declared-variants.js';
import { deferAt, STAGE_NAME } from '../defer.js';
import { callLlm } from '../llm-call.js';
import { parameterClarification } from '../parameter-clarification.js';
import { intentText } from '../questions.js';
import type { JevLayoutPlan, ParameterAsk, PlannedAction } from '../types.js';

const STAGE = STAGE_NAME.llmComplete;

/** Configuration for {@link llmComplete}. */
export interface LlmCompleteOptions {
  /** TanStack AI text adapter for the completion call. */
  readonly adapter: AnyTextAdapter;
  /** Provider options forwarded to `chat()`. */
  readonly modelOptions?: Record<string, unknown>;
}

/**
 * Turns the Jev decisions into a candidate: one small LLM call writes the
 * `userMessage` and fills `stated_elsewhere` parameters, code builds the
 * layout, execution plan and rationale. The layout declares each instance in
 * its variant before the actions run, and the execution plan ships every
 * planned action, so the client applies the layout and then each action's
 * transition, view switches included. The candidate then goes
 * through `ctx.validate`; a validation error or a recommended retry defers,
 * so a flawed Jev plan falls back instead of shipping healed. Provider
 * failures and cancellation are real errors: the fallback uses the same
 * provider.
 *
 * On a request with `skipReply: true` the candidate has no `userMessage`:
 * the call only fills parameters, and with none to fill it is not made.
 * When the plan also asks the user for parameters, the validated candidate
 * becomes a needs-clarification result that asks for them and carries the
 * actions and layout already planned. Otherwise the candidate always
 * carries the reply, which asks for those parameters itself.
 */
export function llmComplete(
  options: LlmCompleteOptions,
): Stage<JevLayoutPlan, ReplylessCandidate | NeedsClarification> {
  return async (layoutPlan, ctx) => {
    const { plan } = layoutPlan;
    const input = plan.selection.input;
    const slots: Slot[] = plan.actions
      .flatMap((action) =>
        action.pending.map((parameter) => ({ action, parameter })),
      )
      .map((slot, index) => ({ ...slot, key: `p${index}` }));

    const mode = completionMode({
      skipReply: input.request.skipReply,
      slotCount: slots.length,
      layoutHandOff: false,
    });
    const withMessage = mode === 'full';
    const completion =
      mode === 'skip'
        ? ok<Completion | ReplylessCompletion>({})
        : await callLlm(
            options,
            buildPrompt(layoutPlan, slots, withMessage),
            outputSchema(slots, undefined, { withMessage }),
            input.history,
            ctx,
            { withMessage },
          );
    if (isErr(completion)) return completion;
    const userMessage =
      'userMessage' in completion.value
        ? completion.value.userMessage
        : undefined;

    const filled = new Map<Slot, unknown>();
    for (const slot of slots) {
      const value = parseFill(
        slot.parameter,
        completion.value.params?.[slot.key],
      );
      if (value === undefined)
        return deferAt(
          ctx,
          STAGE,
          'param_unfilled',
          `${slot.action.instanceId}/${slot.action.action}/${slot.parameter.name}`,
        );
      filled.set(slot, value);
    }

    const retained = plan.selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    const declared = declaredVariants(
      retained,
      plan.actions,
      input.request.vessels,
    );
    if (isErr(declared)) return deferAt(ctx, STAGE, 'simulation_failed');

    const candidate: ReplylessCandidate = {
      type: 'plan',
      ...(userMessage !== undefined && { userMessage }),
      rationale: rationale(layoutPlan),
      executionPlan: declared.value.actions.map((action) => {
        const params: Record<string, unknown> = { ...action.params };
        for (const slot of slots)
          if (slot.action === action)
            params[slot.parameter.name] = filled.get(slot);
        return {
          instanceId: action.instanceId,
          action: action.action,
          ...(Object.keys(params).length > 0 && {
            paramsJson: JSON.stringify(params),
          }),
        };
      }),
      layout: {
        tree: layoutPlan.tree,
        instances: retained.map(({ instanceId, vesselId, variant }) => ({
          instanceId,
          vesselId,
          variant: declared.value.variants.get(instanceId) ?? variant,
        })),
      },
    };

    const report = ctx.validate(candidate);
    if (isErr(report)) return deferAt(ctx, STAGE, 'invalid_candidate');
    if (report.value.diagnostics.retryHint.recommend)
      return deferAt(ctx, STAGE, 'retry_recommended');
    if (input.request.skipReply === true && plan.asks.length > 0)
      return ok(parameterClarification(plan.asks, candidate, input.request));
    return ok(candidate);
  };
}

function buildPrompt(
  layoutPlan: JevLayoutPlan,
  slots: readonly Slot[],
  includeAsks: boolean,
): string {
  const { plan } = layoutPlan;
  const { request } = plan.selection.input;
  const intent = intentText(request);
  const lines = [
    '## Request',
    intent.length > 0
      ? intent
      : 'No new words from the user: the chart was resized.',
    '',
    '## Decided',
    ...decisions(layoutPlan),
  ];
  if (slots.length > 0)
    lines.push(
      '',
      '## Values to fill',
      'Give the value each parameter needs, in its type: resolve a landmark, event, or other indirect reference to what it names. Null only when the request gives no value at all.',
      ...slots.map((slot) => `- ${slot.key}: ${describeSlot(slot)}`),
    );
  if (includeAsks && plan.asks.length > 0)
    lines.push(
      '',
      '## Ask the user',
      'Ask the user for these values; do not claim these actions ran.',
      ...plan.asks.map(describeAsk),
    );
  return lines.join('\n');
}

function decisions(layoutPlan: JevLayoutPlan): string[] {
  const { plan } = layoutPlan;
  const group = (decision: string) =>
    plan.selection.instances
      .filter((instance) => instance.decision === decision)
      .map((instance) => `${instance.instanceId} (${instance.vesselId})`);
  const lines: string[] = [];
  const shown = plan.selection.instances
    .filter((instance) => instance.visible)
    .map((instance) => `${instance.instanceId} (${instance.vesselId})`);
  lines.push(`- Visible: ${shown.join(', ') || 'nothing'}`);
  for (const [label, decision] of [
    ['Hidden', 'hide'],
    ['Deleted', 'delete'],
    ['Created', 'create'],
  ] as const) {
    const ids = group(decision);
    if (ids.length > 0) lines.push(`- ${label}: ${ids.join(', ')}`);
  }
  lines.push(`- Layout: ${layoutPlan.layoutId}`);
  lines.push(
    plan.actions.length === 0
      ? '- Actions: none'
      : `- Actions, in order: ${plan.actions.map(describeAction).join('; ')}`,
  );
  return lines;
}

function describeAction(action: PlannedAction): string {
  const bound = Object.entries(action.params).map(
    ([name, value]) => `${name}=${JSON.stringify(value)}`,
  );
  const pending = action.pending.map(
    (parameter) => `${parameter.name}=(to fill)`,
  );
  const params = [...bound, ...pending];
  return `${action.action} on ${action.instanceId}${params.length > 0 ? ` (${params.join(', ')})` : ''}`;
}

function describeAsk(ask: ParameterAsk): string {
  return `- ${ask.parameter.name} for ${ask.action} on ${ask.instanceId}: ${ask.parameter.description}`;
}

function describeSlot(slot: Slot): string {
  const { parameter, action } = slot;
  const enumSuffix =
    parameter.enum && parameter.enum.length > 0
      ? ` (one of: ${parameter.enum.join(', ')})`
      : '';
  return `${parameter.name} (${parameter.type}) for ${action.action} on ${action.instanceId}: ${parameter.description}${enumSuffix}`;
}

function rationale(layoutPlan: JevLayoutPlan): string {
  const { plan } = layoutPlan;
  const parts = [
    'Planned by Jev.',
    ...decisions(layoutPlan).map((line) => line.slice(2)),
  ];
  if (plan.asks.length > 0)
    parts.push(
      `Asked the user for: ${plan.asks.map((ask) => `${ask.instanceId}.${ask.action}.${ask.parameter.name}`).join(', ')}`,
    );
  return parts.join(' ');
}
