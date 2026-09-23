import { describe, expect, test } from 'bun:test';

import {
  type ChartRequest,
  isOk,
  type TilingNode,
} from '@maelstrom-co/protocol';

import { makeContext, makeRequest } from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import {
  buildReply,
  type Payload,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import {
  type ComposedPairsDecision,
  layoutComposedPairsWithDirection,
} from './layout-composed-pairs.js';
import type { GateAnswer, GatedActionPlan } from './types.js';

const SIDE_BY_SIDE = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

const PAIR_IDS = [
  'pair/calendar-main/weather-main',
  'pair/calendar-main/tasks-main',
  'pair/weather-main/tasks-main',
];

const LEANING_PAIR = {
  left_of: 0.04,
  right_of: 0,
  above: 0.39,
  below: 0.01,
  not_stated: 0.56,
};

type Distributions = Readonly<Record<string, Readonly<Record<string, number>>>>;

function gate(answer: 'yes' | 'no'): GateAnswer {
  return { answer, probability: answer === 'yes' ? 0.9 : 0.1, confidence: 0.8 };
}

function gatedPlan(request: ChartRequest) {
  return {
    ...actionPlan(request),
    minConfidence: 1,
    gates: {
      needsActions: gate('no'),
      generatedContent: gate('no'),
      spatial: gate('yes'),
    },
  } satisfies GatedActionPlan;
}

/** A reply answering every size question with an equal share and each listed choice question with its distribution. */
function replyWith(payload: Payload, distributions: Distributions) {
  const base = buildReply(
    payload,
    {},
    1,
    undefined,
    {},
    Object.fromEntries(
      Object.keys(payload.questions)
        .filter((id) => id.startsWith('size/'))
        .map((id) => [id, 2]),
    ),
  );
  const answers = { ...base.answers } as Record<string, unknown>;
  for (const [id, probabilities] of Object.entries(distributions)) {
    const [choice = '', top = 0] = Object.entries(probabilities).reduce(
      (best, entry) => (entry[1] > best[1] ? entry : best),
    );
    answers[id] = { type: 'choice', choice, confidence: top, probabilities };
  }
  return { ...base, answers };
}

async function run(request: ChartRequest, distributions: Distributions) {
  const plan = gatedPlan(request);
  const scripted = scriptedAsk((payload) => ({
    reply: replyWith(payload, distributions),
  }));
  const result = await layoutComposedPairsWithDirection(scripted.ask)(
    plan,
    makeContext(plan.selection.input),
  );
  if (!isOk(result)) throw new Error('expected a layout decision');
  return { decision: result.value as ComposedPairsDecision, ...scripted };
}

function pairs(probabilities: Readonly<Record<string, number>>) {
  return Object.fromEntries(PAIR_IDS.map((id) => [id, probabilities]));
}

describe('layoutComposedPairsWithDirection', () => {
  test('a stacked answer turns a side-by-side board stacked when every pair answers not stated', async () => {
    const { decision } = await run(
      makeRequest('put them all one over the other', { tree: SIDE_BY_SIDE }),
      {
        ...pairs(LEANING_PAIR),
        direction: { side_by_side: 0.05, stacked: 0.85, not_stated: 0.1 },
      },
    );
    expect(decision.pairwise.pairs?.map(({ answer }) => answer.choice)).toEqual(
      ['not_stated', 'not_stated', 'not_stated'],
    );
    expect(decision.source).toBe('jev');
    expect(decision.layoutId).toBe('composed-pairs-with-direction');
    expect(decision.tree?.[0]).toStartWith('H');
    expect(decision.pairwise.direction?.choice).toBe('stacked');
  });

  test('a not stated direction keeps the current board', async () => {
    const { decision } = await run(
      makeRequest('tidy the board', { tree: SIDE_BY_SIDE }),
      {
        ...pairs(LEANING_PAIR),
        direction: { side_by_side: 0.02, stacked: 0.08, not_stated: 0.9 },
      },
    );
    expect(decision.tree).toEqual(SIDE_BY_SIDE);
    expect(decision.pairwise.direction?.choice).toBe('not_stated');
  });

  test('adds one direction question to the pair and size questions, over the same state', async () => {
    const intent = 'stack them all';
    const { calls } = await run(makeRequest(intent, { tree: SIDE_BY_SIDE }), {
      ...pairs(LEANING_PAIR),
      direction: { side_by_side: 0.05, stacked: 0.85, not_stated: 0.1 },
    });
    expect(calls).toHaveLength(1);
    const payload = calls[0];
    expect(Object.keys(payload?.questions ?? {})).toEqual([
      ...PAIR_IDS,
      'size/calendar-main',
      'size/weather-main',
      'size/tasks-main',
      'direction',
    ]);
    const direction = payload?.questions.direction;
    expect(direction?.type).toBe('choice');
    expect(Object.keys(direction?.criteria ?? {})).toEqual([
      'side_by_side',
      'stacked',
      'not_stated',
    ]);
    expect(payload?.state).toEqual({
      request: intent,
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
});
