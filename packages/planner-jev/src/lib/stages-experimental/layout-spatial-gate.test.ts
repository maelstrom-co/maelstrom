import { describe, expect, test } from 'bun:test';
import type { Planner } from '@maelstrom-co/engine';
import { pipeline } from '@maelstrom-co/engine';
import { isOk } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeRequest,
  vessels,
} from '../__test-helpers__/fixtures.js';
import {
  actionPlan,
  withMinSizes,
} from '../__test-helpers__/layout-fixtures.js';
import { layoutSpatialGate } from './layout-spatial-gate.js';
import type {
  ActionsStage,
  CompleteStage,
  GatedActionPlan,
  SelectionGates,
  SelectStage,
} from './types.js';

const GATE_ANSWER = {
  needsActions: { answer: 'no', probability: 0, confidence: 1 },
  generatedContent: { answer: 'no', probability: 0, confidence: 1 },
} as const;

function gatedPlanOf(
  request: ReturnType<typeof makeRequest>,
  spatial: 'yes' | 'no',
  decisions: Record<string, 'keep' | 'hide' | 'delete' | 'create'> = {},
): GatedActionPlan {
  const plan = { ...actionPlan(request, [], decisions), minConfidence: 1 };
  const gates: Required<SelectionGates> = {
    ...GATE_ANSWER,
    spatial: {
      answer: spatial,
      probability: spatial === 'yes' ? 1 : 0,
      confidence: 1,
    },
  };
  return { ...plan, gates };
}

describe('layoutSpatialGate', () => {
  test('hands the layout off when the spatial gate answers yes', async () => {
    const plan = gatedPlanOf(makeRequest('put the weather on the left'), 'yes');
    const result = await layoutSpatialGate()(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('llm');
    expect(result.value.tree).toBeUndefined();
  });

  test('keeps the current tree when the spatial gate answers no and it fits', async () => {
    const plan = gatedPlanOf(makeRequest('set the weather to Tokyo'), 'no');
    const result = await layoutSpatialGate()(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('preserve');
  });

  test('falls back to the balanced default when the gate answers no and the visible set changed', async () => {
    const request = makeRequest('hide the tasks');
    const plan = gatedPlanOf(request, 'no', { 'tasks-main': 'hide' });
    const result = await layoutSpatialGate()(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
  });

  test('hands off when the gate answers no and nothing fits', async () => {
    const request = makeRequest('set the weather to Tokyo', {
      vessels: withMinSizes(vessels, () => ({ width: 20, height: 20 })),
    });
    const plan = gatedPlanOf(request, 'no');
    const result = await layoutSpatialGate()(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('llm');
  });
});

declare const select: SelectStage;
declare const actions: ActionsStage;
declare const complete: CompleteStage;

// Compiled by `typecheck` (tsconfig.spec.json); never executed.
function typeCases(): Planner[] {
  return [
    // @ts-expect-error layoutSpatialGate needs GatedActionPlan; a plain actions stage only produces ActionPlan2, whose gates are optional
    pipeline(select, actions, layoutSpatialGate(), complete),
  ];
}

test('layoutSpatialGate cannot follow an ungated action plan (type-level)', () => {
  expect(typeof typeCases).toBe('function');
});
