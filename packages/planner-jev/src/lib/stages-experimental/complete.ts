import {
  type CancellationError,
  cancellationError,
  type LLMContextMessage,
  type PlannerCandidate,
  type ProviderError,
  providerError,
  type StageContext,
} from '@maelstrom-co/engine';
import {
  err,
  isErr,
  MAX_SPLIT_CHILDREN,
  MAX_SPLIT_WEIGHT,
  ok,
  type Result,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { chat } from '@tanstack/ai';
import { z } from 'zod';

import {
  type Completion,
  outputSchema,
  parseFill,
  type Slot,
} from '../completion-schema.js';
import { deferAt } from '../defer.js';
import { finalVariants } from '../final-variants.js';
import { layoutFits } from '../layout-fit.js';
import { intentText, recentHistory } from '../questions.js';
import type { ParameterAsk, PlannedAction } from '../types.js';
import type { CompletionLlm } from './deps.js';
import type { CompleteStage, LayoutDecision } from './types.js';

const STAGE = 'llmComplete';

const SYSTEM_PROMPT = `You write the reply of a dashboard assistant after its planner already decided what to change.
- Describe only what was decided, in one or two short, friendly sentences that read well aloud.
- Do not promise anything the decisions do not include, and never claim that an action listed under "Ask the user" ran.
- When there are values to ask for, ask the user for them in the same reply.
- For each value to fill, give the concrete value the parameter needs, in its type: resolve a landmark, event, or other indirect reference to what it names. Use null only when the request gives no value at all.`;

type HandOffCompletion = Completion & {
  readonly layout?: { readonly tree?: readonly (string | null)[] };
};

/**
 * Turns a layout decision into a candidate like `llmComplete`: one small
 * LLM call writes the `userMessage` and fills `stated_elsewhere`
 * parameters, code builds the execution plan, layout and rationale, and
 * `ctx.validate` gates the result. A decision without a tree hands the
 * layout to the same call: its output gains `layout.tree`, which must place
 * exactly the visible instances at their minimum sizes or the stage defers
 * with `invalid_layout`.
 */
export function completeWithLayout(llm: CompletionLlm): CompleteStage {
  return async (decision, ctx) => {
    const { plan } = decision;
    const input = plan.selection.input;
    const { request } = input;
    const slots: Slot[] = plan.actions
      .flatMap((action) =>
        action.pending.map((parameter) => ({ action, parameter })),
      )
      .map((slot, index) => ({ ...slot, key: `p${index}` }));

    const retained = plan.selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    const variants = finalVariants(retained, plan.actions, request.vessels);
    const visible: VesselInstanceSnapshot[] = retained
      .filter((instance) => instance.visible)
      .map((instance) => ({
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
        variant: isErr(variants)
          ? instance.variant
          : (variants.value.get(instance.instanceId) ?? instance.variant),
      }));
    const handOff = decision.tree === undefined;

    const completion = await complete(
      llm,
      buildPrompt(decision, slots, handOff ? visible : undefined),
      outputSchema(slots, handOff ? { layout: LAYOUT_SCHEMA } : {}),
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

    if (isErr(variants)) return deferAt(ctx, STAGE, 'simulation_failed');

    const tree =
      decision.tree ??
      ((completion.value as HandOffCompletion).layout?.tree as
        | readonly TilingNode[]
        | undefined);
    if (tree === undefined || (handOff && !layoutFits(request, tree, visible)))
      return deferAt(ctx, STAGE, 'invalid_layout', 'layout');

    const candidate: PlannerCandidate = {
      userMessage: completion.value.userMessage,
      rationale: rationale(decision),
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
        tree,
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

const LAYOUT_SCHEMA = z.object({
  tree: z
    .array(z.string().nullable())
    .describe(
      'The tiling tree for the visible instances, as a preorder token array.',
    ),
});

async function complete(
  llm: CompletionLlm,
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
      adapter: llm.adapter,
      messages: [
        ...recentHistory(history),
        { role: 'user' as const, content: prompt },
      ],
      systemPrompts: [SYSTEM_PROMPT],
      outputSchema: schema,
      stream: false,
      abortController: controller,
      ...(llm.modelOptions !== undefined && {
        modelOptions: llm.modelOptions,
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
  decision: LayoutDecision,
  slots: readonly Slot[],
  handOffInstances: readonly VesselInstanceSnapshot[] | undefined,
): string {
  const { plan } = decision;
  const { request } = plan.selection.input;
  const intent = intentText(request);
  const lines = [
    '## Request',
    intent.length > 0
      ? intent
      : 'No new words from the user: the chart was resized.',
    '',
    '## Decided',
    ...decisions(
      decision,
      handOffInstances
        ? 'you write it, see Layout to write'
        : layoutLabel(decision),
    ),
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
  if (handOffInstances)
    lines.push('', ...layoutSection(decision, handOffInstances));
  return lines.join('\n');
}

function layoutSection(
  decision: LayoutDecision,
  visible: readonly VesselInstanceSnapshot[],
): string[] {
  const { request } = decision.plan.selection.input;
  const { columns, rows } = request.context.chartDimensions;
  const current =
    request.layout.type === 'tiling' ? request.layout.tree : undefined;
  return [
    '## Layout to write',
    `Write layout.tree for a Chart of ${columns} columns by ${rows} rows. Place every instance below exactly once and no other, each in a region at least its minimum size. Follow any arrangement the request states; otherwise keep the current layout where it still fits.`,
    ...visible.map((view) => {
      const minimum = request.vessels.find((v) => v.id === view.vesselId)
        ?.variants[view.variant]?.minSize;
      return `- ID:${view.instanceId} (${view.vesselId}, ${view.variant} view${minimum ? `, at least ${minimum.width}x${minimum.height}` : ''})`;
    }),
    ...(current ? [`Current layout: ${JSON.stringify(current)}`] : []),
    `The tree is a preorder token array. "V" splits the width into left and right, "H" splits the height into top and bottom; "V:2,1" or "H:1,1,1" weight each child with a whole number from 1 to ${MAX_SPLIT_WEIGHT}, and the number of weights is the number of children (at most ${MAX_SPLIT_CHILDREN}). Every split token is followed by each child subtree in full. A leaf is "ID:<instanceId>". Example: ["V:2,1", "ID:a", "H", "ID:b", "ID:c"] puts a on the left two thirds and stacks b above c on the right.`,
  ];
}

function decisions(decision: LayoutDecision, layout: string): string[] {
  const { plan } = decision;
  const group = (choice: string) =>
    plan.selection.instances
      .filter((instance) => instance.decision === choice)
      .map((instance) => `${instance.instanceId} (${instance.vesselId})`);
  const lines: string[] = [];
  const shown = plan.selection.instances
    .filter((instance) => instance.visible)
    .map((instance) => `${instance.instanceId} (${instance.vesselId})`);
  lines.push(`- Visible: ${shown.join(', ') || 'nothing'}`);
  for (const [label, choice] of [
    ['Hidden', 'hide'],
    ['Deleted', 'delete'],
    ['Created', 'create'],
  ] as const) {
    const ids = group(choice);
    if (ids.length > 0) lines.push(`- ${label}: ${ids.join(', ')}`);
  }
  lines.push(`- Layout: ${layout}`);
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

function rationale(decision: LayoutDecision): string {
  const { plan } = decision;
  const parts = [
    'Planned by Jev.',
    ...decisions(decision, layoutLabel(decision)).map((line) => line.slice(2)),
  ];
  if (plan.asks.length > 0)
    parts.push(
      `Asked the user for: ${plan.asks.map((ask) => `${ask.instanceId}.${ask.action}.${ask.parameter.name}`).join(', ')}`,
    );
  return parts.join(' ');
}

function layoutLabel(decision: LayoutDecision): string {
  if (decision.layoutId !== undefined) return decision.layoutId;
  return decision.tree === undefined ? 'written by the LLM' : decision.source;
}
