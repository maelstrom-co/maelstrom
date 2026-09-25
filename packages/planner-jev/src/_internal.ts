/**
 * Workspace-internal subpath: the stages, planners, builders, geometry
 * helpers and TypeSafe client that code elsewhere in this repository
 * composes outside a shipped planner, experimental ones included.
 * Unsupported outside the repository and free to change in any release.
 */
export { demoVessels } from './lib/__test-helpers__/demo-vessels.js';
export {
  type JevCaller,
  STAGE_NAME,
  STAGE_NAMES,
  type StageName,
} from './lib/defer.js';
export { buildJevPlanner, FALLBACK_RETRIES } from './lib/jev-planner.js';
export { type LeafRect, layoutFits, treeRects } from './lib/layout-fit.js';
export { buildJevComposedPairsPlanner } from './lib/planners/jev-composed-pairs.js';
export {
  buildJevStagePlanner,
  type JevStages,
} from './lib/planners/jev-stage-planner.js';
export { buildJevGatedBatchedPlanner } from './lib/planners-experimental/jev-gated-batched.js';
export { buildJevGatedStepwisePlanner } from './lib/planners-experimental/jev-gated-stepwise.js';
export { buildJevUngatedBatchedPlanner } from './lib/planners-experimental/jev-ungated-batched.js';
export { buildJevUngatedBatchedPerInstancePlanner } from './lib/planners-experimental/jev-ungated-batched-per-instance.js';
export { buildJevUngatedStepwisePlanner } from './lib/planners-experimental/jev-ungated-stepwise.js';
export {
  type Evaluation,
  intentText,
  isScoreAnswer,
  type Question,
  score,
} from './lib/questions.js';
export { actionPlanOf } from './lib/stages/action-plan.js';
export { actionsBatchedPerInstance } from './lib/stages/actions-batched-per-instance.js';
export { completeLayoutInline } from './lib/stages/complete-layout-inline.js';
export {
  type ComposedPairsDecision,
  type ComposedPairsRecord,
  type ComposedRoute,
  layoutComposedPairsGateAndDefer,
  type PairsHandOff,
  type PairsSizeFallback,
} from './lib/stages/layout-composed-pairs-gate-and-defer.js';
export {
  NOT_STATED,
  type PairRelation,
  TOP_DIRECTIONS,
  type TopDirection,
  treeDirection,
  treeRelation,
} from './lib/stages/layout-composed-pairs-tree.js';
export { GATE_THRESHOLD, selectGated } from './lib/stages/select-gated.js';
export { createJevDeps, type JevDeps } from './lib/stages/stage-deps.js';
export type {
  ActionPlan2,
  GateAnswer,
  GatedActionPlan,
  LayoutDecision,
  LayoutSource,
  LayoutStage,
  Selection2,
  SelectionGates,
} from './lib/stages/stage-types.js';
export { actionsStepwise } from './lib/stages-experimental/actions-stepwise.js';
export { completeLayoutParallel } from './lib/stages-experimental/complete-layout-parallel.js';
export { layoutPreset } from './lib/stages-experimental/layout-preset.js';
export { layoutPresetOrLlm } from './lib/stages-experimental/layout-preset-or-llm.js';
export { selectUngated } from './lib/stages-experimental/select-ungated.js';
export type {
  AnswerRecord,
  JevActionPlan,
  JevLayoutPlan,
  JevSelection,
  ParameterAsk,
  PendingParameter,
  PlannedAction,
  SelectedInstance,
} from './lib/types.js';
export {
  type Ask,
  createTypeSafeClient,
  type JevCall,
  type TypeSafeClientOptions,
} from './lib/typesafe-client.js';
