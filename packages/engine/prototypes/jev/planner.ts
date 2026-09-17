import {
  type ActionExecution,
  type ActionParameter,
  type ChartRequest,
  ChartRequestSchema,
  InstanceId,
  MAX_SPLIT_CHILDREN,
  type TilingLayout,
  TilingLayoutSchema,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
  type VesselAction,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { buildActionParameterEnumSnapshot } from '../../src/lib/action-parameter-enum.ts';
import { parseExecutionPlan } from '../../src/lib/response/execution-plan/parse-execution-plan.ts';
import { classifyExecutionTurn } from '../../src/lib/response/execution-plan/turn.ts';
import { healTilingLayout } from '../../src/lib/validation/llm-output/tiling-layout.ts';
import {
  choice,
  type Evaluation,
  type Judge,
  type Question,
  type Reply,
  validateReply,
} from './typesafe.ts';

export interface StructuredPlan {
  layout: TilingLayout;
  executionPlan: readonly ActionExecution[];
}

export interface Trace {
  stage: string;
  request: Evaluation;
  response: Reply;
  elapsedMs: number;
  requestBytes: number;
}

export type Outcome =
  | {
      status: 'planned';
      plan: StructuredPlan;
      traces: Trace[];
      usedConfidence: number | null;
    }
  | {
      status: 'deferred';
      reason: string;
      traces: Trace[];
      usedConfidence: number | null;
    };

export interface PlanningInput {
  request: ChartRequest;
  history?: readonly { intent: string; plan: StructuredPlan }[];
}

interface Candidate extends VesselInstanceSnapshot {
  fresh: boolean;
  wasVisible: boolean;
}

interface ActionOption {
  instanceId: InstanceId;
  name: string;
}

export interface Prepared {
  input: PlanningInput;
  candidates: Candidate[];
  actions: Record<string, ActionOption>;
  evaluation: Evaluation;
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const MAX_ACTIONS = 2;
const MAX_NEW_PER_VESSEL = 2;

export function prepare(input: PlanningInput): Prepared {
  const request = ChartRequestSchema.parse(input.request);
  if (request.layout.type !== 'tiling')
    throw new Error('Prototype supports tiling only.');
  const visible = new Set(request.layout.tree.map(tilingLeafInstanceId));
  const candidates: Candidate[] = request.instances.map((instance) => ({
    ...instance,
    fresh: false,
    wasVisible: visible.has(instance.instanceId),
  }));
  for (const vessel of request.vessels) {
    let sequence = 1;
    for (let slot = 0; slot < MAX_NEW_PER_VESSEL; slot++) {
      let instanceId: InstanceId;
      do {
        instanceId = InstanceId(`${vessel.id}-jev-${sequence++}`);
      } while (
        candidates.some((candidate) => candidate.instanceId === instanceId)
      );
      candidates.push({
        instanceId,
        vesselId: vessel.id,
        variant: vessel.defaultVariant,
        fresh: true,
        wasVisible: false,
      });
    }
  }

  const actions: Record<string, ActionOption> = {};
  const actionCriteria: Record<string, string> = {
    none: 'No action in this position. Stop the sequence.',
  };
  for (const candidate of candidates) {
    const vessel = request.vessels.find((v) => v.id === candidate.vesselId);
    if (!vessel) throw new Error('Missing Vessel');
    for (const [variant, definition] of Object.entries(vessel.variants)) {
      for (const action of definition.actions) {
        const key = `${candidate.instanceId}/${action.name}`;
        actions[key] = { instanceId: candidate.instanceId, name: action.name };
        const description = `${variant}: ${action.description}${action.transitionsTo ? `; changes variant to ${action.transitionsTo}` : ''}.`;
        actionCriteria[key] =
          `${actionCriteria[key] ?? `Instance ${candidate.instanceId} (${vessel.name}). `} ${description}`;
      }
    }
  }
  if (Object.keys(actionCriteria).length > 255)
    throw new Error('Action candidate set exceeds the Choice limit (255).');

  const questions: Record<string, Question> = {
    scope: choice(
      'Can the complete latest request in `request.context.updateReasons` be represented by `request.vessels`, `candidates`, and the action and arrangement limits in `capabilities`? History is context, not a new command. Do not partially satisfy a compound request.',
      {
        supported:
          'The whole request fits these capabilities and its target is clear.',
        unsupported:
          'Needs unavailable content generation, an unknown Vessel/action, more than two actions, more than two new instances of one Vessel, or another arrangement.',
        ambiguous:
          'The intended target or operation cannot be resolved from the supplied state and history.',
      },
    ),
    arrangement: choice(
      'Which arrangement is requested for the visible instances? Preserve the current arrangement unless a layout change is needed or explicitly requested.',
      {
        preserve:
          'Keep the exact existing tree when visibility is unchanged. With changed visibility, use an equal row on a wide Chart or an equal column on a tall Chart.',
        row: 'Equal columns, left to right.',
        column: 'Equal rows, top to bottom.',
        focus:
          'Give the primary instance two thirds of the Chart and put the others in the remaining third.',
      },
    ),
    primary: choice(
      'Which instance should be first or emphasized in the requested arrangement? Select none unless a particular instance needs that position or emphasis. Reuse an existing instance when possible.',
      {
        none: 'No explicit first or emphasized instance.',
        ...Object.fromEntries(
          candidates.map((c) => [
            c.instanceId,
            `${c.instanceId}, Vessel ${c.vesselId}, ${c.fresh ? 'new slot' : 'existing instance'}`,
          ]),
        ),
      },
    ),
  };
  for (const candidate of candidates) {
    questions[`presence/${candidate.instanceId}`] = choice(
      `What should happen to instance ${candidate.instanceId} (Vessel ${candidate.vesselId}, ${candidate.fresh ? 'not created yet' : candidate.wasVisible ? 'currently visible' : 'currently hidden'}) after this request? Keep unrelated existing instances. Reuse existing instances before creating new ones; use new slots in numeric order. For comparisons, allocate distinct instances for distinct subjects.`,
      {
        visible: 'Keep or create this instance and show it.',
        hidden:
          'Keep this existing instance but do not show it. Hiding does not delete state.',
        absent: candidate.fresh
          ? 'Do not create this unused slot.'
          : 'Delete this instance only when explicitly requested.',
      },
    );
  }
  for (let step = 0; step < MAX_ACTIONS; step++) {
    questions[`action/${step}`] = choice(
      `What is action ${step + 1} in the ordered sequence required by the latest request? Consider the requested sequence directly; answers to other questions are unavailable. Use none if there is no action at this position. Do not repeat completed history actions. Layout-only operations do not need actions. Start each new instance in its default variant. Variant changes require actions; later actions must be valid after earlier transitions.`,
      actionCriteria,
    );
  }
  return {
    input: { ...input, request },
    candidates,
    actions,
    evaluation: {
      state: {
        request,
        history: input.history ?? [],
        candidates,
        capabilities: {
          maximumActions: MAX_ACTIONS,
          maximumNewInstancesPerVessel: MAX_NEW_PER_VESSEL,
          arrangements: questions.arrangement.criteria,
          parameterSources:
            'Declared enums, booleans, numeric literals, and double-quoted strings from the latest intent. No generated text or invented values.',
        },
      },
      questions,
    },
  };
}

export function parameterCandidates(
  parameter: ActionParameter,
  intent: string,
): unknown[] {
  if (parameter.enum?.length) return [...parameter.enum];
  if (parameter.type === 'boolean') return [true, false];
  if (parameter.type === 'number') {
    return [
      ...new Set(
        Array.from(
          intent.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g),
          (m) => Number(m[0]),
        ),
      ),
    ];
  }
  if (parameter.type === 'string') {
    return [
      ...new Set(
        Array.from(
          intent.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g),
          (m) => m[1] ?? m[2],
        ),
      ),
    ];
  }
  return [];
}

