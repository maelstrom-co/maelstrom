import type { PlanningInput, Stage } from '@maelstrom-co/engine';
import {
  actionPlanOf,
  type GateAnswer,
  type ParameterAsk,
  type PendingParameter,
  type PlannedAction,
  type SelectedInstance,
  type Selection2,
  type SelectionGates,
} from '@maelstrom-co/planner-jev/_internal';
import {
  ActionName,
  type ChartRequest,
  getVisibleInstanceIds,
  InstanceId,
  ok,
  VariantName,
  type VesselActionDefinition,
  VesselId,
} from '@maelstrom-co/protocol';
import type { StageReplacements } from '../eval/instrument.js';
import type { ReplayShape } from '../eval/replay.js';
import type { Scenario } from '../eval/scenarios.js';
import { expectedRetained } from '../eval/score.js';

/**
 * The select and actions stage outputs a scenario's expectation implies,
 * or why the expectation cannot form them.
 */
export type GoldInputs =
  | { readonly applicable: true; readonly stages: StageReplacements }
  | { readonly applicable: false; readonly reason: string };

/**
 * Replacements for `jevSelect` and `jevActions` that return the scenario's
 * expected selection and action plan, so the layout stage sees perfect
 * inputs. `shape` decides the gates: a `gated` arm gets all three, with
 * `needsActions` yes when any action is expected, `generatedContent` no
 * (a yes defers before layout) and `spatial` yes only for a scenario tagged
 * spatial; other shapes get none. Not applicable to an expected deferral,
 * an expectation without a visible set or actions, a new Instance id that
 * names no Vessel, or an action whose required parameter has no expected
 * value.
 */
export function goldInputs(
  scenario: Scenario,
  shape: ReplayShape = 'gated',
): GoldInputs {
  const { expected } = scenario;
  if (expected.status !== 'planned')
    return { applicable: false, reason: 'expects a deferral' };
  if (expected.visible === undefined)
    return { applicable: false, reason: 'states no visible set' };
  if (expected.actions === undefined)
    return { applicable: false, reason: 'states no actions' };
  const instances = goldInstances(scenario);
  if (typeof instances === 'string')
    return { applicable: false, reason: instances };
  const actions = goldActions(scenario, instances);
  if (typeof actions === 'string')
    return { applicable: false, reason: actions };
  const asks = goldAsks(scenario, instances);
  if (typeof asks === 'string') return { applicable: false, reason: asks };
  const gates = shape === 'gated' ? goldGates(scenario) : undefined;
  const select: Stage<PlanningInput, Selection2> = async (input) =>
    ok({
      input,
      instances,
      answers: [],
      ...(gates && { gates }),
    });
  const plan: Stage<Selection2, unknown> = async (selection) =>
    ok(actionPlanOf(selection, actions, asks, []));
  return {
    applicable: true,
    stages: {
      jevSelect: select as Stage<unknown, unknown>,
      jevActions: plan as Stage<unknown, unknown>,
    },
  };
}

/**
 * Gold inputs for a scenario that expects the layout stage to defer: the
 * board kept as it is (every Instance in the current tree kept, the rest
 * hidden), no actions, and the gated arm's gates with `needsActions` no
 * and `spatial` from the scenario's tag. Not applicable to any other
 * scenario.
 */
export function layoutDeferralGoldInputs(
  scenario: Scenario,
  shape: ReplayShape = 'gated',
): GoldInputs {
  const { expected, request } = scenario;
  if (expected.status !== 'deferred' || expected.deferStage !== 'jevLayout')
    return { applicable: false, reason: 'expects no layout stage deferral' };
  const current = getVisibleInstanceIds(request.layout);
  const instances: SelectedInstance[] = request.instances.map((instance) => {
    const visible = current.has(instance.instanceId);
    return {
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
      visible,
      fresh: false,
      decision: visible ? 'keep' : 'hide',
    };
  });
  const gates =
    shape === 'gated'
      ? {
          needsActions: gate(false),
          generatedContent: gate(false),
          spatial: gate(scenario.spatial === true),
        }
      : undefined;
  const select: Stage<PlanningInput, Selection2> = async (input) =>
    ok({ input, instances, answers: [], ...(gates && { gates }) });
  const plan: Stage<Selection2, unknown> = async (selection) =>
    ok(actionPlanOf(selection, [], [], []));
  return {
    applicable: true,
    stages: {
      jevSelect: select as Stage<unknown, unknown>,
      jevActions: plan as Stage<unknown, unknown>,
    },
  };
}

