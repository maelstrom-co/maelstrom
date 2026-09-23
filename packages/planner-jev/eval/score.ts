import {
  getVisibleInstanceIds,
  isErr,
  type MaelstromResponse,
  type TilingLayout,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

import { finalVariants } from '../src/lib/final-variants.js';
import type {
  JevActionPlan,
  JevLayoutPlan,
  JevSelection,
} from '../src/lib/types.js';
import { checkArrangement } from './predicates.js';
import type { ExpectedAction, Scenario } from './scenarios.js';

export interface Score {
  readonly pass: boolean;
  readonly failures: readonly string[];
}

/** A score whose failures include the arrangement rules' failures, when the scenario declares any. */
export interface ArrangedScore extends Score {
  readonly arrangement?: Score;
}

/**
 * Scores a shipped (validated and healed) response: visible and retained
 * sets, ordered actions with parsed parameters, and the variant invariant
 * (an existing instance's declared variant is the one the shipped execution
 * plan leaves it in, simulated with the engine's own rule). New instance ids
 * are matched to the expected ones by Vessel and order, so a planner's own
 * ids score fairly.
 */
export function scoreResponse(
  scenario: Scenario,
  response: MaelstromResponse,
): ArrangedScore {
  const { expected } = scenario;
  if (response.layout.type !== 'tiling') {
    const failures = ['Response layout is not tiling'];
    return {
      pass: false,
      failures,
      ...(expected.arrangement && { arrangement: { pass: false, failures } }),
    };
  }
  const failures: string[] = [];
  const rename = matchNewIds(scenario, response.layout);
  const ids = (values: Iterable<string>) =>
    [...values].map((id) => rename.get(id) ?? id).sort();

  if (expected.visible)
    compare(
      failures,
      'Visible instances',
      ids(getVisibleInstanceIds(response.layout)),
      [...expected.visible].sort(),
    );
  compare(
    failures,
    'Retained instances',
    ids(response.layout.instances.map((instance) => instance.instanceId)),
    [...expectedRetained(scenario)].sort(),
  );
  if (expected.actions)
    compareActions(
      failures,
      response.executionPlan.map((action) => ({
        instanceId: rename.get(action.instanceId) ?? action.instanceId,
        action: action.action,
        ...(action.params !== undefined && { params: action.params }),
      })),
      expected.actions,
    );
  compareVariants(failures, scenario, response.layout, response.executionPlan);
  const arrangement = arrange(
    scenario,
    response.layout.tree.map((token) => {
      const id = tilingLeafInstanceId(token);
      const renamed = id === null ? undefined : rename.get(id);
      return renamed === undefined ? token : (`ID:${renamed}` as TilingNode);
    }),
    failures,
  );
  return {
    pass: failures.length === 0,
    failures,
    ...(arrangement && { arrangement }),
  };
}

/** Selection stage: visible and retained sets from jevSelect's output. */
export function scoreSelection(
  scenario: Scenario,
  selection: JevSelection,
): Score | undefined {
  if (!scenario.expected.visible) return undefined;
  const failures: string[] = [];
  compare(
    failures,
    'Selected visible',
    selection.instances
      .filter((i) => i.visible)
      .map((i) => i.instanceId)
      .sort(),
    [...scenario.expected.visible].sort(),
  );
  compare(
    failures,
    'Selected retained',
    selection.instances
      .filter((i) => i.decision !== 'delete')
      .map((i) => i.instanceId)
      .sort(),
    [...expectedRetained(scenario)].sort(),
  );
  return { pass: failures.length === 0, failures };
}

/**
 * Actions stage: ordered actions, bound parameters (a `stated_elsewhere`
 * slot counts when the expectation has a value for it, since the LLM fills
 * it later) and the asks.
 */
export function scoreActions(
  scenario: Scenario,
  plan: JevActionPlan,
): Score | undefined {
  const { actions, asks } = scenario.expected;
  if (!actions && !asks) return undefined;
  const failures: string[] = [];
  if (actions) {
    const planned = plan.actions.map((action) => {
      const expected = actions.find(
        (candidate) =>
          candidate.instanceId === action.instanceId &&
          candidate.action === action.action,
      );
      const params: Record<string, unknown> = { ...action.params };
      for (const slot of action.pending)
        params[slot.name] = expected?.params?.[slot.name] ?? '(pending)';
      return {
        instanceId: String(action.instanceId),
        action: String(action.action),
        ...(Object.keys(params).length > 0 && { params }),
      };
    });
    compareActions(failures, planned, actions);
  }
  compare(
    failures,
    'Asks',
    plan.asks
      .map((ask) => `${ask.instanceId}.${ask.action}.${ask.parameter.name}`)
      .sort(),
    (asks ?? [])
      .map((ask) => `${ask.instanceId}.${ask.action}.${ask.parameter}`)
      .sort(),
    (actual, wanted) => wanted.every((ask) => actual.includes(ask)),
  );
  return { pass: failures.length === 0, failures };
}

/**
 * Layout stage: the tree's leaves are the expected visible set, and the tree
 * satisfies the scenario's arrangement rules.
 */
export function scoreLayout(
  scenario: Scenario,
  layout: Pick<JevLayoutPlan, 'tree'>,
): ArrangedScore | undefined {
  const { visible, arrangement: rules } = scenario.expected;
  if (!visible && !rules) return undefined;
  const failures: string[] = [];
  if (visible)
    compare(
      failures,
      'Tree leaves',
      [
        ...getVisibleInstanceIds({
          type: 'tiling',
          tree: layout.tree,
          instances: [],
        }),
      ].sort(),
      [...visible].sort(),
    );
  const arrangement = arrange(scenario, layout.tree, failures);
  return {
    pass: failures.length === 0,
    failures,
    ...(arrangement && { arrangement }),
  };
}

function arrange(
  scenario: Scenario,
  tree: readonly TilingNode[],
  failures: string[],
): Score | undefined {
  const rules = scenario.expected.arrangement;
  if (!rules) return undefined;
  const score = checkArrangement(rules, { request: scenario.request, tree });
  failures.push(...score.failures.map((failure) => `Arrangement ${failure}`));
  return score;
}

function compareVariants(
  failures: string[],
  scenario: Scenario,
  layout: TilingLayout,
  executionPlan: MaelstromResponse['executionPlan'],
): void {
  const { request } = scenario;
  const existing = new Set<string>(
    request.instances.map((instance) => instance.instanceId),
  );
  const simulated = finalVariants(
    request.instances,
    executionPlan.filter((step) => existing.has(step.instanceId)),
    request.vessels,
  );
  if (isErr(simulated)) {
    const { kind, step } = simulated.error;
    failures.push(
      `Execution plan does not simulate: ${step.action} on ${step.instanceId} (${kind})`,
    );
    return;
  }
  for (const instance of request.instances) {
    const declared = layout.instances.find(
      (candidate) => candidate.instanceId === instance.instanceId,
    );
    const wanted = simulated.value.get(instance.instanceId) ?? instance.variant;
    if (declared && declared.variant !== wanted)
      failures.push(
        `Variant of ${instance.instanceId} is ${declared.variant}, but the execution plan leaves it ${wanted}`,
      );
  }
}

/**
 * The Instances a scenario expects retained: its stated set, or every
 * current, visible and acted-on Instance when it states none.
 */
export function expectedRetained(scenario: Scenario): readonly string[] {
  const { expected, request } = scenario;
  return (
    expected.retained ?? [
      ...new Set([
        ...request.instances.map((instance) => instance.instanceId),
        ...(expected.visible ?? []),
        ...(expected.actions ?? []).map((action) => action.instanceId),
      ]),
    ]
  );
}

/**
 * Maps each id the response introduced to the expected new id of the same
 * Vessel, in order of appearance.
 */
function matchNewIds(
  scenario: Scenario,
  layout: TilingLayout,
): ReadonlyMap<string, string> {
  const existing = new Set<string>(
    scenario.request.instances.map((instance) => instance.instanceId),
  );
  const expectedNew = [
    ...(scenario.expected.visible ?? []),
    ...(scenario.expected.retained ?? []),
    ...(scenario.expected.actions ?? []).map((action) => action.instanceId),
  ].filter((id, index, all) => !existing.has(id) && all.indexOf(id) === index);
  const rename = new Map<string, string>();
  const used = new Set<string>();
  for (const instance of layout.instances) {
    if (existing.has(instance.instanceId)) continue;
    const target = expectedNew.find(
      (id) => !used.has(id) && id.startsWith(`${instance.vesselId}-`),
    );
    if (target === undefined) continue;
    used.add(target);
    rename.set(instance.instanceId, target);
  }
  return rename;
}

function compareActions(
  failures: string[],
  actual: readonly {
    readonly instanceId: string;
    readonly action: string;
    readonly params?: Readonly<Record<string, unknown>>;
  }[],
  expected: readonly ExpectedAction[],
): void {
  const shown = actual.map((action, index) => {
    const wanted = expected[index];
    return wanted?.params === undefined
      ? { instanceId: action.instanceId, action: action.action }
      : action;
  });
  compare(
    failures,
    'Ordered actions',
    shown.map(normalizeAction),
    expected.map(normalizeAction),
  );
}

function normalizeAction(action: {
  readonly instanceId: string;
  readonly action: string;
  readonly params?: Readonly<Record<string, unknown>>;
}) {
  return {
    instanceId: String(action.instanceId),
    action: String(action.action),
    ...(action.params !== undefined &&
      Object.keys(action.params).length > 0 && {
        params: sortKeys(action.params),
      }),
  };
}

function sortKeys(value: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function compare<T>(
  failures: string[],
  label: string,
  actual: T,
  wanted: T,
  equal: (actual: T, wanted: T) => boolean = (a, w) =>
    JSON.stringify(a) === JSON.stringify(w),
): void {
  if (!equal(actual, wanted))
    failures.push(
      `${label}: expected ${JSON.stringify(wanted)}, received ${JSON.stringify(actual)}`,
    );
}
