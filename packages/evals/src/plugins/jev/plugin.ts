import {
  type JevCall,
  SELECTION_GATES,
  STAGE_NAME,
  STAGE_NAMES,
  type StageName,
  type TypeSafeClientOptions,
} from '@maelstrom-co/planner-jev/_internal';
import type { StageRecord } from '../../core/instrument.js';
import type { Judge, Phase, PlannerEvalPlugin } from '../../core/plugin.js';
import { registerStageEval } from '../../core/stage-eval.js';
import { type JevArm, jevArms, type ReplayShape } from './arms.js';
import { type ClientBuilder, typesafeClientBuilder } from './client-builder.js';
import { type JevRunRecord, jevTurnFields } from './record.js';
import { jevRows, jevSummary } from './report.js';
import { actionsModuleWith } from './stages/actions.js';
import { layoutModuleWith, type SpatialRecordsArms } from './stages/layout.js';
import { selectModuleWith } from './stages/select.js';
import { createTypeSafeJudge } from './typesafe-judge.js';
import { typesafeSettings } from './typesafe-settings.js';

/** The stage each planner-neutral phase maps to in the Jev pipeline. */
export const JEV_PHASES = {
  select: STAGE_NAME.jevSelect,
  actions: STAGE_NAME.jevActions,
  layout: STAGE_NAME.jevLayout,
} as const satisfies Readonly<Record<Phase, StageName>>;

/** What {@link jevPluginWith} takes: TypeSafe settings, for tests that script the transport. */
export interface JevPluginOptions {
  /** Overrides for the TypeSafe client; `TYPESAFE_API_KEY` and `JEV_MODEL` fill the rest. */
  readonly typesafe?: Partial<Omit<TypeSafeClientOptions, 'onCall'>>;
}

/** What {@link stagePluginWith} builds a plugin from. */
export interface StagePluginConfig {
  /** The plugin's name, as reports and errors name it. */
  readonly name: string;
  /** The provider client of the plugin's stage eval modules; its `meta()` is the plugin's. */
  readonly client: ClientBuilder;
  /** The plugin's arms, each with the replay shape it reads. */
  readonly arms: readonly JevArm[];
  /** Arm names run when `--arm` is not given; none when absent. */
  readonly defaultArms?: readonly string[];
  /** Other names `--arm` accepts, alias to arm name; none when absent. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Rates shipped responses for `--grader`; none when absent. */
  readonly judge?: Judge;
  /** The `--stage` names of the select, actions and layout stage eval modules. */
  readonly stageNames: {
    readonly select: string;
    readonly actions: string;
    readonly layout: string;
  };
  /** The arms the layout module's `--spatial-records-arm` accepts; the Jev arms when absent. */
  readonly spatialRecordsArms?: SpatialRecordsArms;
  /**
   * A plugin whose report rows already cover every column: when any of its
   * arms is in the report, this plugin adds no rows of its own.
   */
  readonly rowsDeferTo?: PlannerEvalPlugin;
}

/**
 * A plugin over the stage library's pipeline on `config.client`: replay by
 * stage, the stage fields of the records and the report, and the select,
 * actions and layout stage evals, with the arms, defaults and judge
 * `config` gives.
 */
export function stagePluginWith(
  config: StagePluginConfig,
): PlannerEvalPlugin<JevCall, StageName> {
  const { name, client, arms, stageNames, rowsDeferTo } = config;
  const spatial = config.spatialRecordsArms && {
    spatialRecordsArms: config.spatialRecordsArms,
  };
  return {
    name,
    arms,
    ...(config.defaultArms && { defaultArms: config.defaultArms }),
    ...(config.aliases && { aliases: config.aliases }),
    stageOrder: STAGE_NAMES,
    phases: JEV_PHASES,
    completionStage: STAGE_NAME.llmComplete,
    meta: () => client.meta(),
    verifyReplay: (record, arm) =>
      shapeProblems(replayShapeOf(name, arms, arm.name), record),
    recordTurn: jevTurnFields,
    summarizeArm: (records) => jevSummary(records as readonly JevRunRecord[]),
    reportRows: (summaries) =>
      rowsDeferTo !== undefined &&
      summaries.some((summary) =>
        rowsDeferTo.arms.some((arm) => arm.name === summary.arm),
      )
        ? []
        : jevRows(),
    ...(config.judge && { judge: config.judge }),
    stageModules: [
      registerStageEval(selectModuleWith({ client, name: stageNames.select })),
      registerStageEval(
        actionsModuleWith({ client, name: stageNames.actions }),
      ),
      registerStageEval(
        layoutModuleWith({ client, name: stageNames.layout, ...spatial }),
      ),
    ],
  };
}

/**
 * The Jev planner family as an eval plugin: the POC and the stage-library
 * arms, replay by stage, the Jev fields of the records and the report, the
 * TypeSafe judge and the select, actions and layout stage evals.
 */
export function jevPluginWith(
  options: JevPluginOptions = {},
): PlannerEvalPlugin<JevCall, StageName> {
  const typesafe = typesafeSettings(options.typesafe);
  return stagePluginWith({
    name: 'jev',
    client: typesafeClientBuilder(typesafe),
    arms: jevArms(typesafe),
    defaultArms: ['jev-poc'],
    aliases: { jev: 'jev-poc' },
    judge: createTypeSafeJudge(typesafe),
    stageNames: { select: 'select', actions: 'actions', layout: 'layout' },
  });
}

/** The Jev plugin on the TypeSafe settings from the environment. */
export const jevPlugin: PlannerEvalPlugin<JevCall, StageName> = jevPluginWith();

function replayShapeOf(
  plugin: string,
  arms: readonly JevArm[],
  name: string,
): ReplayShape {
  const arm = arms.find((candidate) => candidate.name === name);
  if (arm === undefined)
    throw new Error(
      `the ${plugin} plugin has no arm ${name} to check a replayed stage output against`,
    );
  return arm.replayShape;
}

/** What a replayed stage output lacks for an arm of `shape` to read it. */
export function shapeProblems(
  shape: ReplayShape,
  record: StageRecord,
): readonly string[] {
  const output = (record.output ?? {}) as {
    readonly gates?: Readonly<Record<string, unknown>>;
    readonly minConfidence?: unknown;
  };
  const problems: string[] = [];
  if (shape === 'poc') return problems;
  if (
    record.stage === STAGE_NAME.jevActions &&
    typeof output.minConfidence !== 'number'
  )
    problems.push('has no minConfidence');
  if (
    record.stage !== STAGE_NAME.jevSelect &&
    record.stage !== STAGE_NAME.jevActions
  )
    return problems;
  if (shape === 'ungated' && output.gates !== undefined)
    problems.push('carries gates this ungated arm would act on');
  if (
    shape === 'gated' &&
    !SELECTION_GATES.every((gate) => isGate(output.gates?.[gate]))
  )
    problems.push('has no complete gates');
  return problems;
}

function isGate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const gate = value as Record<string, unknown>;
  return (
    (gate.answer === 'yes' || gate.answer === 'no') &&
    typeof gate.probability === 'number' &&
    typeof gate.confidence === 'number'
  );
}
