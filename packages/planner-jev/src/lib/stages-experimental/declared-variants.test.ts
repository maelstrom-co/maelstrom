import { afterEach, describe, expect, test } from 'bun:test';

import type { PlannerCandidate, Stage } from '@maelstrom-co/engine';
import {
  ActionName,
  InstanceId,
  isOk,
  VariantName,
  type Vessel,
  VesselId,
} from '@maelstrom-co/protocol';

import { keepAll } from '../__test-helpers__/actions-fixtures.js';
import {
  makeContext,
  makeRequest,
  vessels,
} from '../__test-helpers__/fixtures.js';
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
import type { PlannedAction, SelectedInstance } from '../types.js';
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

interface Scenario {
  readonly name: string;
  readonly intent: string;
  readonly created: { readonly id: string; readonly vesselId: string };
  readonly createdIn: string;
  readonly actions: readonly PlannedAction[];
  readonly vessels?: readonly Vessel[];
  readonly declared: string;
  readonly executionPlan: PlannerCandidate['executionPlan'];
}

const WEEKLY = step('weather-main/showWeekly');

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a new map with a route is declared in route and keeps showRoute',
    intent: 'add a map with the route home and the weekly weather',
    created: { id: 'map-new', vesselId: 'map' },
    createdIn: 'overview',
    actions: [
      planned('map-new/showRoute', { destination: 'Central Station' }),
      planned('weather-main/showWeekly'),
    ],
    declared: 'route',
    executionPlan: [
      step('map-new/showRoute', '{"destination":"Central Station"}'),
      WEEKLY,
    ],
  },
  {
    name: 'a new calendar switched to week is declared in week without the switch',
    intent: 'add a calendar for this week and the weekly weather',
    created: { id: 'calendar-new', vesselId: 'calendar' },
    createdIn: 'month',
    actions: [
      planned('calendar-new/showWeek'),
      planned('weather-main/showWeekly'),
    ],
    declared: 'week',
    executionPlan: [WEEKLY],
  },
  {
    name: 'a new map keeps its created variant and actions when a parameterized action is not offered in its final variant',
    intent: 'add a map focused on the office and the weekly weather',
    created: { id: 'map-new', vesselId: 'map' },
    createdIn: 'overview',
    actions: [
      planned('map-new/focusLocation', { name: 'Office' }),
      planned('weather-main/showWeekly'),
    ],
    vessels: withCompactMap(),
    declared: 'overview',
    executionPlan: [step('map-new/focusLocation', '{"name":"Office"}'), WEEKLY],
  },
];

describe('declared variants', () => {
  for (const scenario of SCENARIOS)
    for (const [layoutName, layout] of LAYOUT_STAGES)
      for (const [completeName, complete] of COMPLETE_STAGES)
        for (const spatial of ['yes', 'no'] as const)
          test(`${layoutName} then ${completeName}, spatial ${spatial}: ${scenario.name}`, async () => {
            const tree = [
              'H',
              'V',
              'ID:calendar-main',
              'ID:weather-main',
              'V',
              'ID:tasks-main',
              `ID:${scenario.created.id}`,
            ];
            mockChat.mockResolvedValue({
              userMessage: 'Done.',
              layout: { tree },
              tree,
            });
            const plan = creating(scenario, spatial);
            const ctx = makeContext(plan.selection.input);
            const { ask } = scriptedAsk(() => ({ choices: {} }));
            const decision = await layout(ask)(plan, ctx);
            if (!isOk(decision)) throw new Error('expected a layout decision');
            const candidate = await complete(decision.value, ctx);
            if (!isOk(candidate)) throw new Error('expected a candidate');
            const { layout: shipped, executionPlan } = candidate.value;
            if (!('instances' in shipped))
              throw new Error('expected a tiling layout');
            const declared = Object.fromEntries(
              shipped.instances.map((instance) => [
                instance.instanceId,
                instance.variant,
              ]),
            );
            expect(declared[scenario.created.id]).toBe(
              VariantName(scenario.declared),
            );
            expect(declared['weather-main']).toBe(VariantName('weekly'));
            expect(executionPlan).toEqual(scenario.executionPlan);
          });
});

function creating(scenario: Scenario, spatial: 'yes' | 'no'): GatedActionPlan {
  const request = makeRequest(scenario.intent, {
    ...(scenario.vessels && { vessels: scenario.vessels }),
  });
  const created: SelectedInstance = {
    instanceId: InstanceId(scenario.created.id),
    vesselId: VesselId(scenario.created.vesselId),
    variant: VariantName(scenario.createdIn),
    visible: true,
    fresh: true,
    decision: 'create',
  };
  return {
    selection: keepAll(request, [created]),
    actions: scenario.actions,
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

function withCompactMap(): readonly Vessel[] {
  const focusLocation = {
    name: ActionName('focusLocation'),
    description: 'Focus a saved place',
    idempotent: false,
    parameters: [
      { name: 'name', type: 'string' as const, description: 'Place name' },
    ],
    transitionsTo: VariantName('compact'),
  };
  return vessels.map((vessel) => {
    const overview = vessel.variants[VariantName('overview')];
    if (vessel.id !== 'map' || overview === undefined) return vessel;
    return {
      ...vessel,
      variants: {
        ...vessel.variants,
        overview: {
          ...overview,
          actions: [...overview.actions, focusLocation],
        },
        compact: { ...overview, actions: [] },
      },
    };
  });
}

function step(
  target: string,
  paramsJson?: string,
): PlannerCandidate['executionPlan'][number] {
  const [instanceId, action] = target.split('/');
  return {
    instanceId: InstanceId(instanceId),
    action: ActionName(action),
    ...(paramsJson !== undefined && { paramsJson }),
  };
}
