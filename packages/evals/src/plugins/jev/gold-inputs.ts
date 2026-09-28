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
import type { StageReplacements } from '../../core/instrument.js';
import type { Scenario } from '../../core/scenarios.js';
import { expectedRetained } from '../../core/score.js';
import type { ReplayShape } from './arms.js';

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
  if (expected.status !== 'deferred' || expected.deferStage !== 'layout')
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
          dependsOnScreen: gate(false),
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

/**
 * The gates a gated select stage would answer for `scenario` if it
 * answered right: an explicit `expectedGates` entry, else `needsActions`
 * yes when any action is expected, `generatedContent` no and `spatial`
 * from the scenario's tag, `dependsOnScreen` no. `needsActions` counts
 * expected actions only, not asks or unlisted parameters, unlike
 * {@link expectedGateAnswers}.
 */
export function goldGates(scenario: Scenario): Required<SelectionGates> {
  const explicit = scenario.expected.expectedGates ?? {};
  const expected = expectedGateAnswers(scenario);
  return {
    needsActions: gateOr(
      explicit.needsActions,
      (scenario.expected.actions?.length ?? 0) > 0,
    ),
    generatedContent: gateOr(expected.generatedContent, false),
    spatial: gateOr(expected.spatial, scenario.spatial === true),
    dependsOnScreen: gateOr(expected.dependsOnScreen, false),
  };
}

/**
 * The answer a gated select stage should give per gate for `scenario`,
 * leaving out every gate the scenario does not settle. An explicit
 * `expectedGates` entry wins, for any gate name. Otherwise
 * `needsActions` is yes when a planned scenario expects an action, an ask
 * or a parameter with no listed match, and no when it states its actions
 * and all are empty; `spatial` follows the spatial tag; `generatedContent`
 * and `dependsOnScreen` are no for a planned scenario.
 */
export function expectedGateAnswers(
  scenario: Scenario,
): Readonly<Record<string, 'yes' | 'no'>> {
  const { expected } = scenario;
  const derived: Record<string, 'yes' | 'no'> = {};
  if (expected.status === 'planned') {
    const expectsWork =
      (expected.actions?.length ?? 0) > 0 ||
      (expected.asks?.length ?? 0) > 0 ||
      (expected.noListedMatch?.length ?? 0) > 0;
    if (expectsWork) derived.needsActions = 'yes';
    else if (expected.actions !== undefined) derived.needsActions = 'no';
    derived.generatedContent = 'no';
    derived.dependsOnScreen = 'no';
  }
  if (scenario.spatial !== undefined)
    derived.spatial = scenario.spatial ? 'yes' : 'no';
  return { ...derived, ...expected.expectedGates };
}

/** The selection a scenario's expectation implies, or why the expectation cannot form it. */
export type GoldSelection =
  | {
      readonly applicable: true;
      readonly selection: (input: PlanningInput) => Selection2;
    }
  | { readonly applicable: false; readonly reason: string };

/**
 * The expected selection alone, for testing the actions stage on perfect
 * inputs: every gate, with `needsActions` yes when the scenario expects an
 * action, an ask, or a parameter with no listed match. Not applicable to
 * an expected deferral, an expectation without a visible set, or a new
 * Instance id that names no Vessel.
 */
export function goldSelection(scenario: Scenario): GoldSelection {
  const { expected } = scenario;
  if (expected.status !== 'planned')
    return { applicable: false, reason: 'expects a deferral' };
  if (expected.visible === undefined)
    return { applicable: false, reason: 'states no visible set' };
  const instances = goldInstances(scenario);
  if (typeof instances === 'string')
    return { applicable: false, reason: instances };
  const needsActions =
    (expected.actions?.length ?? 0) > 0 ||
    (expected.asks?.length ?? 0) > 0 ||
    (expected.noListedMatch?.length ?? 0) > 0;
  const gates = { ...goldGates(scenario), needsActions: gate(needsActions) };
  return {
    applicable: true,
    selection: (input) => ({ input, instances, answers: [], gates }),
  };
}

function gateOr(
  answer: 'yes' | 'no' | undefined,
  fallback: boolean,
): GateAnswer {
  return gate(answer === undefined ? fallback : answer === 'yes');
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
