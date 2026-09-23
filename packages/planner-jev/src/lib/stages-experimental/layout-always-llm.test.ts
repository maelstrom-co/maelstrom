import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import { makeContext, makeRequest } from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import { layoutAlwaysLlm } from './layout-always-llm.js';
import type { ActionPlan2 } from './types.js';

describe('layoutAlwaysLlm', () => {
  test('always hands the layout off, without a tree', async () => {
    const request = makeRequest('put the map on the left');
    const plan: ActionPlan2 = { ...actionPlan(request), minConfidence: 1 };
    const result = await layoutAlwaysLlm()(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('llm');
    expect(result.value.tree).toBeUndefined();
    expect(result.value.layoutId).toBeUndefined();
    expect(result.value.plan).toBe(plan);
  });

  test('hands off even when the request has no spatial preference', async () => {
    const request = makeRequest('set the weather to Tokyo');
    const plan: ActionPlan2 = { ...actionPlan(request), minConfidence: 1 };
    const result = await layoutAlwaysLlm()(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('llm');
  });
});
