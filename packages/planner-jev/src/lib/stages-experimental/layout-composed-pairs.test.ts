import { describe, expect, test } from 'bun:test';

import { type ChartRequest, InstanceId, isOk } from '@maelstrom-co/protocol';

import { makeContext, makeRequest } from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import { type Step, scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import {
  type ComposedPairsDecision,
  layoutComposedPairs,
} from './layout-composed-pairs.js';
import type { GateAnswer, GatedActionPlan } from './types.js';

const FOCUS_INTENT =
  'Put the calendar on the left of the weather and the tasks, and the weather above the tasks. Give the calendar two thirds of the board.';

const FOCUS_STEP: Step = {
  choices: {
    'pair/calendar-main/weather-main': 'left_of',
    'pair/calendar-main/tasks-main': 'left_of',
    'pair/weather-main/tasks-main': 'above',
  },
  scores: {
    'size/calendar-main': 4,
    'size/weather-main': 1,
    'size/tasks-main': 1,
  },
  confidence: 0.8,
};

const NOTHING_STATED: Step = {
  choices: {
    'pair/calendar-main/weather-main': 'not_stated',
    'pair/calendar-main/tasks-main': 'not_stated',
    'pair/weather-main/tasks-main': 'not_stated',
  },
  scores: {
    'size/calendar-main': 2,
    'size/weather-main': 2,
    'size/tasks-main': 2,
  },
};

function gate(answer: 'yes' | 'no'): GateAnswer {
  return { answer, probability: answer === 'yes' ? 0.9 : 0.1, confidence: 0.8 };
}

function gatedPlan(request: ChartRequest, spatial: 'yes' | 'no') {
  return {
    ...actionPlan(request),
    minConfidence: 1,
    gates: {
      needsActions: gate('no'),
      generatedContent: gate('no'),
      spatial: gate(spatial),
    },
  } satisfies GatedActionPlan;
}

async function run(plan: GatedActionPlan, step: Step) {
  const scripted = scriptedAsk(() => step);
  const result = await layoutComposedPairs(scripted.ask)(
    plan,
    makeContext(plan.selection.input),
  );
  if (!isOk(result)) throw new Error('expected a layout decision');
  return { decision: result.value as ComposedPairsDecision, ...scripted };
}

describe('layoutComposedPairs', () => {
  test('the focus example assembles its tree with the calendar large', async () => {
    const plan = gatedPlan(makeRequest(FOCUS_INTENT), 'yes');
    const { decision, calls } = await run(plan, FOCUS_STEP);
    expect(calls).toHaveLength(1);
    expect(decision.source).toBe('jev');
    expect(decision.layoutId).toBe('composed-pairs');
    expect(decision.tree).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(decision.pairwise).toMatchObject({
      route: 'spatial',
      called: true,
      chosen: 0,
    });
    expect(decision.pairwise.candidates).toHaveLength(3);
    expect(decision.pairwise.margin).toBeGreaterThan(0);
    expect(decision.pairwise.sizes?.['calendar-main']).toMatchObject({
      level: '4',
      size: 1,
    });
  });

  test('asks one question per pair and one size question per Instance, over a plain state', async () => {
    const plan = gatedPlan(makeRequest(FOCUS_INTENT), 'yes');
    const { calls } = await run(plan, FOCUS_STEP);
    const payload = calls[0];
    expect(Object.keys(payload?.questions ?? {})).toEqual([
      'pair/calendar-main/weather-main',
      'pair/calendar-main/tasks-main',
      'pair/weather-main/tasks-main',
      'size/calendar-main',
      'size/weather-main',
      'size/tasks-main',
    ]);
    expect(
      Object.keys(
        payload?.questions['pair/calendar-main/weather-main']?.criteria ?? {},
      ),
    ).toEqual(['left_of', 'right_of', 'above', 'below', 'not_stated']);
    expect(payload?.state).toEqual({
      request: FOCUS_INTENT,
      currentArrangement:
        'calendar-main on the left; weather-main in the middle; tasks-main on the right',
      instances: [
        {
          id: 'calendar-main',
          widget: 'calendar',
          variant: expect.any(String),
        },
        { id: 'weather-main', widget: 'weather', variant: expect.any(String) },
        { id: 'tasks-main', widget: 'tasks', variant: expect.any(String) },
      ],
    });
  });

  test('not stated keeps the current relation of every pair', async () => {
    const plan = gatedPlan(
      makeRequest('rearrange a bit', {
        tree: [
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
      }),
      'yes',
    );
    const { decision } = await run(plan, NOTHING_STATED);
    expect(decision.tree).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(decision.pairwise.pairs?.[0]?.answer.choice).toBe('not_stated');
  });

  test('keeps the current tree without a call when no arrangement is stated and the Instances are the same', async () => {
    const plan = gatedPlan(makeRequest('refresh the weather'), 'no');
    const { decision, calls } = await run(plan, NOTHING_STATED);
    expect(calls).toHaveLength(0);
    expect(decision.source).toBe('preserve');
    expect(decision.pairwise).toEqual({
      route: 'same_instances',
      called: false,
      candidates: [],
    });
  });

  test('hands off without a call when more than six Instances are visible', async () => {
    const base = gatedPlan(makeRequest('show everything'), 'yes');
    const extra = base.selection.input.request.vessels
      .slice(0, 4)
      .map((vessel) => ({
        instanceId: InstanceId(`${vessel.id}-extra`),
        vesselId: vessel.id,
        variant: vessel.defaultVariant,
        visible: true,
        fresh: true,
        decision: 'create' as const,
      }));
    const plan: GatedActionPlan = {
      ...base,
      selection: {
        ...base.selection,
        instances: [...base.selection.instances, ...extra],
      },
    };
    const { decision, calls } = await run(plan, NOTHING_STATED);
    expect(calls).toHaveLength(0);
    expect(decision.source).toBe('llm');
    expect(decision.tree).toBeUndefined();
    expect(decision.pairwise.handOff).toBe('too_many_instances');
  });
});
