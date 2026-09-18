import type {
  NormalizedActionEnumEntry,
  Planner,
  PlannerFailure,
  PlannerInvocation,
  PlannerProposal,
  PlanningOperationContext,
} from '@maelstrom-co/engine';
import {
  type ActionParameter,
  err,
  InstanceId,
  isErr,
  MAX_SPLIT_CHILDREN,
  ok,
  type Result,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
  type VesselAction,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_ACTIONS = 2;
const MAX_NEW_PER_VESSEL = 2;
const MAX_CHOICE_OPTIONS = 255;
const MAX_PARAMETER_VALUES = MAX_CHOICE_OPTIONS - 2;
const MAX_UNQUOTED_WORDS = 32;
const MAX_STRING_SPAN_WORDS = 8;
const PROBABILITY_TOTAL_TOLERANCE = 0.02;

/** The server-side fetch contract accepted for test transport injection. */
export type JevFetch = typeof fetch;

/**
 * Optional confidence gate for consumed Jev judgments.
 *
 * Omit this policy to accept valid highest-probability choices. A threshold is
 * intentionally not calibrated by this experimental package.
 */
export interface JevConfidencePolicy {
  /** Defer when a consumed answer's confidence is below this inclusive minimum in [0, 1]. */
  readonly minimum?: number;
}

/** Configuration for the experimental, server-only Jev planner. */
export interface JevPlannerOptions {
  /** TypeSafe credential retained only by this server-side planner instance. */
  readonly apiKey: string;
  /** Pinned TypeSafe model identifier expected in every successful response. */
  readonly model: string;
  /** Trusted server URL receiving the credential; defaults to https://api.typesafe.ai/v1/systemone. */
  readonly endpoint?: string;
  /** Injectable transport for deterministic tests. Defaults to global fetch. */
  readonly fetch?: JevFetch;
  /** Optional, explicitly uncalibrated confidence gate. */
  readonly confidence?: JevConfidencePolicy;
}

interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

interface Evaluation {
  readonly state: unknown;
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
}

interface ChoiceAnswer {
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

interface Reply {
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
}

interface Candidate extends VesselInstanceSnapshot {
  readonly fresh: boolean;
  readonly wasVisible: boolean;
  readonly additionalOrdinal: number;
  readonly ordinalForVessel: number;
}

interface ActionOption {
  readonly instanceId: string;
  readonly action: string;
}

interface Prepared {
  readonly candidates: readonly Candidate[];
  readonly actions: Readonly<Record<string, ActionOption>>;
  readonly actionCriteria: Readonly<Record<string, string>>;
  readonly evaluation: Evaluation;
}

interface SelectedAction {
  readonly candidate: Candidate;
  /** Variant that exposed the selected action after prior transitions. */
  readonly variant: string;
  readonly definition: VesselAction;
}

/**
 * Creates a staged TypeSafe Jev planner for tiling layouts.
 *
 * The planner performs direct server-side HTTP calls only. It never retries,
 * emits prose, or exposes provider failures and response bodies to callers.
 * Configure its engine route with strict finalization and zero repairs.
 * Layout-only turns claim one call, parameterless actions at most two, and
 * parameterized actions at most three. Resize-only turns preserve the tree
 * without calls or actions. Limits of two actions and two new instances per
 * vessel, finite parameter candidates, and fixed arrangements cause deferral.
 *
 * @param options Server-owned credential, pinned model, and optional transport policy.
 * @returns A tiling-only planner that omits userMessage and rationale.
 * @throws If an option is malformed. Credentials are never echoed in the error.
 */
export function createJevPlanner(options: JevPlannerOptions): Planner {
  const config = validateOptions(options);
  return {
    id: 'typesafe-jev',
    supportedLayoutModes: Object.freeze(['tiling']),
    invoke: async (invocation) => {
      try {
        return await invoke(config, invocation);
      } catch (failure) {
        if (failure instanceof LimitError)
          return ok({
            kind: 'deferred',
            reason: 'policy',
            detail: { limit: failure.limit },
          });
        return err({
          kind: 'validation_error',
          message: 'Jev could not compile the planning input',
        });
      }
    },
  };
}

async function invoke(
  config: Readonly<
    Required<Omit<JevPlannerOptions, 'confidence'>> & {
      readonly confidence: number | undefined;
    }
  >,
  invocation: PlannerInvocation,
): Promise<Result<PlannerProposal, PlannerFailure>> {
  const { input, context } = invocation;
  const preflight = controlFailure(context);
  if (preflight !== undefined) return err(preflight);
  if (invocation.phase.kind !== 'initial') {
    return ok({
      kind: 'deferred',
      reason: 'policy',
      detail: { repair: false },
    });
  }
  if (
    input.request.context.layoutMode !== 'tiling' ||
    input.request.layout.type !== 'tiling'
  ) {
    return ok({ kind: 'deferred', reason: 'unsupported_capability' });
  }
  if (isResizeOnly(input.request.context.updateReasons)) {
    return ok({
      kind: 'candidate',
      candidate: { layout: input.request.layout, executionPlan: [] },
    });
  }

  let prepared: Prepared;
  try {
    prepared = prepare(input);
  } catch (failure) {
    return ok({
      kind: 'deferred',
      reason: 'policy',
      detail: {
        limit: failure instanceof LimitError ? failure.limit : 'compiler',
      },
    });
  }

  const first = await ask(config, context, 'layout', prepared.evaluation);
  if (isErr(first)) return first;
  const firstAnswers = new AnswerReader(first.value, config.confidence);
  const scope = firstAnswers.take('scope');
  if (isErr(scope)) return scope;
  if (firstAnswers.deferred)
    return ok({ kind: 'deferred', reason: 'uncertain' });
  if (scope.value !== 'supported')
    return ok({
      kind: 'deferred',
      reason: scope.value === 'ambiguous' ? 'uncertain' : 'policy',
      detail: { stage: 'layout', scope: scope.value },
    });

  const actionCountAnswer = firstAnswers.take('actionCount');
  if (isErr(actionCountAnswer)) return actionCountAnswer;
  if (actionCountAnswer.value === 'overflow')
    return ok({
      kind: 'deferred',
      reason: 'policy',
      detail: { limit: 'actions' },
    });
  const actionCount = Number(actionCountAnswer.value);
  if (
    !Number.isInteger(actionCount) ||
    actionCount < 0 ||
    actionCount > MAX_ACTIONS
  )
    return invalidProviderResponse('Jev returned an invalid action count');

  const newCounts = new Map<string, number>();
  for (const vessel of input.request.vessels) {
    const answer = firstAnswers.take(`create/${vessel.id}`);
    if (isErr(answer)) return answer;
    if (answer.value === 'overflow')
      return ok({
        kind: 'deferred',
        reason: 'policy',
        detail: { limit: 'instances' },
      });
    newCounts.set(vessel.id, Number(answer.value));
  }

  const kept: Candidate[] = [];
  const visible: Candidate[] = [];
  for (const candidate of prepared.candidates) {
    if (candidate.fresh) {
      if (
        candidate.additionalOrdinal <= (newCounts.get(candidate.vesselId) ?? 0)
      ) {
        kept.push(candidate);
        visible.push(candidate);
      }
      continue;
    }
    const answer = firstAnswers.take(`presence/${candidate.instanceId}`);
    if (isErr(answer)) return answer;
    if (answer.value === 'delete') continue;
    kept.push(candidate);
    if (
      answer.value === 'show' ||
      (answer.value === 'unchanged' && candidate.wasVisible)
    )
      visible.push(candidate);
  }

  const arrangement =
    visible.length > 1 ? firstAnswers.take('arrangement') : ok('preserve');
  if (isErr(arrangement)) return arrangement;
  const primary =
    visible.length > 1 && arrangement.value !== 'preserve'
      ? firstAnswers.take('primary')
      : ok('none');
  if (isErr(primary)) return primary;
  if (
    (primary.value !== 'none' &&
      !visible.some((candidate) => candidate.instanceId === primary.value)) ||
    (arrangement.value === 'focus' && primary.value === 'none') ||
    firstAnswers.deferred
  )
    return ok({ kind: 'deferred', reason: 'uncertain' });

  const layout = compileLayout(
    input.request,
    kept,
    visible,
    arrangement.value,
    primary.value,
  );
  if (isErr(layout)) return layout;

  const actions = await selectActions({
    config,
    context,
    input: invocation.input,
    prepared,
    kept,
    actionCount,
  });
  if (isErr(actions)) return actions;
  if ('kind' in actions.value) return ok(actions.value);

  const parameters = await selectParameters({
    config,
    context,
    input: invocation.input,
    selected: actions.value.selected,
  });
  if (isErr(parameters)) return parameters;
  if ('kind' in parameters.value) return ok(parameters.value);

  const afterCompilation = controlFailure(context);
  if (afterCompilation !== undefined) return err(afterCompilation);
  return ok({
    kind: 'candidate',
    candidate: {
      layout: layout.value,
      executionPlan: parameters.value.actions,
    },
  });
}

function prepare(input: PlannerInvocation['input']): Prepared {
  const request = input.request;
  if (request.layout.type !== 'tiling') throw new LimitError('layout');
  const visible = new Set(
    request.layout.tree.map(tilingLeafInstanceId).filter((id) => id !== null),
  );
  const candidates: Candidate[] = request.instances.map((instance) => ({
    ...instance,
    fresh: false,
    wasVisible: visible.has(instance.instanceId),
    additionalOrdinal: 0,
    ordinalForVessel:
      request.instances
        .filter((entry) => entry.vesselId === instance.vesselId)
        .findIndex((entry) => entry.instanceId === instance.instanceId) + 1,
  }));
  for (const vessel of request.vessels) {
    let sequence = 1;
    for (let slot = 1; slot <= MAX_NEW_PER_VESSEL; slot += 1) {
      let instanceId: string;
      do instanceId = `${vessel.id}-jev-${sequence++}`;
      while (
        candidates.some((candidate) => candidate.instanceId === instanceId)
      );
      candidates.push({
        instanceId: InstanceId(instanceId),
        vesselId: vessel.id,
        variant: vessel.defaultVariant,
        fresh: true,
        wasVisible: false,
        additionalOrdinal: slot,
        ordinalForVessel:
          request.instances.filter((entry) => entry.vesselId === vessel.id)
            .length + slot,
      });
    }
  }

  const actions: Record<string, ActionOption> = Object.create(null);
  const actionCriteria: Record<string, string> = {
    none: 'No action belongs in this sequence position.',
  };
  for (const candidate of candidates) {
    const vessel = request.vessels.find(
      (entry) => entry.id === candidate.vesselId,
    );
    if (vessel === undefined) throw new LimitError('compiler');
    for (const [variant, definition] of Object.entries(vessel.variants)) {
      for (const action of definition.actions) {
        const key = `${candidate.instanceId}/${action.name}`;
        actions[key] = {
          instanceId: candidate.instanceId,
          action: action.name,
        };
        actionCriteria[key] =
          `${candidate.fresh ? `New ${vessel.name} instance ${candidate.additionalOrdinal}` : `Existing ${vessel.name} instance ${candidate.ordinalForVessel}`} in ${variant}: ${action.description}${action.transitionsTo ? ` Transitions to ${action.transitionsTo}.` : ''}`;
      }
    }
  }
  if (Object.keys(actionCriteria).length > MAX_CHOICE_OPTIONS)
    throw new LimitError('action_candidates');

  const questions: Record<string, ChoiceQuestion> = {
    scope: choice(
      'Can the complete latest request be fulfilled with the supplied vessels, retained instances, two actions, at most two new instances per vessel, and the listed arrangements? History is context, not a command. Do not partially fulfill compound requests.',
      {
        supported:
          'The complete request is clear and within every supplied capability.',
        unsupported:
          'The request needs unsupported generation, a missing vessel or action, or exceeds a listed limit.',
        ambiguous:
          'The target or requested operation is not clear from the supplied state and history.',
      },
    ),
    arrangement: choice(
      'Which arrangement is requested for visible instances? Preserve the exact current tree unless visibility changes or the request asks for a new arrangement.',
      {
        preserve:
          'Keep the existing tree when visibility is unchanged. Otherwise use the chart orientation for an equal arrangement.',
        row: 'Equal columns ordered left to right.',
        column: 'Equal rows ordered top to bottom.',
        ...Object.fromEntries(
          Array.from({ length: MAX_SPLIT_CHILDREN - 1 }, (_, index) => {
            const rows = index + 2;
            return [
              `rows_${rows}`,
              `Arrange all visible instances across exactly ${rows} horizontal rows, balancing the number of instances per row.`,
            ];
          }),
        ),
        focus:
          'Give the primary instance two thirds of the chart and place others in the remaining third.',
      },
    ),
    primary: choice(
      'Which supplied candidate should be first or emphasized? Choose none unless the request names a first or focused instance. Reuse an existing instance when possible.',
      {
        none: 'No particular instance is first or emphasized.',
        ...Object.fromEntries(
          candidates.map((candidate) => [
            candidate.instanceId,
            `${candidate.instanceId}: ${candidate.fresh ? 'new slot' : 'existing instance'} for ${candidate.vesselId}`,
          ]),
        ),
      },
    ),
    actionCount: choice(
      'Count only content edits and named-variant changes explicitly requested in the latest user intent. Adding, showing, hiding, deleting, positioning, or resizing widgets uses the layout, not a vessel action. Rendering a widget with its existing or default content requires zero actions. Do not count prior history actions or invent an initialization action.',
      {
        '0': 'Only display or arrange widgets using their existing/default content. Examples: show me the weather; add a calendar; hide tasks; put every widget in two rows. No data edit or named-variant change is requested.',
        '1': 'One explicit data edit or named-variant change. Examples: set weather location to Montevideo; check one task; switch weather to the hourly forecast. Merely showing a widget is not an action.',
        '2': 'Two explicit data edits or named-variant changes. Count the edits, not the number of displayed widgets.',
        overflow:
          'Three or more explicit data edits or named-variant changes are requested.',
      },
    ),
  };
  for (const candidate of candidates.filter((entry) => !entry.fresh)) {
    questions[`presence/${candidate.instanceId}`] = choice(
      `Does the latest request change ${candidate.instanceId}, a currently ${candidate.wasVisible ? 'visible' : 'hidden'} ${candidate.vesselId} instance? Preserve unrelated state. Showing only another instance hides this visible instance but does not delete it.`,
      {
        unchanged: `Keep it ${candidate.wasVisible ? 'visible' : 'hidden'} with state retained.`,
        show: 'Make this retained instance visible.',
        hide: 'Hide this retained instance without deleting its state.',
        delete: 'Explicitly delete this instance and its state.',
      },
    );
  }
  for (const vessel of request.vessels) {
    questions[`create/${vessel.id}`] = choice(
      `How many new instances of ${vessel.name} does the latest user intent specifically require? Choose zero if ${vessel.name} is not requested, or if an existing visible or hidden instance can satisfy the request. All available widgets means one of each vessel type, reusing existing instances. Row and column counts describe arrangement, not copies: two rows does not mean two instances of each widget. Speculative slots are options, not requested additions.`,
      {
        '0': `No new ${vessel.name}: it was not requested, or an existing instance already satisfies the request.`,
        '1': `One new ${vessel.name} is needed and no existing instance satisfies it. This is the default count when this type is requested without an explicit number of copies, including all widgets in multiple rows.`,
        '2': `The user explicitly asks for two additional copies of ${vessel.name}. A row/column count or all available widgets is not such a request.`,
        overflow: `The request explicitly requires more than two additional ${vessel.name} instances.`,
      },
    );
  }
  return {
    candidates,
    actions,
    actionCriteria,
    evaluation: {
      state: {
        request,
        history: input.history.structured,
        candidates,
        capabilities: {
          maximumActions: MAX_ACTIONS,
          maximumNewInstancesPerVessel: MAX_NEW_PER_VESSEL,
          arrangements: questions.arrangement.criteria,
          parameterSources:
            'Normalized declared enum values, booleans, numbers, quoted strings, or verbatim contiguous spans of up to eight words from an unquoted request of at most 32 words. No invented or generated values.',
        },
      },
      questions,
    },
  };
}

async function selectActions(input: {
  readonly config: Parameters<typeof ask>[0];
  readonly context: PlanningOperationContext;
  readonly input: PlannerInvocation['input'];
  readonly prepared: Prepared;
  readonly kept: readonly Candidate[];
  readonly actionCount: number;
}): Promise<
  Result<
    | { readonly selected: readonly SelectedAction[] }
    | Extract<PlannerProposal, { readonly kind: 'deferred' }>,
    PlannerFailure
  >
> {
  if (input.actionCount === 0) return ok({ selected: [] });
  const allowed = Object.fromEntries(
    Object.entries(input.prepared.actionCriteria).filter(
      ([key]) =>
        key === 'none' ||
        input.kept.some(
          (candidate) =>
            candidate.instanceId === input.prepared.actions[key]?.instanceId,
        ),
    ),
  );
  if (Object.keys(allowed).length > MAX_CHOICE_OPTIONS)
    return ok({
      kind: 'deferred',
      reason: 'policy',
      detail: { limit: 'action_candidates' },
    });
  const questions: Record<string, ChoiceQuestion> = {};
  for (let step = 0; step < input.actionCount; step += 1) {
    questions[`action/${step}`] = choice(
      `Select action ${step + 1} in requested order. Choose only a retained or code-allocated pending instance. A later action must be valid after earlier variant transitions.`,
      allowed,
    );
  }
  const reply = await ask(input.config, input.context, 'actions', {
    state: {
      request: input.input.request,
      history: input.input.history.structured,
      pendingInstances: input.kept,
      actionCount: input.actionCount,
    },
    questions,
  });
  if (isErr(reply)) return reply;
  const answers = new AnswerReader(reply.value, input.config.confidence);
  const simulated = new Map(
    input.kept.map((candidate) => [candidate.instanceId, candidate.variant]),
  );
  const selected: SelectedAction[] = [];
  let stopped = false;
  for (let step = 0; step < input.actionCount; step += 1) {
    const answer = answers.take(`action/${step}`);
    if (isErr(answer)) return answer;
    if (answer.value === 'none') {
      stopped = true;
      continue;
    }
    if (stopped) return ok({ kind: 'deferred', reason: 'uncertain' });
    const option = input.prepared.actions[answer.value];
    const candidate = input.kept.find(
      (entry) => entry.instanceId === option?.instanceId,
    );
    if (option === undefined || candidate === undefined)
      return ok({ kind: 'deferred', reason: 'uncertain' });
    const vessel = input.input.request.vessels.find(
      (entry) => entry.id === candidate.vesselId,
    );
    const variant = simulated.get(candidate.instanceId);
    const definition =
      variant === undefined
        ? undefined
        : vessel?.variants[variant]?.actions.find(
            (action) => action.name === option.action,
          );
    if (variant === undefined || definition === undefined)
      return ok({ kind: 'deferred', reason: 'uncertain' });
    selected.push({ candidate, variant, definition });
    if (definition.transitionsTo !== undefined)
      simulated.set(candidate.instanceId, definition.transitionsTo);
  }
  if (answers.deferred) return ok({ kind: 'deferred', reason: 'uncertain' });
  return selected.length === input.actionCount
    ? ok({ selected })
    : ok({ kind: 'deferred', reason: 'uncertain' });
}

async function selectParameters(input: {
  readonly config: Parameters<typeof ask>[0];
  readonly context: PlanningOperationContext;
  readonly input: PlannerInvocation['input'];
  readonly selected: readonly SelectedAction[];
}): Promise<
  Result<
    | {
        readonly actions: readonly {
          readonly instanceId: string;
          readonly action: string;
          readonly params?: Record<string, unknown>;
        }[];
      }
    | Extract<PlannerProposal, { readonly kind: 'deferred' }>,
    PlannerFailure
  >
> {
  const intent = input.input.request.context.updateReasons
    .flatMap((reason) => (reason.type === 'user_intent' ? [reason.intent] : []))
    .join('\n');
  const questions: Record<string, ChoiceQuestion> = {};
  const values = new Map<string, readonly unknown[]>();
  for (const [step, selected] of input.selected.entries()) {
    for (const parameter of selected.definition.parameters ?? []) {
      const key = `param/${step}/${parameter.name}`;
      const candidates = parameterValues(
        input.input.actionEnums,
        selected,
        parameter,
        intent,
      );
      if (candidates.length > MAX_PARAMETER_VALUES)
        return ok({
          kind: 'deferred',
          reason: 'policy',
          detail: { limit: 'parameter_candidates' },
        });
      if (candidates.length === 0 && parameter.required !== false)
        return ok({
          kind: 'deferred',
          reason: 'policy',
          detail: {
            limit: 'missing_candidates',
            stage: 'parameters',
            instanceId: selected.candidate.instanceId,
            action: selected.definition.name,
            parameter: parameter.name,
          },
        });
      values.set(key, candidates);
      questions[key] = choice(
        `For selected action ${step + 1}, which supplied value is intended for ${parameter.name}: ${parameter.description}? Choose missing if the requested value is unavailable. Choose omit only when this optional parameter was not requested.`,
        {
          missing: 'The required or intended value is unavailable or unclear.',
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
  }
  if (Object.keys(questions).length === 0)
    return ok({
      actions: input.selected.map((selected) => ({
        instanceId: selected.candidate.instanceId,
        action: selected.definition.name,
      })),
    });
  const reply = await ask(input.config, input.context, 'parameters', {
    state: {
      request: input.input.request,
      history: input.input.history.structured,
      selected: input.selected.map((selected) => ({
        instanceId: selected.candidate.instanceId,
        action: selected.definition,
      })),
    },
    questions,
  });
  if (isErr(reply)) return reply;
  const answers = new AnswerReader(reply.value, input.config.confidence);
  const actions: {
    instanceId: string;
    action: string;
    params?: Record<string, unknown>;
  }[] = [];
  for (const [step, selected] of input.selected.entries()) {
    const params: Record<string, unknown> = Object.create(null);
    for (const parameter of selected.definition.parameters ?? []) {
      const key = `param/${step}/${parameter.name}`;
      const answer = answers.take(key);
      if (isErr(answer)) return answer;
      if (answer.value === 'missing')
        return ok({
          kind: 'deferred',
          reason: 'uncertain',
          detail: {
            stage: 'parameters',
            choice: 'missing',
            instanceId: selected.candidate.instanceId,
            action: selected.definition.name,
            parameter: parameter.name,
          },
        });
      if (answer.value !== 'omit') {
        const value = values.get(key)?.[Number(answer.value.slice(1))];
        if (value === undefined)
          return invalidProviderResponse(
            'Jev selected an unavailable parameter value',
          );
        params[parameter.name] = value;
      }
    }
    actions.push({
      instanceId: selected.candidate.instanceId,
      action: selected.definition.name,
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
  }
  if (answers.deferred) return ok({ kind: 'deferred', reason: 'uncertain' });
  return ok({ actions });
}

function compileLayout(
  request: PlannerInvocation['input']['request'],
  kept: readonly Candidate[],
  visible: readonly Candidate[],
  arrangement: string,
  primary: string,
): Result<unknown, PlannerFailure> {
  if (request.layout.type !== 'tiling')
    return invalidProviderResponse('Jev received a non-tiling request');
  const ordered = [...visible];
  if (primary !== 'none')
    ordered.sort((left, right) =>
      left.instanceId === primary ? -1 : right.instanceId === primary ? 1 : 0,
    );
  const previousVisible = request.layout.tree
    .map(tilingLeafInstanceId)
    .filter((id) => id !== null);
  const sameVisibility =
    previousVisible.length === ordered.length &&
    ordered.every((candidate) =>
      previousVisible.includes(candidate.instanceId),
    );
  const axis =
    arrangement === 'column'
      ? 'H'
      : arrangement === 'row'
        ? 'V'
        : request.context.chartDimensions.columns >=
            request.context.chartDimensions.rows
          ? 'V'
          : 'H';
  const leaves = ordered.map((candidate) =>
    tilingLeafToken(candidate.instanceId),
  );
  let tree: readonly TilingNode[];
  if (arrangement === 'preserve' && sameVisibility) tree = request.layout.tree;
  else if (leaves.length <= 1) tree = leaves;
  else if (arrangement.startsWith('rows_')) {
    const rowCount = Number(arrangement.slice('rows_'.length));
    if (rowCount > leaves.length) throw new LimitError('row_count');
    let offset = 0;
    const rows = Array.from({ length: rowCount }, (_, index) => {
      const count =
        Math.floor(leaves.length / rowCount) +
        (index < leaves.length % rowCount ? 1 : 0);
      const row = split('V', leaves.slice(offset, offset + count));
      offset += count;
      return row;
    });
    tree = [`H:${rows.map(() => 1).join(',')}`, ...rows.flat()];
  } else if (arrangement === 'focus')
    tree = [
      `${axis}:2,1`,
      leaves[0] as TilingNode,
      ...split(axis === 'V' ? 'H' : 'V', leaves.slice(1)),
    ];
  else tree = split(axis, leaves);
  return ok({
    type: 'tiling',
    tree,
    instances: kept.map((candidate) => ({
      instanceId: candidate.instanceId,
      vesselId: candidate.vesselId,
      variant: candidate.variant,
    })),
  });
}

function split(
  axis: 'H' | 'V',
  leaves: readonly TilingNode[],
): readonly TilingNode[] {
  if (leaves.length <= 1) return leaves;
  if (leaves.length > MAX_SPLIT_CHILDREN)
    throw new LimitError('layout_candidates');
  return [`${axis}:${leaves.map(() => 1).join(',')}`, ...leaves];
}

function parameterValues(
  enums: readonly NormalizedActionEnumEntry[],
  selected: SelectedAction,
  parameter: ActionParameter,
  intent: string,
): readonly unknown[] {
  const normalized = enums.find(
    (entry) =>
      entry.vesselId === selected.candidate.vesselId &&
      entry.variant === selected.variant &&
      entry.action === selected.definition.name &&
      entry.parameter === parameter.name,
  );
  if (normalized !== undefined && normalized.values.length > 0)
    return normalized.values;
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
  if (parameter.type === 'string') {
    const quoted = [
      ...new Set(
        Array.from(
          intent.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g),
          (match) => match[1] ?? match[2],
        ),
      ),
    ];
    if (quoted.length > 0) return quoted;
    const words: { start: number; end: number }[] = [];
    for (const match of intent.matchAll(
      /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’.-][\p{L}\p{N}\p{M}]+)*/gu,
    )) {
      if (words.length === MAX_UNQUOTED_WORDS)
        throw new LimitError('unquoted_request_words');
      words.push({ start: match.index, end: match.index + match[0].length });
    }
    const spans = new Set<string>();
    for (let length = 1; length <= MAX_STRING_SPAN_WORDS; length++) {
      for (let start = 0; start + length <= words.length; start++) {
        spans.add(
          intent.slice(words[start].start, words[start + length - 1].end),
        );
      }
    }
    return [...spans];
  }
  return [];
}

async function ask(
  config: Readonly<
    Required<Omit<JevPlannerOptions, 'confidence'>> & {
      readonly confidence: number | undefined;
    }
  >,
  context: PlanningOperationContext,
  stage: string,
  evaluation: Evaluation,
): Promise<Result<Reply, PlannerFailure>> {
  const before = controlFailure(context);
  if (before !== undefined) return err(before);
  const claimed = context.calls.claim({ plannerId: 'typesafe-jev', stage });
  if (isErr(claimed))
    return err({
      kind: 'budget_exhausted',
      message: 'planning call budget exhausted',
    });
  const afterClaim = controlFailure(context);
  if (afterClaim !== undefined) return err(afterClaim);
  let response: Response;
  try {
    response = await config.fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        state: evaluation.state,
        questions: evaluation.questions,
      }),
      signal: context.signal,
    });
  } catch {
    const aborted = controlFailure(context);
    return err(
      aborted ?? { kind: 'provider_error', message: 'Jev request failed' },
    );
  }
  const afterResponse = controlFailure(context);
  if (afterResponse !== undefined) return err(afterResponse);
  if (!response.ok)
    return err({
      kind: 'provider_error',
      message: `Jev returned HTTP ${response.status}`,
    });
  let raw: unknown;
  try {
    raw = JSON.parse(await readBody(response, context));
  } catch {
    const aborted = controlFailure(context);
    return err(
      aborted ?? {
        kind: 'invalid_provider_response',
        message: 'Jev returned an unreadable response',
      },
    );
  }
  const afterBody = controlFailure(context);
  if (afterBody !== undefined) return err(afterBody);
  return validateReply(raw, evaluation, config.model);
}

