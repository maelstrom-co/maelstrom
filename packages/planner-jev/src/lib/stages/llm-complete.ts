import {
  type CancellationError,
  cancellationError,
  finalVariants,
  type LLMContextMessage,
  type PlannerCandidate,
  type ProviderError,
  providerError,
  type Stage,
  type StageContext,
} from '@maelstrom-co/engine';
import { err, isErr, ok, type Result } from '@maelstrom-co/protocol';
import { type AnyTextAdapter, chat } from '@tanstack/ai';
import type { z } from 'zod';
import {
  type Completion,
  outputSchema,
  parseFill,
  type Slot,
} from '../completion-schema.js';
import { deferAt } from '../defer.js';
import { intentText, recentHistory } from '../questions.js';
import type { JevLayoutPlan, ParameterAsk, PlannedAction } from '../types.js';

const STAGE = 'llmComplete';

const SYSTEM_PROMPT = `You write the reply of a dashboard assistant after its planner already decided what to change.
- Describe only what was decided, in one or two short, friendly sentences that read well aloud.
- Do not promise anything the decisions do not include, and never claim that an action listed under "Ask the user" ran.
- When there are values to ask for, ask the user for them in the same reply.
- For each value to fill, give the concrete value the parameter needs, in its type: resolve a landmark, event, or other indirect reference to what it names. Use null only when the request gives no value at all.`;

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
 * layout, execution plan and rationale. The layout declares each existing
 * instance in the variant the planned actions leave it in: clients apply a
 * transition from the layout, not from an Engine-issued action. The
 * candidate then goes through
 * `ctx.validate`; a validation error or a recommended retry defers, so a
 * flawed Jev plan falls back instead of shipping healed. Provider failures
 * and cancellation are real errors: the fallback uses the same provider.
 */
export function llmComplete(
  options: LlmCompleteOptions,
): Stage<JevLayoutPlan, PlannerCandidate> {
  return async (layoutPlan, ctx) => {
    const { plan } = layoutPlan;
    const input = plan.selection.input;
    const slots: Slot[] = plan.actions
      .flatMap((action) =>
        action.pending.map((parameter) => ({ action, parameter })),
      )
      .map((slot, index) => ({ ...slot, key: `p${index}` }));

    const completion = await complete(
      options,
      buildPrompt(layoutPlan, slots),
      outputSchema(slots),
      input.history,
      ctx,
    );
    if (isErr(completion)) return completion;

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
    const variants = finalVariants(
      retained,
      plan.actions,
      input.request.vessels,
    );
    if (isErr(variants)) return deferAt(ctx, STAGE, 'simulation_failed');

    const candidate: PlannerCandidate = {
      userMessage: completion.value.userMessage,
      rationale: rationale(layoutPlan),
      executionPlan: plan.actions.map((action) => {
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
        // New instances seed the Engine's action simulation from this
        // declaration, so they keep the variant they are created in.
        instances: retained.map(({ instanceId, vesselId, variant, fresh }) => ({
          instanceId,
          vesselId,
          variant: fresh
            ? variant
            : (variants.value.get(instanceId) ?? variant),
        })),
      },
    };

    const report = ctx.validate(candidate);
    if (isErr(report)) return deferAt(ctx, STAGE, 'invalid_candidate');
    if (report.value.diagnostics.retryHint.recommend)
      return deferAt(ctx, STAGE, 'retry_recommended');
    return ok(candidate);
  };
}

async function complete(
  options: LlmCompleteOptions,
  prompt: string,
  schema: z.ZodType<Completion>,
  history: readonly LLMContextMessage[],
  ctx: StageContext,
): Promise<Result<Completion, CancellationError | ProviderError>> {
  const { signal, logger } = ctx;
  const messageId = ctx.origin.messageId;
  if (signal?.aborted) {
    logger.info('Request cancelled', { messageId, reason: signal.reason });
    return err(
      cancellationError('Request was already cancelled', signal.reason),
    );
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const output = await chat({
      adapter: options.adapter,
      messages: [
        ...recentHistory(history),
        { role: 'user' as const, content: prompt },
      ],
      systemPrompts: [SYSTEM_PROMPT],
      outputSchema: schema,
      stream: false,
      abortController: controller,
      ...(options.modelOptions !== undefined && {
        modelOptions: options.modelOptions,
      }),
    });
    return ok(output as Completion);
  } catch (error) {
    if (signal?.aborted) {
      logger.info('Request cancelled', { messageId, reason: signal.reason });
      return err(
        cancellationError(
          `Request cancelled: ${signal.reason ?? 'unknown reason'}`,
          signal.reason,
        ),
      );
    }
    const failure = providerError(
      error instanceof Error ? error.message : String(error),
      error,
    );
    logger.error('llmComplete call failed', failure, { messageId });
    return err(failure);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function buildPrompt(
  layoutPlan: JevLayoutPlan,
  slots: readonly Slot[],
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
  if (plan.asks.length > 0)
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
