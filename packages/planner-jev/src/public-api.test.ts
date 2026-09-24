import { expect, test } from 'bun:test';

import * as evalApi from './_eval.js';
import * as testingApi from './_testing.js';

test('_eval exposes the runtime values @maelstrom-co/planner-eval composes', () => {
  expect(Object.keys(evalApi).sort()).toEqual(
    [
      'STAGE_NAMES',
      'finalVariants',
      'buildJevPlanner',
      'FALLBACK_RETRIES',
      'layoutFits',
      'treeRects',
      'buildJevGatedBatchedPlanner',
      'buildJevGatedStepwisePlanner',
      'buildJevUngatedBatchedPlanner',
      'buildJevUngatedBatchedPerInstancePlanner',
      'buildJevUngatedStepwisePlanner',
      'buildJevComposedPairsPlanner',
      'buildJevStagePlanner',
      'intentText',
      'isScoreAnswer',
      'score',
      'actionsStepwise',
      'completeLayoutParallel',
      'layoutPreset',
      'layoutPresetOrLlm',
      'selectUngated',
      'actionPlanOf',
      'actionsBatchedPerInstance',
      'completeLayoutInline',
      'layoutComposedPairsGateAndDefer',
      'NOT_STATED',
      'TOP_DIRECTIONS',
      'treeDirection',
      'treeRelation',
      'GATE_THRESHOLD',
      'selectGated',
      'createJevDeps',
      'createTypeSafeClient',
    ].sort(),
  );
});

test('_testing exposes the fixtures and transports the eval tests use', () => {
  expect(Object.keys(testingApi).sort()).toEqual(
    [
      'conversation',
      'demoVessels',
      'makeContext',
      'makeInput',
      'makeRequest',
      'demoTurnPlan',
      'loadDemoTurns',
      'recordedAsk',
      'dummyAdapter',
      'mockChat',
      'scriptedAsk',
      'scriptedFetch',
      'TEST_MODEL',
    ].sort(),
  );
});