class Deferred extends Error {}

export async function planWithJev(
  input: PlanningInput,
  judge: Judge,
  minimumConfidence = 0,
): Promise<Outcome> {
  const traces: Trace[] = [];
  const used: number[] = [];
  const use = (reply: Reply, id: string) => {
    const answer = reply.answers[id];
    if (!answer) throw new Error(`Missing answer ${id}`);
    used.push(answer.confidence);
    if (answer.confidence < minimumConfidence)
      throw new Deferred(`low_confidence:${id}`);
    return answer.choice;
  };
  const ask = async (stage: string, evaluation: Evaluation) => {
    const start = performance.now();
    const response = validateReply(evaluation, await judge(evaluation));
    traces.push({
      stage,
      request: evaluation,
      response,
      elapsedMs: performance.now() - start,
      requestBytes: new TextEncoder().encode(JSON.stringify(evaluation))
        .byteLength,
    });
    return response;
  };

  try {
    if (input.request.context.layoutMode !== 'tiling')
      throw new Deferred('unsupported_layout_mode');
    const prepared = prepare(input);
    const { request } = prepared.input;
    if (request.layout.type !== 'tiling')
      throw new Deferred('unsupported_layout_mode');
    // Resize-only turns cannot introduce new semantic intent or repeat content writes.
    if (
      request.context.updateReasons.length > 0 &&
      request.context.updateReasons.every((r) => r.type === 'chart_resize')
    ) {
      return {
        status: 'planned',
        plan: { layout: request.layout, executionPlan: [] },
        traces,
        usedConfidence: null,
      };
    }
    const first = await ask('select', prepared.evaluation);
    const scope = use(first, 'scope');
    if (scope !== 'supported') throw new Deferred(scope);
    const kept: Candidate[] = [];
    const visible: Candidate[] = [];
    for (const candidate of prepared.candidates) {
      const presence = use(first, `presence/${candidate.instanceId}`);
      if (presence === 'absent') continue;
      if (candidate.fresh && presence === 'hidden')
        throw new Deferred('new_hidden_instance');
      kept.push(candidate);
      if (presence === 'visible') visible.push(candidate);
    }

    const simulated = new Map(kept.map((c) => [c.instanceId, c.variant]));
    const selected: { candidate: Candidate; definition: VesselAction }[] = [];
    let stopped = false;
    for (let step = 0; step < MAX_ACTIONS; step++) {
      const key = use(first, `action/${step}`);
      if (key === 'none') {
        stopped = true;
        continue;
      }
      if (stopped) throw new Deferred('action_sequence_gap');
      const option = prepared.actions[key];
      const candidate = kept.find((c) => c.instanceId === option?.instanceId);
      if (!option || !candidate) throw new Deferred('action_target_absent');
      const vessel = request.vessels.find((v) => v.id === candidate.vesselId);
      const variant = simulated.get(candidate.instanceId);
      const definition =
        variant &&
        vessel?.variants[variant]?.actions.find((a) => a.name === option.name);
      if (!definition) throw new Deferred('invalid_action_order');
      selected.push({ candidate, definition });
      if (definition.transitionsTo)
        simulated.set(candidate.instanceId, definition.transitionsTo);
    }

    const intent = request.context.updateReasons
      .flatMap((r) => (r.type === 'user_intent' ? [r.intent] : []))
      .join('\n');
    const parameterQuestions: Record<string, Question> = {};
    const values: Record<string, unknown[]> = {};
    for (const [step, action] of selected.entries()) {
      for (const parameter of action.definition.parameters ?? []) {
        const key = `param/${step}/${parameter.name}`;
        const options = parameterCandidates(parameter, intent);
        if (options.length > 253)
          throw new Deferred('parameter_candidate_limit');
        if (options.length === 0 && parameter.required !== false)
          throw new Deferred(`missing_candidates:${step}/${parameter.name}`);
        values[key] = options;
        parameterQuestions[key] = choice(
          `For selected action ${step + 1}, ${action.definition.name} on ${action.candidate.instanceId}, which value is intended for ${parameter.name}: ${parameter.description}? Choose a supplied value only when it matches the request. missing means a requested value is unavailable; omit means this optional argument was not requested. Never substitute a default for an explicitly requested missing value.`,
          {
            missing:
              'The needed value is absent from the candidates or cannot be determined.',
            ...(parameter.required === false
              ? { omit: 'This optional argument is not requested.' }
              : {}),
            ...Object.fromEntries(
              options.map((value, index) => [
                `v${index}`,
                JSON.stringify(value),
              ]),
            ),
          },
        );
      }
    }
    const parameters = Object.keys(parameterQuestions).length
      ? await ask('arguments', {
          state: {
            request,
            history: input.history ?? [],
            selected: selected.map((s) => ({
              instanceId: s.candidate.instanceId,
              action: s.definition,
            })),
          },
          questions: parameterQuestions,
        })
      : undefined;
    const rawActions = selected.map((action, step) => {
      const params: Record<string, unknown> = {};
      for (const parameter of action.definition.parameters ?? []) {
        const key = `param/${step}/${parameter.name}`;
        if (!parameters) throw new Error('Missing parameter answers');
        const answer = use(parameters, key);
        if (answer === 'missing')
          throw new Deferred(`missing_value:${step}/${parameter.name}`);
        if (answer !== 'omit')
          params[parameter.name] = values[key][Number(answer.slice(1))];
      }
      return {
        instanceId: action.candidate.instanceId,
        action: action.definition.name,
        ...(Object.keys(params).length
          ? { paramsJson: JSON.stringify(params) }
          : {}),
      };
    });

    const arrangement =
      visible.length > 1 ? use(first, 'arrangement') : 'preserve';
    const primary =
      visible.length > 1 && arrangement !== 'preserve'
        ? use(first, 'primary')
        : 'none';
    if (primary !== 'none' && !visible.some((c) => c.instanceId === primary))
      throw new Deferred('primary_not_visible');
    if (arrangement === 'focus' && primary === 'none')
      throw new Deferred('focus_needs_primary');
    if (primary !== 'none')
      visible.sort((a, b) =>
        a.instanceId === primary ? -1 : b.instanceId === primary ? 1 : 0,
      );
    const previousVisible = request.layout.tree
      .map(tilingLeafInstanceId)
      .filter((id) => id !== null);
    const sameVisibility =
      previousVisible.length === visible.length &&
      visible.every((c) => previousVisible.includes(c.instanceId));
    const axis =
      arrangement === 'column'
        ? 'H'
        : arrangement === 'row'
          ? 'V'
          : request.context.chartDimensions.columns >=
              request.context.chartDimensions.rows
            ? 'V'
            : 'H';
    const leaves = visible.map((c) => tilingLeafToken(c.instanceId));
    let tree: TilingNode[];
    if (arrangement === 'preserve' && sameVisibility)
      tree = [...request.layout.tree];
    else if (leaves.length <= 1) tree = leaves;
    else if (arrangement === 'focus')
      tree = [
        `${axis}:2,1`,
        leaves[0],
        ...split(axis === 'V' ? 'H' : 'V', leaves.slice(1)),
      ];
    else tree = split(axis, leaves);

    const instances = kept.map(({ instanceId, vesselId, variant }) => ({
      instanceId,
      vesselId,
      variant,
    }));
    const layout = {
      type: 'tiling' as const,
      ...TilingLayoutSchema.parse({ tree, instances }),
    };
    const healed = healTilingLayout(
      { layout, executionPlan: rawActions, userMessage: '', rationale: '' },
      request,
    );
    if (
      healed.droppedEntries.length ||
      healed.warnings.some((w) => w.kind !== 'missing_rationale')
    )
      throw new Deferred('layout_requires_healing');
    const parsed = parseExecutionPlan(rawActions, {
      instances,
      vessels: request.vessels,
      enumSnapshot: buildActionParameterEnumSnapshot(request.vessels),
      turn: classifyExecutionTurn(request),
      logger: silentLogger,
    });
    if (parsed.skippedActions.length)
      throw new Deferred(
        `invalid_actions:${parsed.skippedActions.map((a) => a.reason).join(',')}`,
      );
    return {
      status: 'planned',
      plan: { layout, executionPlan: parsed.plan },
      traces,
      usedConfidence: used.length ? Math.min(...used) : null,
    };
  } catch (error) {
    if (!(error instanceof Deferred)) throw error;
    return {
      status: 'deferred',
      reason: error.message,
      traces,
      usedConfidence: used.length ? Math.min(...used) : null,
    };
  }
}

function split(axis: 'H' | 'V', leaves: TilingNode[]): TilingNode[] {
  if (leaves.length <= 1) return leaves;
  if (leaves.length > MAX_SPLIT_CHILDREN)
    throw new Deferred('layout_candidate_limit');
  return [`${axis}:${leaves.map(() => 1).join(',')}`, ...leaves];
}
