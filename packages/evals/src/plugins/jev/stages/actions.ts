import type { Stage } from '@maelstrom-co/engine';
import {
  type ActionPlan2,
  type AnswerRecord,
  type Ask,
  actionsBatchedPerInstance,
  actionsStepwise,
  type JevActionPlan,
  type Selection2,
  STAGE_NAME,
} from '@maelstrom-co/planner-jev/_internal';
import type { Scenario } from '../../../core/scenarios.js';
import type {
  Judgement,
  StageEvalModule,
  StageTurnRecord,
} from '../../../core/stage-eval.js';
import { ratio, STAGE_RATIO } from '../../../core/stats.js';
import {
  askRecordingState,
  type ClientBuilder,
  typesafeClientBuilder,
} from '../client-builder.js';
import { goldSelection } from '../gold-inputs.js';
import { scoreActions } from '../score.js';
import { typesafeSettings } from '../typesafe-settings.js';

/** One planned action as the actions stage eval records it. */
export interface RecordedAction {
  readonly instanceId: string;
  readonly action: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Parameters left to the completion call (`stated_elsewhere`). */
  readonly pending: readonly string[];
}

/** What the actions stage eval records of one action plan. */
export interface ActionsTurnDetail {
  readonly actions: readonly RecordedAction[];
  /** `<instanceId>.<action>.<parameter>` of every value the stage asks the user for. */
  readonly asks: readonly string[];
  /** `<instanceId>.<action>` the stage planned more often than the scenario expects it. */
  readonly repeated: readonly string[];
  /** `<instanceId>.<action>` the stage planned although the scenario expects no such action. */
  readonly unexpected: readonly string[];
  readonly answers: readonly AnswerRecord[];
}

/** What every actions stage variant runs on: the provider client of the turn. */
export interface ActionsDeps {
  readonly ask: Ask;
}

type ActionsStage = (ask: Ask) => Stage<Selection2, ActionPlan2>;

/**
 * The actions stages the eval compares: `stepwise` is the POC's one call
 * per step (`jevPlanner`), `batched-per-instance` the one call over every
 * instance of the composed pairs planner.
 */
export const ACTIONS_STAGES: Readonly<Record<string, ActionsStage>> = {
  stepwise: actionsStepwise,
  'batched-per-instance': (ask) => actionsBatchedPerInstance(ask),
};

/** {@link ACTIONS_STAGES} as the stage eval's variants, on the turn's `ask`. */
export const ACTIONS_VARIANTS: Readonly<
  Record<string, (deps: ActionsDeps) => Stage<Selection2, ActionPlan2>>
> = Object.fromEntries(
  Object.entries(ACTIONS_STAGES).map(([name, stage]) => [
    name,
    (deps: ActionsDeps) => stage(deps.ask),
  ]),
);

export type ActionsModule = StageEvalModule<
  Selection2,
  ActionPlan2,
  ActionsTurnDetail,
  ActionsDeps
>;

/** What {@link actionsModuleWith} takes. */
export interface ActionsModuleOptions {
  /** The provider client; TypeSafe on the environment's settings when absent. */
  readonly client?: ClientBuilder;
  /** The `--stage` name; `actions` when absent. */
  readonly name?: string;
}

/**
 * The actions stage on gold inputs: each scenario's expected selection
 * with every gate (see `goldSelection`). A plan passes when Jev bound
 * every expected action and parameter itself; a plan that is right only
 * because the completion call would fill a `stated_elsewhere` value is
 * handed off. For a parameter with no listed match, the plan passes
 * unless it binds that parameter or repeats its action. Repeated and
 * unexpected actions are recorded on every turn.
 */
export function actionsModuleWith(
  options: ActionsModuleOptions = {},
): ActionsModule {
  const client = options.client ?? typesafeClientBuilder(typesafeSettings());
  return {
    name: options.name ?? 'actions',
    stage: STAGE_NAME.jevActions,
    provider: client.provider,
    requiredEnv: client.requiredEnv,
    variants: ACTIONS_VARIANTS,
    makeDeps: (onCall) => ({ ask: askRecordingState(client, onCall) }),
    configure: async () => ({
      module: actionsModuleWith(options),
      meta: { ...client.meta(), inputs: 'gold selection' },
    }),
    prepare: async (scenario, ctx) => {
      const { expected } = scenario;
      if (
        expected.actions === undefined &&
        expected.asks === undefined &&
        expected.noListedMatch === undefined
      )
        return { applicable: false, reason: 'states no actions' };
      const gold = goldSelection(scenario);
      if (!gold.applicable) return gold;
      return {
        applicable: true,
        input: gold.selection(ctx.origin),
        origin: ctx.origin,
      };
    },
    judge: judgeActions,
    reportSections: (records, variants) => [
      renderRepeatedActionsSection(records, variants),
    ],
  };
}

/** {@link actionsModuleWith} on TypeSafe with the environment's settings. */
export const actionsModule: ActionsModule = actionsModuleWith();

