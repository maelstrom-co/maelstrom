import { expect, test } from 'bun:test';

import * as evalApi from './_eval.js';
import * as testingApi from './_testing.js';

test('_eval exposes the runtime values @maelstrom-co/planner-eval composes', () => {
  expect(Object.keys(evalApi).sort()).toEqual(
    [
      'demoVessels',
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
      'installMockChat',
      'mockChat',
      'scriptedAsk',
      'scriptedFetch',
      'TEST_MODEL',
    ].sort(),
  );
});

test('importing _eval and _testing leaves @tanstack/ai chat untouched', () => {
  const probe = `
    const before = (await import('@tanstack/ai')).chat;
    await import(${JSON.stringify(import.meta.resolve('./_eval.ts'))});
    await import(${JSON.stringify(import.meta.resolve('./_testing.ts'))});
    const after = (await import('@tanstack/ai')).chat;
    process.exit(before === after ? 0 : 1);
  `;
  const run = Bun.spawnSync([process.execPath, '-e', probe], {
    cwd: import.meta.dir,
  });
  expect(run.exitCode).toBe(0);
});
