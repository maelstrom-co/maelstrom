import {
  type CancellationError,
  cancellationError,
  type Deferred,
  type LLMContextMessage,
  type PlannerCandidate,
  type ProviderError,
  providerError,
  type SimulationError,
  type StageContext,
} from '@maelstrom-co/engine';
import {
  type ChartRequest,
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
import {
  type DeclaredVariants,
  declaredVariants,
} from '../declared-variants.js';
import { deferAt, STAGE_NAME } from '../defer.js';
import { layoutFits } from '../layout-fit.js';
import { intentText, recentHistory } from '../questions.js';
import type {
  ParameterAsk,
  PlannedAction,
  SelectedInstance,
} from '../types.js';
import { actionKey, keepFirstOfEachKey } from './duplicate-actions.js';
import type { CompletionLlm } from './stage-deps.js';
import type { CompleteStage, LayoutDecision } from './stage-types.js';

const STAGE = STAGE_NAME.llmComplete;

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
 * exactly the visible instances, each at least at its minimum size, or the
 * stage defers with `invalid_layout`.
 */
export function completeLayoutInline(llm: CompletionLlm): CompleteStage {
  return async (decision, ctx) => {
    const prep = prepareCompletion(decision);
    const { slots, visible, handOff } = prep;

    const completion = await callLlm<Completion>(
      llm,
      buildPrompt(decision, slots, handOff ? visible : undefined),
      outputSchema(slots, handOff ? { layout: LAYOUT_SCHEMA } : {}),
      decision.plan.selection.input.history,
      ctx,
    );
    if (isErr(completion)) return completion;

    const tree =
      decision.tree ??
      ((completion.value as HandOffCompletion).layout?.tree as
        | readonly TilingNode[]
        | undefined);
    return assembleCandidate(ctx, decision, completion.value, prep, tree);
  };
}

/**
 * Slots to fill, the retained instances, their declared variants and
 * whether the decision hands the layout tree off. Shared by every
 * completion call built over one {@link LayoutDecision}, so a stage that
 * splits the completion into several calls still derives them once.
 */
export interface CompletionPrep {
  readonly slots: readonly Slot[];
  readonly retained: readonly SelectedInstance[];
  readonly declared: Result<DeclaredVariants, SimulationError>;
  readonly visible: readonly VesselInstanceSnapshot[];
  readonly handOff: boolean;
}

/** Derives {@link CompletionPrep} from `decision`. */
export function prepareCompletion(decision: LayoutDecision): CompletionPrep {
  const { plan } = decision;
  const { request } = plan.selection.input;
  const slots: Slot[] = plan.actions
    .flatMap((action) =>
      action.pending.map((parameter) => ({ action, parameter })),
    )
    .map((slot, index) => ({ ...slot, key: `p${index}` }));

  const retained = plan.selection.instances.filter(
    (instance) => instance.decision !== 'delete',
  );
  const declared = declaredVariants(retained, plan.actions, request.vessels);
  const visible: VesselInstanceSnapshot[] = retained
    .filter((instance) => instance.visible)
    .map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: isErr(declared)
        ? instance.variant
        : (declared.value.variants.get(instance.instanceId) ??
          instance.variant),
    }));
  return {
    slots,
    retained,
    declared,
    visible,
    handOff: decision.tree === undefined,
  };
}

/**
 * Whether `tree` cannot ship: missing outright, or on a hand-off, not
 * placing exactly the `visible` instances each at least at its minimum
 * size on the request's Chart.
 */
export function invalidTree(
  request: ChartRequest,
  tree: readonly TilingNode[] | undefined,
  handOff: boolean,
  visible: readonly VesselInstanceSnapshot[],
): boolean {
  return tree === undefined || (handOff && !layoutFits(request, tree, visible));
}

/**
 * Fills pending parameters from `completion`, checks the simulated variants
 * and `tree`, then builds, validates and returns the candidate. An action
 * whose instance, name and filled parameters repeat an earlier one's is
 * left out of the execution plan. The tail
 * every completion call shares once it has a message and a tree, whether
 * both came from one call or from separate calls run in parallel.
 */
