import { afterEach, describe, expect, test } from 'bun:test';

import type { Stage } from '@maelstrom-co/engine';
import {
  InstanceId,
  isOk,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { keepAll } from '../__test-helpers__/actions-fixtures.js';
import { makeContext, makeRequest } from '../__test-helpers__/fixtures.js';
import { planned } from '../__test-helpers__/layout-fixtures.js';
import {
  dummyAdapter,
  installMockChat,
  mockChat,
} from '../__test-helpers__/mock-chat.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { layoutComposedPairsGateAndDefer } from '../stages/layout-composed-pairs-gate-and-defer.js';
import type {
  CompleteStage,
  GateAnswer,
  GatedActionPlan,
  LayoutDecision,
} from '../stages/stage-types.js';
import type { SelectedInstance } from '../types.js';
import type { Ask } from '../typesafe-client.js';
import { completeLayoutParallel } from './complete-layout-parallel.js';
import { layoutKeepOrDefault } from './layout-keep-or-default.js';
import { layoutPreset } from './layout-preset.js';
import { layoutPresetOrLlm } from './layout-preset-or-llm.js';

installMockChat();

afterEach(() => mockChat.mockReset());

const LAYOUT_STAGES: readonly (readonly [
  string,
  (ask: Ask) => Stage<GatedActionPlan, LayoutDecision>,
])[] = [
  ['layoutPreset', (ask) => layoutPreset(ask)],
  [
    'layoutPreset placements',
    (ask) => layoutPreset(ask, { describe: 'placements' }),
  ],
  ['layoutPresetOrLlm', layoutPresetOrLlm],
  ['layoutKeepOrDefault', () => layoutKeepOrDefault],
  ['layoutComposedPairsGateAndDefer', layoutComposedPairsGateAndDefer],
];

const COMPLETE_STAGES: readonly (readonly [string, CompleteStage])[] = [
  ['completeLayoutInline', completeLayoutInline({ adapter: dummyAdapter })],
  ['completeLayoutParallel', completeLayoutParallel({ adapter: dummyAdapter })],
];

const TWO_BY_TWO = [
  'H',
  'V',
  'ID:calendar-main',
  'ID:weather-main',
  'V',
  'ID:tasks-main',
  'ID:map-new',
];

describe('declared variants', () => {
  for (const [layoutName, layout] of LAYOUT_STAGES)
    for (const [completeName, complete] of COMPLETE_STAGES)
      for (const spatial of ['yes', 'no'] as const)
        test(`${layoutName} then ${completeName}, spatial ${spatial}: a new Instance is never declared in its post-transition variant`, async () => {
          mockChat.mockResolvedValue({
            userMessage: 'Added a map with the route.',
            layout: { tree: TWO_BY_TWO },
            tree: TWO_BY_TWO,
          });
          const plan = createdMapWithRoute(spatial);
          const ctx = makeContext(plan.selection.input);
          const { ask } = scriptedAsk(() => ({ choices: {} }));
          const decision = await layout(ask)(plan, ctx);
          if (!isOk(decision)) throw new Error('expected a layout decision');
          const candidate = await complete(decision.value, ctx);
          if (!isOk(candidate)) throw new Error('expected a candidate');
          const { layout: shipped } = candidate.value;
          if (!('instances' in shipped))
            throw new Error('expected a tiling layout');
          const declared = Object.fromEntries(
            shipped.instances.map((instance) => [
              instance.instanceId,
              instance.variant,
            ]),
          );
          expect(declared['map-new']).toBe(VariantName('overview'));
          expect(declared['weather-main']).toBe(VariantName('weekly'));
        });
});

function createdMapWithRoute(spatial: 'yes' | 'no'): GatedActionPlan {
  const request = makeRequest(
    'add a map with the route home and the weekly weather',
  );
  const created: SelectedInstance = {
    instanceId: InstanceId('map-new'),
    vesselId: VesselId('map'),
    variant: VariantName('overview'),
    visible: true,
    fresh: true,
    decision: 'create',
  };
  return {
    selection: keepAll(request, [created]),
    actions: [
      planned('map-new/showRoute', { destination: 'Central Station' }),
      planned('weather-main/showWeekly'),
    ],
    asks: [],
    answers: [],
    minConfidence: 1,
    gates: {
      needsActions: gate('yes'),
      generatedContent: gate('no'),
      spatial: gate(spatial),
    },
  };
}

function gate(answer: 'yes' | 'no'): GateAnswer {
  return { answer, probability: answer === 'yes' ? 0.9 : 0.1, confidence: 0.8 };
}
