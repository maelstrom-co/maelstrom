import { describe, expect, test } from 'bun:test';
import type {
  ActionPlan2,
  Selection2,
} from '@maelstrom-co/planner-jev/_internal';
import { makeContext, makeInput } from '@maelstrom-co/planner-jev/_testing';
import { isOk } from '@maelstrom-co/protocol';
import { type Scenario, selectScenarios } from '../../core/scenarios.js';
import { goldInputs, layoutDeferralGoldInputs } from './gold-inputs.js';

function scenario(id: string): Scenario {
  const [found] = selectScenarios('all', [id]);
  if (found === undefined) throw new Error(`no scenario ${id}`);
  return found;
}

async function run(
  id: string,
  shape: 'gated' | 'ungated' = 'gated',
  form: typeof goldInputs = goldInputs,
): Promise<ActionPlan2> {
  const gold = form(scenario(id), shape);
  if (!gold.applicable) throw new Error(gold.reason);
  const input = makeInput(scenario(id).request);
  const ctx = makeContext(input);
  const selected = await gold.stages.jevSelect?.(input, ctx);
  if (!selected || !isOk(selected)) throw new Error('select failed');
  const planned = await gold.stages.jevActions?.(selected.value, ctx);
  if (!planned || !isOk(planned)) throw new Error('actions failed');
  return planned.value as ActionPlan2;
}

function decisions(selection: Selection2) {
  return Object.fromEntries(
    selection.instances.map((instance) => [
      instance.instanceId,
      [instance.decision, instance.visible],
    ]),
  );
}

describe('goldInputs', () => {
  test('forms a spatial scenario with the spatial gate on and the rest hidden', async () => {
    const plan = await run('focus');
    expect(plan.gates).toMatchObject({
      needsActions: { answer: 'no' },
      generatedContent: { answer: 'no' },
      spatial: { answer: 'yes', probability: 1 },
    });
    expect(decisions(plan.selection)).toEqual({
      'calendar-main': ['keep', true],
      'weather-main': ['keep', true],
      'tasks-main': ['keep', true],
      'map-main': ['hide', false],
      'journal-main': ['hide', false],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.minConfidence).toBe(1);
  });

  test('forms a non-spatial scenario that creates and configures an Instance', async () => {
    const plan = await run('create-configure');
    expect(plan.gates).toMatchObject({
      needsActions: { answer: 'yes' },
      spatial: { answer: 'no', probability: 0 },
    });
    expect(
      plan.selection.instances.find(
        (instance) => instance.instanceId === 'weather-jev-1',
      ),
    ).toEqual({
      instanceId: 'weather-jev-1',
      vesselId: 'weather',
      variant: 'current',
      visible: true,
      fresh: true,
      decision: 'create',
    } as never);
    expect(plan.actions).toEqual([
      {
        instanceId: 'weather-jev-1',
        action: 'setLocation',
        params: { location: 'Paris' },
        pending: [],
      },
    ] as never);
  });

  test('deletes an Instance the expectation no longer retains', async () => {
    const plan = await run('delete');
    expect(decisions(plan.selection)['weather-main']).toEqual([
      'delete',
      false,
    ]);
  });

  test('carries no gates for an ungated arm', async () => {
    const plan = await run('focus', 'ungated');
    expect(plan.gates).toBe(undefined);
    expect(plan.selection.gates).toBe(undefined);
  });

  test('is not applicable to a scenario that expects a deferral', () => {
    expect(goldInputs(scenario('ambiguous'))).toEqual({
      applicable: false,
      reason: 'expects a deferral',
    });
    expect(goldInputs(scenario('small-chart'))).toEqual({
      applicable: false,
      reason: 'expects a deferral',
    });
  });
});

describe('layoutDeferralGoldInputs', () => {
  test('keeps the board as it is for a scenario that expects the layout stage to defer', async () => {
    const plan = await run('small-chart', 'gated', layoutDeferralGoldInputs);
    expect(plan.gates).toMatchObject({
      needsActions: { answer: 'no' },
      generatedContent: { answer: 'no' },
      spatial: { answer: 'yes', probability: 1 },
    });
    expect(decisions(plan.selection)).toEqual({
      'calendar-main': ['keep', true],
      'weather-main': ['keep', true],
      'tasks-main': ['keep', true],
      'map-main': ['hide', false],
      'journal-main': ['hide', false],
    });
    expect(plan.actions).toEqual([]);
  });

  test('answers the spatial gate no for an untagged scenario', async () => {
    const plan = await run('tiny-resize', 'gated', layoutDeferralGoldInputs);
    expect(plan.gates?.spatial).toMatchObject({ answer: 'no', probability: 0 });
  });

  test('is not applicable to a deferral at another stage or to a planned scenario', () => {
    expect(layoutDeferralGoldInputs(scenario('ambiguous'))).toEqual({
      applicable: false,
      reason: 'expects no layout stage deferral',
    });
    expect(layoutDeferralGoldInputs(scenario('missing-enum'))).toEqual({
      applicable: false,
      reason: 'expects no layout stage deferral',
    });
    expect(layoutDeferralGoldInputs(scenario('focus'))).toEqual({
      applicable: false,
      reason: 'expects no layout stage deferral',
    });
  });
});
