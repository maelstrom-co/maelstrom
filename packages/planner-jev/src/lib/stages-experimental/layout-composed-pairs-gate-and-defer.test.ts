import { describe, expect, test } from 'bun:test';

import { InstanceId, isOk } from '@maelstrom-co/protocol';

import { makeContext, makeRequest } from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import { layoutComposedPairsGateAndDefer } from './layout-composed-pairs-gate-and-defer.js';
import type { GatedActionPlan } from './types.js';

describe('layoutComposedPairsGateAndDefer', () => {
  test('still hands more than six visible Instances to the completion call without a call', async () => {
    const request = makeRequest('show everything');
    const base = actionPlan(request);
    const extra = request.vessels.slice(0, 4).map((vessel) => ({
      instanceId: InstanceId(`${vessel.id}-extra`),
      vesselId: vessel.id,
      variant: vessel.defaultVariant,
      visible: true,
      fresh: true,
      decision: 'create' as const,
    }));
    const gate = { answer: 'yes' as const, probability: 0.9, confidence: 0.8 };
    const plan: GatedActionPlan = {
      ...base,
      selection: {
        ...base.selection,
        instances: [...base.selection.instances, ...extra],
      },
      minConfidence: 1,
      gates: { needsActions: gate, generatedContent: gate, spatial: gate },
    };
    const scripted = scriptedAsk(() => ({ choices: {} }));
    const result = await layoutComposedPairsGateAndDefer(scripted.ask)(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(scripted.calls).toHaveLength(0);
    expect(result.value.source).toBe('llm');
    expect(result.value.pairwise.handOff).toBe('too_many_instances');
  });
});