async function readBody(
  response: Response,
  context: PlanningOperationContext,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES)
    throw new Error('response too large');
  if (response.body === null) throw new Error('response body missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const control = controlFailure(context);
      if (control !== undefined) throw new Error('request aborted');
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('response too large');
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function validateReply(
  raw: unknown,
  evaluation: Evaluation,
  model: string,
): Result<Reply, PlannerFailure> {
  if (
    !isRecord(raw) ||
    raw.model !== model ||
    !isRecord(raw.answers) ||
    !isRecord(raw.usage) ||
    !nonnegativeInteger(raw.usage.input_tokens) ||
    !nonnegativeInteger(raw.usage.output_tokens)
  )
    return invalidProviderResponse('Jev response metadata is invalid');
  const questionIds = Object.keys(evaluation.questions);
  if (!sameKeys(raw.answers, questionIds))
    return invalidProviderResponse('Jev response question IDs are invalid');
  const answers: Record<string, ChoiceAnswer> = Object.create(null);
  for (const id of questionIds) {
    const question = evaluation.questions[id];
    const answer = raw.answers[id];
    if (
      question === undefined ||
      !isRecord(answer) ||
      answer.type !== 'choice' ||
      typeof answer.choice !== 'string' ||
      !finiteProbability(answer.confidence) ||
      !isRecord(answer.probabilities)
    )
      return invalidProviderResponse('Jev response answer is invalid');
    const options = Object.keys(question.criteria);
    if (
      !sameKeys(answer.probabilities, options) ||
      !Object.hasOwn(question.criteria, answer.choice)
    )
      return invalidProviderResponse('Jev response choice is invalid');
    let total = 0;
    let maximum = -1;
    const probabilities: Record<string, number> = Object.create(null);
    for (const option of options) {
      const probability = answer.probabilities[option];
      if (!finiteProbability(probability))
        return invalidProviderResponse(
          'Jev response probabilities are invalid',
        );
      probabilities[option] = probability;
      total += probability;
      maximum = Math.max(maximum, probability);
    }
    if (
      Math.abs(total - 1) > PROBABILITY_TOTAL_TOLERANCE ||
      probabilities[answer.choice] !== maximum
    )
      return invalidProviderResponse('Jev response distribution is invalid');
    answers[id] = {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities,
    };
  }
  return ok({ answers });
}

class AnswerReader {
  readonly #reply: Reply;
  readonly #minimum: number | undefined;
  #deferred = false;

  constructor(reply: Reply, minimum: number | undefined) {
    this.#reply = reply;
    this.#minimum = minimum;
  }

  get deferred(): boolean {
    return this.#deferred;
  }

  take(id: string): Result<string, PlannerFailure> {
    const answer = this.#reply.answers[id];
    if (answer === undefined)
      return invalidProviderResponse('Jev response omitted a consumed answer');
    if (this.#minimum !== undefined && answer.confidence < this.#minimum)
      this.#deferred = true;
    return ok(answer.choice);
  }
}

function controlFailure(
  context: PlanningOperationContext,
): PlannerFailure | undefined {
  if (context.signal.aborted)
    return { kind: 'cancelled', message: 'planning operation cancelled' };
  if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt)
    return { kind: 'timeout', message: 'planning operation timed out' };
  return undefined;
}

function invalidProviderResponse(
  message: string,
): Result<never, PlannerFailure> {
  return err({ kind: 'invalid_provider_response', message });
}
function choice(
  instructions: string,
  criteria: Readonly<Record<string, string>>,
): ChoiceQuestion {
  if (Object.keys(criteria).length > MAX_CHOICE_OPTIONS)
    throw new LimitError('choice_options');
  return { type: 'choice', instructions, criteria };
}
function isResizeOnly(reasons: readonly { readonly type: string }[]): boolean {
  return (
    reasons.length > 0 &&
    reasons.every((reason) => reason.type === 'chart_resize')
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function sameKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(record);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key))
  );
}
function finiteProbability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validateOptions(options: JevPlannerOptions): Readonly<
  Required<Omit<JevPlannerOptions, 'confidence'>> & {
    readonly confidence: number | undefined;
  }
> {
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0)
    throw new Error(
      'Invalid Jev planner option: apiKey must be a non-empty string',
    );
  if (typeof options.model !== 'string' || options.model.length === 0)
    throw new Error(
      'Invalid Jev planner option: model must be a non-empty string',
    );
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  try {
    new URL(endpoint);
  } catch {
    throw new Error('Invalid Jev planner option: endpoint must be a URL');
  }
  if (options.fetch !== undefined && typeof options.fetch !== 'function')
    throw new Error('Invalid Jev planner option: fetch must be a function');
  const minimum = options.confidence?.minimum;
  if (
    minimum !== undefined &&
    (!Number.isFinite(minimum) || minimum < 0 || minimum > 1)
  )
    throw new Error(
      'Invalid Jev planner option: confidence.minimum must be between zero and one',
    );
  return Object.freeze({
    apiKey: options.apiKey,
    model: options.model,
    endpoint,
    fetch: options.fetch ?? fetch,
    confidence: minimum,
  });
}

class LimitError extends Error {
  readonly limit: string;
  constructor(limit: string) {
    super(limit);
    this.limit = limit;
  }
}