/** Scores one action plan against `scenario` (see {@link actionsModuleWith}). */
export function judgeActions(
  scenario: Scenario,
  _input: Selection2,
  plan: JevActionPlan,
): Judgement<ActionsTurnDetail> {
  const detail = recordPlan(scenario, plan);
  const { noListedMatch } = scenario.expected;
  if (noListedMatch !== undefined) {
    const failures = [
      ...noListedMatch.flatMap(({ instanceId, action, parameter }) =>
        detail.actions
          .filter(
            (planned) =>
              planned.instanceId === instanceId &&
              planned.action === action &&
              Object.hasOwn(planned.params, parameter),
          )
          .map(
            (planned) =>
              `Bound ${instanceId}.${action}.${parameter} to ${JSON.stringify(planned.params[parameter])}`,
          ),
      ),
      ...detail.repeated.map((key) => `Repeated ${key}`),
    ];
    return {
      outcome: failures.length === 0 ? 'pass' : 'fail',
      failures,
      detail,
    };
  }
  const bound = scoreActions(scenario, {
    ...plan,
    actions: plan.actions.map((action) => ({ ...action, pending: [] })),
  });
  if (bound?.pass) return { outcome: 'pass', failures: [], detail };
  const completed = scoreActions(scenario, plan);
  if (completed?.pass)
    return { outcome: 'handed_off', failures: bound?.failures ?? [], detail };
  return {
    outcome: 'fail',
    failures: completed?.failures ?? ['the scenario states no actions'],
    detail,
  };
}

/**
 * Per variant, the turns that planned an action more often than the
 * scenario expects it or an action it does not expect, and the scenarios
 * where either happened.
 */
export function renderRepeatedActionsSection(
  records: readonly StageTurnRecord<ActionsTurnDetail>[],
  variants: readonly string[],
): string {
  const planned = records.filter((record) => record.detail !== undefined);
  const count = (
    variant: string,
    field: 'repeated' | 'unexpected',
    scenarioId?: string,
  ) => {
    const own = planned.filter(
      (record) =>
        record.variant === variant &&
        (scenarioId === undefined || record.scenarioId === scenarioId),
    );
    return {
      count: own.filter((record) => (record.detail?.[field].length ?? 0) > 0)
        .length,
      total: own.length,
    };
  };
  const lines = [
    '## Repeated and unexpected actions',
    '',
    'Over the turns whose stage returned a plan.',
    '',
    `| Metric | ${variants.join(' | ')} |`,
    `| --- |${variants.map(() => ' --- |').join('')}`,
    `| Turns repeating an action | ${variants.map((variant) => ratio(count(variant, 'repeated'), STAGE_RATIO)).join(' | ')} |`,
    `| Turns with an unexpected action | ${variants.map((variant) => ratio(count(variant, 'unexpected'), STAGE_RATIO)).join(' | ')} |`,
  ];
  const scenarios = [
    ...new Set(
      planned
        .filter(
          (record) =>
            (record.detail?.repeated.length ?? 0) > 0 ||
            (record.detail?.unexpected.length ?? 0) > 0,
        )
        .map((record) => record.scenarioId),
    ),
  ];
  if (scenarios.length > 0)
    lines.push(
      '',
      'Per scenario: turns repeating an action (`r`) and turns with an unexpected action (`u`), over the turns that returned a plan.',
      '',
      `| Scenario | ${variants.join(' | ')} |`,
      `| --- |${variants.map(() => ' --- |').join('')}`,
      ...scenarios.map(
        (scenarioId) =>
          `| ${scenarioId} | ${variants
            .map((variant) => {
              const repeated = count(variant, 'repeated', scenarioId);
              const unexpected = count(variant, 'unexpected', scenarioId);
              return `r ${repeated.count}/${repeated.total}, u ${unexpected.count}/${unexpected.total}`;
            })
            .join(' | ')} |`,
      ),
    );
  return lines.join('\n');
}

function recordPlan(
  scenario: Scenario,
  plan: JevActionPlan,
): ActionsTurnDetail {
  const actions = plan.actions.map((action) => ({
    instanceId: String(action.instanceId),
    action: String(action.action),
    params: action.params,
    pending: action.pending.map((parameter) => parameter.name),
  }));
  const asks = plan.asks.map(
    (ask) => `${ask.instanceId}.${ask.action}.${ask.parameter.name}`,
  );
  const expected = tally([
    ...(scenario.expected.actions ?? []),
    ...(scenario.expected.asks ?? []),
    ...(scenario.expected.noListedMatch ?? []),
  ]);
  const chosen = tally([...actions, ...uniqueAsks(plan.asks)]);
  const repeated = [...chosen]
    .filter(([key, times]) => times > 1 && times > (expected.get(key) ?? 0))
    .map(([key]) => key);
  const unexpected = [...chosen.keys()].filter((key) => !expected.has(key));
  return { actions, asks, repeated, unexpected, answers: plan.answers };
}

function tally(
  actions: readonly { readonly instanceId: string; readonly action: string }[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { instanceId, action } of actions) {
    const key = `${instanceId}.${action}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** One entry per dropped action: an action asks once for each missing parameter. */
function uniqueAsks(
  asks: JevActionPlan['asks'],
): readonly { readonly instanceId: string; readonly action: string }[] {
  const seen = new Set<string>();
  return asks.flatMap((ask) => {
    const key = `${ask.instanceId}.${ask.action}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ instanceId: String(ask.instanceId), action: String(ask.action) }];
  });
}