export function assembleCandidate(
  ctx: StageContext,
  decision: LayoutDecision,
  completion: Completion,
  prep: CompletionPrep,
  tree: readonly TilingNode[] | undefined,
): Result<PlannerCandidate, Deferred> {
  const { plan } = decision;
  const { request } = plan.selection.input;
  const { slots, retained, declared, visible, handOff } = prep;

  const filled = new Map<Slot, unknown>();
  for (const slot of slots) {
    const value = parseFill(slot.parameter, completion.params?.[slot.key]);
    if (value === undefined)
      return deferAt(
        ctx,
        STAGE,
        'param_unfilled',
        `${slot.action.instanceId}/${slot.action.action}/${slot.parameter.name}`,
      );
    filled.set(slot, value);
  }

  if (isErr(declared)) return deferAt(ctx, STAGE, 'simulation_failed');

  if (invalidTree(request, tree, handOff, visible))
    return deferAt(ctx, STAGE, 'invalid_layout', 'layout');

  const resolved = declared.value.actions.map((action) => {
    const params: Record<string, unknown> = { ...action.params };
    for (const slot of slots)
      if (slot.action === action)
        params[slot.parameter.name] = filled.get(slot);
    return { action, params };
  });
  const unique = keepFirstOfEachKey(resolved, ({ action, params }) =>
    actionKey(action.instanceId, action.action, params),
  );
  for (const { action, params } of unique.dropped)
    ctx.logger.info('jev.duplicate_action_dropped', {
      stage: STAGE,
      instanceId: action.instanceId,
      action: action.action,
      params,
    });

  const candidate: PlannerCandidate = {
    userMessage: completion.userMessage,
    rationale: rationale(decision),
    executionPlan: unique.kept.map(({ action, params }) => ({
      instanceId: action.instanceId,
      action: action.action,
      ...(Object.keys(params).length > 0 && {
        paramsJson: JSON.stringify(params),
      }),
    })),
    layout: {
      tree: tree as readonly TilingNode[],
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
  return ok(candidate);
}

/** The schema of a layout-writing call's output: the tree, and nothing else. */
export const LAYOUT_SCHEMA = z.object({
  tree: z
    .array(z.string().nullable())
    .describe(
      'The tiling tree for the visible instances, as a preorder token array.',
    ),
});

/**
 * Runs one structured-output call over `llm`, honoring `ctx.signal` and
 * turning an already-cancelled signal, a mid-flight abort or a provider
 * failure into a {@link CancellationError} or {@link ProviderError} result
 * instead of a thrown error.
 */
export async function callLlm<T>(
  llm: CompletionLlm,
  prompt: string,
  schema: z.ZodType<T>,
  history: readonly LLMContextMessage[],
  ctx: StageContext,
): Promise<Result<T, CancellationError | ProviderError>> {
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
    return ok(output as T);
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
  const label = handOffInstances
    ? 'you write it, see Layout to write'
    : layoutLabel(decision);
  const base = buildMessagePrompt(decision, slots, label);
  return handOffInstances
    ? [base, '', ...layoutSection(decision, handOffInstances)].join('\n')
    : base;
}

/**
 * The message-only portion of the completion prompt: request, decisions,
 * slots to fill and asks. `layoutLabelText` is what the decisions section
 * says under "Layout:", so a caller that writes the tree with a separate
 * call can describe it in its own words instead of pointing at a "Layout to
 * write" section this prompt does not carry.
 */
export function buildMessagePrompt(
  decision: LayoutDecision,
  slots: readonly Slot[],
  layoutLabelText: string,
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
    ...decisions(decision, layoutLabelText),
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

/** What "Layout:" says in the decisions section and the rationale. */
export function layoutLabel(decision: LayoutDecision): string {
  if (decision.layoutSummary !== undefined) return decision.layoutSummary;
  if (decision.layoutId !== undefined) return decision.layoutId;
  return decision.tree === undefined ? 'written by the LLM' : decision.source;
}
