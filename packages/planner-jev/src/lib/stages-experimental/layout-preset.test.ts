import { describe, expect, test } from 'bun:test';

import { type ChartRequest, isOk } from '@maelstrom-co/protocol';

import { makeRequest } from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import type { Script } from '../__test-helpers__/scripted-fetch.js';
import { runPair } from '../__test-helpers__/stage-pair.js';
import { jevLayout } from '../stages/jev-layout.js';
import { layoutPreset } from './layout-preset.js';
import type { ActionPlan2 } from './types.js';

function planOf(
  request: ChartRequest,
  actions: readonly string[] = [],
): ActionPlan2 {
  return { ...actionPlan(request, actions), minConfidence: 1 };
}

function pair(plan: ActionPlan2, script: Script) {
  return runPair(jevLayout, layoutPreset, plan, plan.selection.input, script);
}

describe('layoutPreset', () => {
  test('sends the POC layout call and wraps its choice as a Jev decision', async () => {
    const plan = planOf(makeRequest('open the Monday entry'), [
      'journal-main/openEntry',
    ]);
    const { poc, next } = await pair(plan, () => ({
      choices: {},
      confidence: 0.4,
    }));
    expect(next.calls).toEqual(poc.calls);
    if (!isOk(next.result)) throw new Error('expected a layout');
    const { value } = poc.result as {
      value: { layoutId: string; tree: unknown[]; answers: unknown[] };
    };
    expect(next.result.value.plan).toBe(plan);
    expect(next.result.value.source).toBe('jev');
    expect(next.plain).toMatchObject({
      value: {
        layoutId: value.layoutId,
        tree: value.tree,
        answers: value.answers,
      },
    });
  });

  test('defers exactly like the POC', async () => {
    const plan = planOf(makeRequest('put the weather on the left'));
    const { poc, next } = await pair(plan, () => ({
      choices: { layout: 'unavailable' },
    }));
    expect(next.plain).toEqual(poc.result);
    expect(poc.result).toMatchObject({
      error: { reason: 'jevLayout/layout_unavailable' },
    });
  });

  test('with placements, describes each layout by its Instances and positions', async () => {
    const plan = planOf(makeRequest('arrange'));
    const { poc, next } = await runPair(
      jevLayout,
      (ask) => layoutPreset(ask, { describe: 'placements' }),
      plan,
      plan.selection.input,
      () => ({ choices: {}, confidence: 1 }),
    );
    const pocCriteria = poc.calls[0]?.questions.layout?.criteria ?? {};
    const nextCriteria = next.calls[0]?.questions.layout?.criteria ?? {};
    expect(nextCriteria.preserve).toBeDefined();
    expect(nextCriteria.preserve).not.toEqual(pocCriteria.preserve);
    for (const instance of ['calendar-main', 'weather-main', 'tasks-main'])
      expect(nextCriteria.preserve).toContain(instance);
    if (!isOk(next.result)) throw new Error('expected a layout');
    expect(next.result.value.source).toBe('jev');
  });
});