/** The gates a gated select stage would answer for `scenario` if it answered right. */
export function goldGates(scenario: Scenario): Required<SelectionGates> {
  return {
    needsActions: gate((scenario.expected.actions?.length ?? 0) > 0),
    generatedContent: gate(false),
    spatial: gate(scenario.spatial === true),
  };
}

function gate(yes: boolean): GateAnswer {
  return {
    answer: yes ? 'yes' : 'no',
    probability: yes ? 1 : 0,
    confidence: 1,
  };
}

function goldInstances(
  scenario: Scenario,
): readonly SelectedInstance[] | string {
  const { expected, request } = scenario;
  const visible = new Set(expected.visible ?? []);
  const retained = new Set(expectedRetained(scenario));
  const existing = new Set<string>(
    request.instances.map((instance) => instance.instanceId),
  );
  const selected: SelectedInstance[] = request.instances.map((instance) => {
    const decision = !retained.has(instance.instanceId)
      ? 'delete'
      : visible.has(instance.instanceId)
        ? 'keep'
        : 'hide';
    return {
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
      visible: decision === 'keep',
      fresh: false,
      decision,
    };
  });
  for (const id of [...retained].filter((id) => !existing.has(id))) {
    const vessel = request.vessels.find((candidate) =>
      id.startsWith(`${candidate.id}-`),
    );
    if (vessel === undefined) return `new Instance ${id} names no Vessel`;
    selected.push({
      instanceId: InstanceId(id),
      vesselId: VesselId(vessel.id),
      variant: VariantName(vessel.defaultVariant),
      visible: visible.has(id),
      fresh: true,
      decision: 'create',
    });
  }
  return selected;
}

function goldActions(
  scenario: Scenario,
  instances: readonly SelectedInstance[],
): readonly PlannedAction[] | string {
  const planned: PlannedAction[] = [];
  for (const action of scenario.expected.actions ?? []) {
    const definition = actionDefinition(
      scenario.request,
      instances,
      action.instanceId,
      action.action,
    );
    if (definition === undefined)
      return `action ${action.instanceId}.${action.action} is not declared`;
    const params = action.params ?? {};
    const missing = (definition.parameters ?? []).find(
      (parameter) => parameter.required && !(parameter.name in params),
    );
    if (missing)
      return `action ${action.instanceId}.${action.action} has no expected ${missing.name}`;
    planned.push({
      instanceId: InstanceId(action.instanceId),
      action: ActionName(action.action),
      params,
      pending: [],
    });
  }
  return planned;
}

function goldAsks(
  scenario: Scenario,
  instances: readonly SelectedInstance[],
): readonly ParameterAsk[] | string {
  const asks: ParameterAsk[] = [];
  for (const ask of scenario.expected.asks ?? []) {
    const parameter = actionDefinition(
      scenario.request,
      instances,
      ask.instanceId,
      ask.action,
    )?.parameters?.find((candidate) => candidate.name === ask.parameter);
    if (parameter === undefined)
      return `ask ${ask.instanceId}.${ask.action}.${ask.parameter} is not declared`;
    const pending: PendingParameter = {
      name: parameter.name,
      type: parameter.type,
      description: parameter.description,
      ...(parameter.enum !== undefined && { enum: parameter.enum }),
    };
    asks.push({
      instanceId: InstanceId(ask.instanceId),
      action: ActionName(ask.action),
      parameter: pending,
    });
  }
  return asks;
}

function actionDefinition(
  request: ChartRequest,
  instances: readonly SelectedInstance[],
  instanceId: string,
  action: string,
): VesselActionDefinition | undefined {
  const vesselId = instances.find(
    (instance) => instance.instanceId === instanceId,
  )?.vesselId;
  const vessel = request.vessels.find((candidate) => candidate.id === vesselId);
  return Object.values(vessel?.variants ?? {})
    .flatMap((variant) => variant.actions)
    .find((candidate) => candidate.name === action);
}
