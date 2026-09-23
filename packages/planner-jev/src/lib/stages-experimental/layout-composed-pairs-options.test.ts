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
  type Step,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import {
  type ComposedPairsDecision,
  type ComposedPairsOptions,
  layoutComposedPairsWithOptions,
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
        .filter((id) => id.startsWith('size'))
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

async function runWith(
  options: ComposedPairsOptions,
  request: ChartRequest,
  step: (payload: Payload) => Step,
) {
  const plan = gatedPlan(request);
  const scripted = scriptedAsk(step);
  const result = await layoutComposedPairsWithOptions(scripted.ask, options)(
    plan,
    makeContext(plan.selection.input),
  );
  if (!isOk(result)) throw new Error('expected a layout decision');
  return { decision: result.value as ComposedPairsDecision, ...scripted };
}

describe('direction redirects not stated', () => {
  const leaningToColumn = {
    left_of: 0.02,
    right_of: 0,
    above: 0.4,
    below: 0.03,
    not_stated: 0.55,
  };
  const distributions = {
    ...Object.fromEntries(PAIR_IDS.map((id) => [id, leaningToColumn])),
    direction: { side_by_side: 0, stacked: 1, not_stated: 0 },
  };
  const request = makeRequest(
    'Stack the visible widgets vertically in equal rows.',
    { tree: SIDE_BY_SIDE },
  );

  test('a stacked answer stacks every pair that answers not stated', async () => {
    const { decision } = await runWith(
      { layoutId: 'redirect', direction: 'redirects_not_stated' },
      request,
      (payload) => ({ reply: replyWith(payload, distributions) }),
    );
    expect(decision.layoutId).toBe('redirect');
    expect(decision.tree).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('a scored direction alone keeps one pair side by side', async () => {
    const { decision } = await runWith(
      { layoutId: 'scored', direction: 'scored' },
      request,
      (payload) => ({ reply: replyWith(payload, distributions) }),
    );
    expect(decision.tree?.[0]).toStartWith('H');
    expect(decision.tree).toContain('V');
  });
});

describe('size fallback', () => {
  const stripStep: Step = {
    choices: {
      'pair/calendar-main/weather-main': 'left_of',
      'pair/calendar-main/tasks-main': 'above',
      'pair/weather-main/tasks-main': 'above',
    },
    scores: {
      'size/calendar-main': 4,
      'size/weather-main': 4,
      'size/tasks-main': 0,
    },
    confidence: 1,
  };

  test('raises a part below its minimum and keeps the best structure', async () => {
    const request = makeRequest('Put the tasks in a tiny strip at the bottom.');
    const plain = await runWith(
      { layoutId: 'plain' },
      request,
      () => stripStep,
    );
    expect(plain.decision.pairwise.handOff).toBe('nothing_fits');
    const { decision } = await runWith(
      { layoutId: 'fallback', sizeFallback: true },
      request,
      () => stripStep,
    );
    expect(decision.source).toBe('jev');
    expect(decision.pairwise.fallback).toEqual({
      kind: 'raised_to_minimum',
      candidate: 0,
    });
    expect(decision.pairwise.chosen).toBeUndefined();
    expect(decision.tree?.slice(1)).toEqual([
      'V',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('hands off when no retried structure can fit', async () => {
    const request = makeRequest('Put them in a row.', {
      tree: SIDE_BY_SIDE,
      columns: 8,
    });
    const { decision } = await runWith(
      { layoutId: 'fallback', sizeFallback: true },
      request,
      () => ({
        choices: {
          'pair/calendar-main/weather-main': 'left_of',
          'pair/calendar-main/tasks-main': 'left_of',
          'pair/weather-main/tasks-main': 'left_of',
        },
        confidence: 1,
      }),
    );
    expect(decision.source).toBe('llm');
    expect(decision.pairwise.handOff).toBe('nothing_fits');
    expect(decision.pairwise.fallback).toBeUndefined();
  });
});

describe('whole-board examples', () => {
  test('adds whole-board phrases to the side options of every pair', async () => {
    const { calls } = await runWith(
      { layoutId: 'examples', wholeBoardExamples: true },
      makeRequest(FOCUS_INTENT),
      () => FOCUS_STEP,
    );
    const criteria = calls[0]?.questions[PAIR_IDS[0] ?? '']?.criteria ?? {};
    for (const option of ['above', 'below'])
      for (const phrase of [
        'stack them all',
        'in one column',
        'in a column',
        'one on top of the other',
      ])
        expect(JSON.stringify(criteria[option])).toContain(phrase);
    for (const option of ['left_of', 'right_of'])
      for (const phrase of ['in a row', 'all side by side'])
        expect(JSON.stringify(criteria[option])).toContain(phrase);
  });
});

describe('sizes', () => {
  test('splits inside a part by a size question about the widgets it sits with', async () => {
    const { decision, calls } = await runWith(
      { layoutId: 'within', sizeWithinPart: true },
      makeRequest(FOCUS_INTENT),
      () => ({
        ...FOCUS_STEP,
        scores: {
          ...(FOCUS_STEP as { scores: Record<string, number> }).scores,
          'size_in_group/calendar-main': 2,
          'size_in_group/weather-main': 3,
          'size_in_group/tasks-main': 2,
        },
      }),
    );
    expect(Object.keys(calls[0]?.questions ?? {})).toContain(
      'size_in_group/weather-main',
    );
    expect(decision.tree).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H:3,2',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(decision.pairwise.groupSizes?.['weather-main']?.level).toBe('3');
  });

  test('weights a part by the largest share of its members', async () => {
    const { decision } = await runWith(
      { layoutId: 'max', partWeight: 'max' },
      makeRequest(FOCUS_INTENT),
      () => FOCUS_STEP,
    );
    expect(decision.tree?.[0]).toBe('V:4,1');
  });

  test('bigger size steps make the largest level three times an equal share', async () => {
    const { decision } = await runWith(
      { layoutId: 'bigger', sizeSteps: 'bigger' },
      makeRequest(FOCUS_INTENT),
      () => FOCUS_STEP,
    );
    expect(decision.tree?.[0]).toBe('V:3,1');
    expect(decision.pairwise.sizes?.['calendar-main']?.size).toBe(1.5);
  });
});

describe('lean state', () => {
  test('sends only the request and each Instance with its widget', async () => {
    const { calls } = await runWith(
      { layoutId: 'lean', leanState: true },
      makeRequest(FOCUS_INTENT),
      () => FOCUS_STEP,
    );
    expect(calls[0]?.state).toEqual({
      request: FOCUS_INTENT,
      instances: [
        { id: 'calendar-main', widget: 'calendar' },
        { id: 'weather-main', widget: 'weather' },
        { id: 'tasks-main', widget: 'tasks' },
      ],
    });
  });
});
