import {
  type JevCall,
  STAGE_NAMES,
  type TypeSafeClientOptions,
} from '@maelstrom-co/planner-jev/_eval';
import type { StageRecord } from '../../core/instrument.js';
import type { PlannerEvalPlugin } from '../../core/plugin.js';
import { registerStageEval } from '../../core/stage-eval.js';
import { jevArms, type ReplayShape } from './arms.js';
import { type JevRunRecord, jevTurnFields } from './record.js';
import { jevRows, jevSummary } from './report.js';
import { layoutModuleWith } from './stages/layout.js';
import { createTypeSafeJudge } from './typesafe-judge.js';
import { typesafeSettings } from './typesafe-settings.js';

/** The stage each planner-neutral phase maps to in the Jev pipeline. */
export const JEV_PHASES = {
  select: 'jevSelect',
  actions: 'jevActions',
  layout: 'jevLayout',
} as const;

/** What {@link jevPluginWith} takes: TypeSafe settings, for tests that script the transport. */
export interface JevPluginOptions {
  /** Overrides for the TypeSafe client; `TYPESAFE_API_KEY` and `JEV_MODEL` fill the rest. */
  readonly typesafe?: Partial<Omit<TypeSafeClientOptions, 'onCall'>>;
}

/**
 * The Jev planner family as an eval plugin: the POC and the stage-library
 * arms, replay by stage, the Jev fields of the records and the report, the
 * TypeSafe judge and the layout stage eval.
 */
export function jevPluginWith(
  options: JevPluginOptions = {},
): PlannerEvalPlugin<JevCall> {
  const typesafe = typesafeSettings(options.typesafe);
  const arms = jevArms(typesafe);
  return {
    name: 'jev',
    arms,
    defaultArms: ['jev-poc'],
    aliases: { jev: 'jev-poc' },
    stageOrder: STAGE_NAMES,
    phases: JEV_PHASES,
    meta: () => ({ jevModel: typesafe().model }),
    verifyReplay: (record, arm) =>
      shapeProblems(
        arms.find((candidate) => candidate.name === arm.name)?.replayShape ??
          'poc',
        record,
      ),
    recordTurn: jevTurnFields,
    summarizeArm: (records) => jevSummary(records as readonly JevRunRecord[]),
    reportRows: jevRows,
    judge: createTypeSafeJudge(typesafe),
    stageModules: [registerStageEval(layoutModuleWith({ typesafe }))],
  };
}

/** The Jev plugin on the TypeSafe settings from the environment. */
export const jevPlugin: PlannerEvalPlugin<JevCall> = jevPluginWith();

const GATES = ['needsActions', 'generatedContent', 'spatial'] as const;

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
  if (record.stage === 'jevActions' && typeof output.minConfidence !== 'number')
    problems.push('has no minConfidence');
  if (record.stage !== 'jevSelect' && record.stage !== 'jevActions')
    return problems;
  if (shape === 'ungated' && output.gates !== undefined)
    problems.push('carries gates this ungated arm would act on');
  if (shape === 'gated' && !GATES.every((gate) => isGate(output.gates?.[gate])))
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
