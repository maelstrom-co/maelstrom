import type { Planner } from '@maelstrom-co/engine';
import {
  actionsBatchedPerInstance,
  buildJevComposedPairsPlanner,
  buildJevGatedBatchedPlanner,
  buildJevGatedStepwisePlanner,
  buildJevPlanner,
  buildJevStagePlanner,
  buildJevUngatedBatchedPerInstancePlanner,
  buildJevUngatedBatchedPlanner,
  buildJevUngatedStepwisePlanner,
  completeLayoutInline,
  completeLayoutParallel,
  createJevDeps,
  type JevCall,
  type JevDeps,
  type JevStages,
  layoutPreset,
  layoutPresetOrLlm,
  type Selection2,
  selectGated,
  selectUngated,
} from '@maelstrom-co/planner-jev/_internal';
import type { Arm, ArmDeps } from '../../core/plugin.js';
import { TYPESAFE_ENV, type TypeSafeSettings } from './typesafe-settings.js';

/**
 * What an arm's stages read from a replayed stage's output. `poc` reads
 * only the POC's fields. `ungated` also reads `minConfidence` on the action
 * plan, and would act on gates it never asked for, so a recording with
 * gates is refused. `gated` reads every gate on the selection and the
 * action plan.
 */
export type ReplayShape = 'poc' | 'ungated' | 'gated';

/** A Jev arm: the plugin reads its replay shape when a recorded run is replayed into it. */
export interface JevArm extends Arm<JevCall> {
  readonly replayShape: ReplayShape;
}

/** Every Jev arm needs the LLM for its completion call and fallback, and TypeSafe for its stages. */
export const JEV_ENV = ['OPENAI_API_KEY', ...TYPESAFE_ENV] as const;

const GATED_PER_INSTANCE = {
  select: selectGated,
  actions: actionsBatchedPerInstance,
} as const;

/** The frozen POC and the stage-library planners, each an arm, on `typesafe`'s client. */
export function jevArms(typesafe: TypeSafeSettings): readonly JevArm[] {
  const library = (
    name: string,
    replayShape: ReplayShape,
    build: (deps: JevDeps) => Planner,
  ): JevArm => ({
    name,
    kind: 'jev',
    requiredEnv: JEV_ENV,
    replayShape,
    build: (deps) => build(jevDeps(typesafe, deps)),
  });
  const stagePlanner = <Selected extends Selection2>(
    name: string,
    replayShape: ReplayShape,
    stages: JevStages<Selected>,
  ): JevArm =>
    library(name, replayShape, (deps) => buildJevStagePlanner(stages, deps));
  return [
    {
      name: 'jev-poc',
      kind: 'jev-poc',
      requiredEnv: JEV_ENV,
      replayShape: 'poc',
      build: (deps) => buildJevPlanner(jevDeps(typesafe, deps)),
    },
    library(
      'jev-ungated-stepwise-preset-inline',
      'ungated',
      buildJevUngatedStepwisePlanner,
    ),
    library(
      'jev-ungated-batched-preset-inline',
      'ungated',
      buildJevUngatedBatchedPlanner,
    ),
    library(
      'jev-ungated-per-instance-preset-inline',
      'ungated',
      buildJevUngatedBatchedPerInstancePlanner,
    ),
    library(
      'jev-gated-stepwise-preset-inline',
      'gated',
      buildJevGatedStepwisePlanner,
    ),
    library(
      'jev-gated-batched-preset-inline',
      'gated',
      buildJevGatedBatchedPlanner,
    ),
    stagePlanner('jev-gated-per-instance-preset-inline', 'gated', {
      ...GATED_PER_INSTANCE,
      layout: (ask) => layoutPreset(ask, { describe: 'placements' }),
      complete: completeLayoutInline,
    }),
    stagePlanner('jev-gated-per-instance-preset-or-llm-inline', 'gated', {
      ...GATED_PER_INSTANCE,
      layout: layoutPresetOrLlm,
      complete: completeLayoutInline,
    }),
    stagePlanner('jev-gated-per-instance-preset-or-llm-parallel', 'gated', {
      ...GATED_PER_INSTANCE,
      layout: layoutPresetOrLlm,
      complete: completeLayoutParallel,
    }),
    library(
      'jev-gated-per-instance-composed-pairs-gate-and-defer-inline',
      'gated',
      buildJevComposedPairsPlanner,
    ),
    stagePlanner('jev-ungated-per-instance-preset-or-llm-inline', 'ungated', {
      select: selectUngated,
      actions: actionsBatchedPerInstance,
      layout: layoutPresetOrLlm,
      complete: completeLayoutInline,
    }),
  ];
}

/** The stage library's dependencies for one turn, with the completion call on the `complete` role. */
export function jevDeps(
  typesafe: TypeSafeSettings,
  deps: ArmDeps<JevCall>,
): JevDeps {
  return createJevDeps({
    typesafe: { ...typesafe(), onCall: deps.onCall },
    adapter: deps.adapter('complete'),
    fallback: deps.fallback,
  });
}
