import { describe, expect, test } from 'bun:test';

import {
  ActionName,
  InstanceId,
  isOk,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { keepAll } from '../__test-helpers__/actions-fixtures.js';
import {
  deferralOf,
  makeContext,
  makeRequest,
  vessels,
} from '../__test-helpers__/fixtures.js';
import {
  actionPlan,
  withMinSizes,
} from '../__test-helpers__/layout-fixtures.js';
import type { ActionPlan2 } from '../stages/stage-types.js';
import type { SelectedInstance } from '../types.js';
import { layoutKeepOrDefault } from './layout-keep-or-default.js';

function planOf(
  request: ReturnType<typeof makeRequest>,
  decisions: Record<string, 'keep' | 'hide' | 'delete' | 'create'> = {},
): ActionPlan2 {
  return { ...actionPlan(request, [], decisions), minConfidence: 1 };
}

const SHOW_ALL_FIVE = { 'map-main': 'keep', 'journal-main': 'keep' } as const;

describe('layoutKeepOrDefault', () => {
  test('preserves the current tree when it still fits the visible set', async () => {
    const plan = planOf(makeRequest('set the weather to Tokyo'));
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('preserve');
    expect(result.value.tree).toEqual(
      plan.selection.input.request.layout.type === 'tiling'
        ? plan.selection.input.request.layout.tree
        : [],
    );
  });

  test('falls back to the balanced default when the visible set changed', async () => {
    const plan = planOf(makeRequest('hide the tasks'), {
      'tasks-main': 'hide',
    });
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
    expect(result.value.tree).toEqual([
      'V',
      'ID:calendar-main',
      'ID:weather-main',
    ]);
  });

  test('falls back to the balanced default when an instance was created', async () => {
    const request = makeRequest('add a map');
    const created: SelectedInstance = {
      instanceId: InstanceId('map-new'),
      vesselId: VesselId('map'),
      variant: VariantName('overview'),
      visible: true,
      fresh: true,
      decision: 'create',
    };
    const selection = keepAll(request, [created]);
    const plan: ActionPlan2 = {
      selection,
      actions: [],
      asks: [],
      answers: [],
      minConfidence: 1,
    };
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
  });

  test('falls back to two stacked rows when one side-by-side row is too narrow', async () => {
    const request = makeRequest('show the map and journal too', {
      vessels: withMinSizes(vessels, () => ({ width: 8, height: 4 })),
    });
    const plan = planOf(request, SHOW_ALL_FIVE);
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
    expect(result.value.layoutId).toBe('rows_2');
    expect(result.value.tree).toEqual([
      'H',
      'V:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
      'V',
      'ID:map-main',
      'ID:journal-main',
    ]);
  });

  test('falls back to three stacked rows when two rows are still too narrow', async () => {
    const request = makeRequest('show the map and journal too', {
      vessels: withMinSizes(vessels, () => ({ width: 11, height: 4 })),
    });
    const plan = planOf(request, SHOW_ALL_FIVE);
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
    expect(result.value.layoutId).toBe('rows_3');
  });

  test('lets a lone visible Instance fill the Chart', async () => {
    const plan = planOf(makeRequest('only the calendar'), {
      'weather-main': 'hide',
      'tasks-main': 'hide',
    });
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('default');
    expect(result.value.tree).toEqual(['ID:calendar-main']);
  });

  test('hands off when nothing fits, not even the default', async () => {
    const request = makeRequest('set the weather to Tokyo', {
      vessels: withMinSizes(vessels, () => ({ width: 20, height: 20 })),
    });
    const plan = planOf(request);
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a decision');
    expect(result.value.source).toBe('llm');
    expect(result.value.tree).toBeUndefined();
  });

  test('defers when action simulation fails', async () => {
    const request = makeRequest('open the Monday entry');
    const plan: ActionPlan2 = {
      ...planOf(request),
      actions: [
        {
          instanceId: InstanceId('calendar-main'),
          action: ActionName('not-a-real-action'),
          params: {},
          pending: [],
        },
      ],
    };
    const result = await layoutKeepOrDefault(
      plan,
      makeContext(plan.selection.input),
    );
    expect(deferralOf(result)).toBe('jevLayout/simulation_failed');
  });
});
