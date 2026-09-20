import type {
  NormalizedActionEnumEntry,
  PlannerCandidate,
  PlanningDeferralReason,
  PlanningInput,
} from '@maelstrom-co/engine';
import {
  type ActionParameter,
  InstanceId,
  tilingLeafInstanceId,
  VariantName,
  type VesselAction,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { layoutChoices } from './layouts.js';

export const MAX_CHOICES = 255;
const MAX_ACTIONS = 4;
const MAX_NEW_PER_VESSEL = 2;

export interface Question {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}
export interface Evaluation {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, Question>>;
}
export interface Reply {
  readonly answers: Readonly<
    Record<string, { readonly choice: string; readonly confidence: number }>
  >;
}
type Decide = (stage: string, evaluation: Evaluation) => Promise<Reply>;
type Detail = Readonly<Record<string, string | number | boolean>>;
export class PlanningDeferral extends Error {
  constructor(
    readonly reason: PlanningDeferralReason,
    readonly detail: Detail,
  ) {
    super(reason);
  }
}
function defer(reason: PlanningDeferralReason, detail: Detail): never {
  throw new PlanningDeferral(reason, detail);
}
function choice(
  instructions: string,
  criteria: Readonly<Record<string, string>>,
): Question {
  if (Object.keys(criteria).length > MAX_CHOICES)
    defer('policy', { limit: 'choice_options' });
  return { type: 'choice', instructions, criteria };
}
interface Selected extends VesselInstanceSnapshot {
  readonly fresh: boolean;
  readonly visible: boolean;
  readonly desiredVariant?: ReturnType<typeof VariantName>;
}
interface SelectedAction {
  readonly instance: Selected;
  readonly variant: ReturnType<typeof VariantName>;
  readonly definition: VesselAction;
}

export async function planPhases(
  input: PlanningInput,
  decide: Decide,
  minimum?: number,
): Promise<PlannerCandidate> {
  const request = input.request;
  if (request.layout.type !== 'tiling')
    return defer('unsupported_capability', { stage: 'selection' });
  const read = (reply: Reply, id: string, stage: string) => {
    const answer = reply.answers[id];
    if (!answer) return defer('uncertain', { stage, question: id });
    if (minimum !== undefined && answer.confidence < minimum)
      return defer('uncertain', { stage, question: id, limit: 'confidence' });
    return answer.choice;
  };
  const visibleIds = new Set(
    request.layout.tree.map(tilingLeafInstanceId).filter((id) => id !== null),
  );
  const candidates: Selected[] = request.instances.map((instance) => ({
    ...instance,
    fresh: false,
    visible: visibleIds.has(instance.instanceId),
  }));
  for (const vessel of request.vessels) {
    let serial = 1;
    for (let slot = 0; slot < MAX_NEW_PER_VESSEL; slot++) {
      let id: ReturnType<typeof InstanceId>;
      do id = InstanceId(`${vessel.id}-jev-${serial++}`);
      while (candidates.some((candidate) => candidate.instanceId === id));
      candidates.push({
        instanceId: id,
        vesselId: vessel.id,
        variant: vessel.defaultVariant,
        fresh: true,
        visible: false,
      });
    }
  }
  const questions: Record<string, Question> = {
    scope: choice(
      'Can the complete latest intent be satisfied using these vessels, selectable views, and their registered actions? Displaying default content needs no data action. Do not invent content or partially satisfy an unsupported compound request.',
      {
        supported: 'The complete request is clear and supported.',
        unsupported:
          'A requested capability, generated content, or required target is unavailable.',
        ambiguous: 'The intended target or operation is genuinely unclear.',
      },
    ),
  };
  const newSets: Record<
    string,
    Record<string, readonly Selected[]>
  > = Object.create(null);
  for (const candidate of candidates) {
    if (candidate.fresh) continue;
    const vessel = request.vessels.find((v) => v.id === candidate.vesselId);
    if (!vessel) return defer('policy', { limit: 'catalog' });
    const variants = Object.fromEntries(
      Object.entries(vessel.variants).map(([name, variant]) => [
        `show/${name}`,
        `Show ${candidate.instanceId} as ${name}. ${name === vessel.defaultVariant ? 'This is the default view; use it when this widget is requested without a different named view.' : ''} ${variant.description ?? `The ${name} view of ${vessel.name}.`} This selects a desired view, not a data edit.`,
      ]),
    );
    questions[`view/${candidate.instanceId}`] = choice(
      `Select the next visibility and view of ${candidate.instanceId}, currently ${candidate.visible ? 'visible' : 'hidden'} in ${candidate.variant}. Keep unrelated instances unchanged. Hiding retains state; deleting removes it. The layout applies the selected view before content actions run.`,
      {
        keep: `Retain this instance with its current visibility and variant.`,
        hide: 'Keep the instance and its state but hide it.',
        delete: 'Explicitly delete this instance and its state.',
        ...variants,
      },
    );
  }
  for (const vessel of request.vessels) {
    const variantCount = Object.keys(vessel.variants).length;
    if (1 + variantCount + variantCount * variantCount > MAX_CHOICES)
      return defer('policy', { stage: 'selection', limit: 'choice_options' });
    const slots = candidates.filter(
      (candidate) => candidate.fresh && candidate.vesselId === vessel.id,
    );
    const sets: Record<string, readonly Selected[]> = Object.create(null);
    const criteria: Record<string, string> = {
      none: `No new ${vessel.name}. This type was not requested, or an existing visible or hidden instance satisfies the request.`,
    };
    sets.none = [];
    for (const variant of Object.keys(vessel.variants)) {
      const key = `one/${variant}`;
      sets[key] = [
        { ...slots[0], visible: true, desiredVariant: VariantName(variant) },
      ];
      criteria[key] =
        `Create ONE ${vessel.name} in ${variant}${variant === vessel.defaultVariant ? ' (the default view for ordinary display requests)' : ''}. Use when one new instance of this type is requested and no existing instance satisfies it.`;
      for (const second of Object.keys(vessel.variants)) {
        const pair = JSON.stringify([variant, second]);
        sets[pair] = [
          { ...slots[0], visible: true, desiredVariant: VariantName(variant) },
          { ...slots[1], visible: true, desiredVariant: VariantName(second) },
        ];
        criteria[pair] =
          `Create TWO additional ${vessel.name} instances: ${variant} and ${second}. Only for an explicit request for two copies of this type. A row count or all available widgets does not request duplicates.`;
      }
    }
    newSets[vessel.id] = sets;
    questions[`new/${vessel.id}`] = choice(
      `Select the complete set of NEW ${vessel.name} instances needed by the latest intent. There are ${request.instances.filter((instance) => instance.vesselId === vessel.id).length} actual existing instances of this type. Reuse those first. Choose none for an unrequested type. All available widgets means one of each type. Layout rows/columns are not instance copies.`,
      criteria,
    );
  }
  const selection = await decide('selection', {
    state: {
      intent: request.context.updateReasons,
      currentLayout: request.layout,
      availableVessels: request.vessels,
      history: input.history.structured,
      currentInstances: candidates.filter((candidate) => !candidate.fresh),
      newInstanceSets: newSets,
    },
    questions,
  });
  const scope = read(selection, 'scope', 'selection');
  if (scope !== 'supported')
    return defer(scope === 'ambiguous' ? 'uncertain' : 'policy', {
      stage: 'selection',
      scope,
    });
  const selected: Selected[] = [];
  for (const candidate of candidates) {
    if (candidate.fresh) continue;
    const value = read(selection, `view/${candidate.instanceId}`, 'selection');
    if (value === 'delete') continue;
    selected.push({
      ...candidate,
      variant: value.startsWith('show/')
        ? VariantName(value.slice(5))
        : candidate.variant,
      visible: value === 'keep' ? candidate.visible : value !== 'hide',
      ...(value.startsWith('show/')
        ? { desiredVariant: VariantName(value.slice(5)) }
        : {}),
    });
  }
  for (const vessel of request.vessels) {
    const answer = read(selection, `new/${vessel.id}`, 'selection');
    selected.push(
      ...newSets[vessel.id][answer].map((instance) => ({
        ...instance,
        variant: instance.desiredVariant ?? instance.variant,
      })),
    );
  }
  const visible = selected.filter((instance) => instance.visible);
  const targetViews = visible.map((instance) => ({
    ...instance,
    variant: instance.desiredVariant ?? instance.variant,
  }));
  const layouts = layoutChoices(request, targetViews);
  if (!layouts.length)
    return defer('policy', {
      stage: 'layout',
      limit: 'no_feasible_layout',
      visibleInstances: visible.length,
      columns: request.context.chartDimensions.columns,
      rows: request.context.chartDimensions.rows,
    });
  let layout = layouts[0];
  if (visible.length > 0) {
    const reply = await decide('layout', {
      state: {
        intent: request.context.updateReasons,
        dimensions: request.context.chartDimensions,
        views: targetViews,
        history: input.history.structured,
      },
      questions: {
        layout: choice(
          'Arrange exactly these already-selected visible instances. If the user gave no spatial preference, choose preserve when offered, otherwise choose a simple balanced layout such as row or rows_2. Adding/showing a widget is valid without a spatial preference. All offered layouts already fit the instance count and minimum sizes. Choose unavailable only when an EXPLICIT requested spatial constraint cannot be met by any offered layout. Do not reconsider which instances should be visible.',
          {
            ...Object.fromEntries(
              layouts.map((option) => [option.id, option.description]),
            ),
            unavailable:
              'An explicit spatial request (such as a specified row count or relative position) cannot be satisfied by any candidate. Never choose this merely because no arrangement was specified.',
          },
        ),
      },
    });
    const id = read(reply, 'layout', 'layout');
    if (id === 'unavailable')
      return defer('policy', {
        stage: 'layout',
        limit: 'requested_layout_unavailable',
      });
    layout =
      layouts.find((option) => option.id === id) ??
      defer('uncertain', { stage: 'layout' });
  }
  const executionPlan: CompiledAction[] = [];
  for (let step = 0; ; step++) {
    const availableActions: {
      key: string;
      instanceId: string;
      action: string;
      selected: SelectedAction;
    }[] = [];
    for (const instance of selected) {
      const variant = instance.variant;
      const vessel = request.vessels.find((v) => v.id === instance.vesselId);
      for (const definition of vessel?.variants[variant]?.actions ?? []) {
        if (definition.transitionsTo && definition.transitionsTo !== variant)
          continue;
        availableActions.push({
          key: `a${availableActions.length}`,
          instanceId: instance.instanceId,
          action: definition.name,
          selected: { instance, variant, definition },
        });
      }
    }
    const criteria: Record<string, string> = {
      done: 'The selected views already satisfy the display request and all requested content edits are planned. Displaying or arranging widgets using their default/existing content requires no action.',
      unsupported:
        'A remaining requested content edit or view change cannot be performed with these available actions.',
    };
    for (const option of availableActions)
      criteria[option.key] =
        `${option.instanceId}, currently ${option.selected.variant}: ${option.action} — ${option.selected.definition.description}${option.selected.definition.transitionsTo ? ` Ends in ${option.selected.definition.transitionsTo}.` : ''}`;
    const reply = await decide('actions', {
      state: {
        intent: request.context.updateReasons,
        history: input.history.structured,
        instances: selected,
        previousActions: executionPlan,
        availableActions: availableActions.map(
          ({ key, instanceId, action }) => ({ key, instanceId, action }),
        ),
      },
      questions: {
        [`action/${step}`]: choice(
          'Choose the next remaining content edit within the selected views. The layout already changes displayed variants; do not request a separate view transition. previousActions are ALREADY included in the plan with their exact parameters; do not schedule them again unless the user explicitly requested repetition. Choose done when the selected views and planned content operations satisfy the intent. Preserve hidden state unless a content edit explicitly targets it.',
          criteria,
        ),
      },
    });
    const answer = read(reply, `action/${step}`, 'actions');
    if (answer === 'done') break;
    if (answer === 'unsupported')
      return defer('policy', { stage: 'actions', limit: 'unavailable_action' });
    if (step === MAX_ACTIONS)
      return defer('policy', { stage: 'actions', limit: 'actions' });
    const action = availableActions.find(
      (option) => option.key === answer,
    )?.selected;
    if (!action) return defer('uncertain', { stage: 'actions' });
    executionPlan.push(
      await bindParameters(input, action, step, executionPlan, decide, read),
    );
  }
  return {
    layout: {
      type: 'tiling',
      tree: layout.tree,
      instances: selected.map(({ instanceId, vesselId, variant }) => ({
        instanceId,
        vesselId,
        variant,
      })),
    },
    executionPlan,
  };
}

interface CompiledAction {
  readonly instanceId: string;
  readonly action: string;
  readonly params?: Record<string, unknown>;
}
async function bindParameters(
  input: PlanningInput,
  action: SelectedAction,
  step: number,
  previousActions: readonly CompiledAction[],
  decide: Decide,
  read: (reply: Reply, id: string, stage: string) => string,
): Promise<CompiledAction> {
  const request = input.request;
  const parameters: Record<string, Question> = {};
  const values = new Map<string, readonly unknown[]>();
  const intent = request.context.updateReasons
    .flatMap((reason) => (reason.type === 'user_intent' ? [reason.intent] : []))
    .join('\n');
  for (const parameter of action.definition.parameters ?? []) {
    const id = `param/${step}/${parameter.name}`;
    const candidates = parameterValues(
      input.actionEnums,
      action,
      parameter,
      intent,
    );
    if (candidates.length > 253)
      return defer('policy', {
        stage: 'parameters',
        limit: 'parameter_candidates',
      });
    if (!candidates.length && parameter.required !== false)
      return defer('policy', {
        stage: 'parameters',
        limit: 'missing_candidates',
        instanceId: action.instance.instanceId,
        action: action.definition.name,
        parameter: parameter.name,
      });
    values.set(id, candidates);
    parameters[id] = choice(
      `For action ${step + 1}, ${action.definition.name} on ${action.instance.instanceId}, select the intended value of ${parameter.name}: ${parameter.description}. Copy only a supplied value. Choose missing if the intended value is unavailable.`,
      {
        missing: 'The intended value is unavailable or unclear.',
        ...(parameter.required === false
          ? { omit: 'This optional parameter was not requested.' }
          : {}),
        ...Object.fromEntries(
          candidates.map((value, index) => [
            `v${index}`,
            JSON.stringify(value),
          ]),
        ),
      },
    );
  }
  const parameterReply = Object.keys(parameters).length
    ? await decide('parameters', {
        state: {
          intent: request.context.updateReasons,
          history: input.history.structured,
          previousActions,
          selectedActions: [
            {
              instanceId: action.instance.instanceId,
              variant: action.variant,
              action: action.definition,
            },
          ],
        },
        questions: parameters,
      })
    : undefined;
  const params: Record<string, unknown> = Object.create(null);
  for (const parameter of action.definition.parameters ?? []) {
    const id = `param/${step}/${parameter.name}`;
    const answer = read(parameterReply as Reply, id, 'parameters');
    if (answer === 'missing')
      return defer('uncertain', {
        stage: 'parameters',
        choice: 'missing',
        instanceId: action.instance.instanceId,
        action: action.definition.name,
        parameter: parameter.name,
      });
    if (answer !== 'omit')
      params[parameter.name] = values.get(id)?.[Number(answer.slice(1))];
  }
  return {
    instanceId: action.instance.instanceId,
    action: action.definition.name,
    ...(Object.keys(params).length ? { params } : {}),
  };
}

function parameterValues(
  enums: readonly NormalizedActionEnumEntry[],
  action: SelectedAction,
  parameter: ActionParameter,
  intent: string,
): readonly unknown[] {
  const normalized = enums.find(
    (entry) =>
      entry.vesselId === action.instance.vesselId &&
      entry.variant === action.variant &&
      entry.action === action.definition.name &&
      entry.parameter === parameter.name,
  );
  if (normalized?.values.length) return normalized.values;
  if (parameter.type === 'boolean') return [true, false];
  if (parameter.type === 'number')
    return [
      ...new Set(
        Array.from(
          intent.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g),
          (match) => Number(match[0]),
        ),
      ),
    ];
  if (parameter.type !== 'string') return [];
  const quoted = [
    ...new Set(
      Array.from(
        intent.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g),
        (match) => match[1] ?? match[2],
      ),
    ),
  ];
  if (quoted.length) return quoted;
  const words: { start: number; end: number }[] = [];
  for (const match of intent.matchAll(
    /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’.-][\p{L}\p{N}\p{M}]+)*/gu,
  )) {
    if (words.length === 32)
      return defer('policy', { limit: 'unquoted_request_words' });
    words.push({ start: match.index, end: match.index + match[0].length });
  }
  const spans = new Set<string>();
  for (let length = 1; length <= 8; length++)
    for (let start = 0; start + length <= words.length; start++)
      spans.add(
        intent.slice(words[start].start, words[start + length - 1].end),
      );
  return [...spans];
}
