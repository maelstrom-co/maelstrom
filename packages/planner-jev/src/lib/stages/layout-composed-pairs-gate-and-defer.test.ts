import { describe, expect, test } from 'bun:test';

import {
  type ChartRequest,
  InstanceId,
  isOk,
  type TilingNode,
} from '@maelstrom-co/protocol';

import {
  deferralOf,
  makeContext,
  makeRequest,
} from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import {
  demoTurn,
  demoTurnPlan,
  recordedAsk,
} from '../__test-helpers__/layout-replay.js';
import {
  buildReply,
  type Payload,
  type Step,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import {
  COMPOSED_PAIRS_GATE_AND_DEFER_LAYOUT_ID,
  type ComposedPairsDecision,
  layoutComposedPairsGateAndDefer,
} from './layout-composed-pairs-gate-and-defer.js';
import type { GateAnswer, GatedActionPlan } from './stage-types.js';

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

const LEANING_PAIR = {
  left_of: 0.04,
  right_of: 0,
  above: 0.39,
  below: 0.01,
  not_stated: 0.56,
};

const WEATHER_STRIP_UNDER_NESTED_LAYOUT = [
  'H:3,1',
  'V:2,1',
  'H',
  'ID:calendar-main',
  'ID:tasks-main',
  'ID:map-jev-1',
  'ID:weather-jev-1',
] as TilingNode[];

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
      dependsOnScreen: gate('no'),
    },
  } satisfies GatedActionPlan;
}

/** {@link gatedPlan} with the spatial gate answering no. */
function notSpatialPlan(request: ChartRequest): GatedActionPlan {
  const plan = gatedPlan(request);
  return { ...plan, gates: { ...plan.gates, spatial: gate('no') } };
}

/** A reply answering every whole-Chart size question with an equal share and each listed choice question with its distribution. */
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

function pairs(probabilities: Readonly<Record<string, number>>) {
  return Object.fromEntries(PAIR_IDS.map((id) => [id, probabilities]));
}

async function run(
  request: ChartRequest,
  step: (payload: Payload) => Step,
  plan: GatedActionPlan = gatedPlan(request),
) {
  const { result, ...scripted } = await runResult(step, plan);
  if (!isOk(result)) throw new Error('expected a layout decision');
  return { decision: result.value as ComposedPairsDecision, ...scripted };
}

/** Like {@link run}, but returns the stage's result as it is, deferral included. */
async function runResult(
  step: (payload: Payload) => Step,
  plan: GatedActionPlan,
) {
  const scripted = scriptedAsk(step);
  const result = await layoutComposedPairsGateAndDefer(scripted.ask)(
    plan,
    makeContext(plan.selection.input),
  );
  return { result, ...scripted };
}

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
      gates: {
        needsActions: gate,
        generatedContent: gate,
        spatial: gate,
        dependsOnScreen: gate,
      },
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

  test('the focus example assembles its tree with the calendar large', async () => {
    const { decision, calls } = await run(
      makeRequest(FOCUS_INTENT),
      () => FOCUS_STEP,
    );
    expect(calls).toHaveLength(1);
    expect(decision.source).toBe('jev');
    expect(decision.layoutId).toBe(COMPOSED_PAIRS_GATE_AND_DEFER_LAYOUT_ID);
    expect(decision.tree).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(decision.layoutSummary).toMatch(
      /^changed\. Before: .*\. Now: calendar-main on the left \(2\/3 of the width\); weather-main and tasks-main stacked on the right \(1\/3 of the width\)$/,
    );
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

  test('asks the pair, size, fraction and direction questions in one call, over a plain state', async () => {
    const { calls } = await run(makeRequest(FOCUS_INTENT), () => FOCUS_STEP);
    const payload = calls[0];
    expect(Object.keys(payload?.questions ?? {})).toEqual([
      ...PAIR_IDS,
      'size/calendar-main',
      'size/weather-main',
      'size/tasks-main',
      'size_stated_in_group/calendar-main',
      'fraction_in_group/calendar-main',
      'size_stated_in_group/weather-main',
      'fraction_in_group/weather-main',
      'size_stated_in_group/tasks-main',
      'fraction_in_group/tasks-main',
      'direction',
    ]);
    expect(
      Object.keys(
        payload?.questions['pair/calendar-main/weather-main']?.criteria ?? {},
      ),
    ).toEqual(['left_of', 'right_of', 'above', 'below', 'not_stated']);
    expect(payload?.questions['size_stated_in_group/weather-main']?.type).toBe(
      'noul',
    );
    expect(payload?.questions['fraction_in_group/weather-main']?.type).toBe(
      'score',
    );
    expect(Object.keys(payload?.questions.direction?.criteria ?? {})).toEqual([
      'side_by_side',
      'stacked',
      'not_stated',
    ]);
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

  test('adds whole-board phrases to the side options of every pair', async () => {
    const { calls } = await run(makeRequest(FOCUS_INTENT), () => FOCUS_STEP);
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

describe('not stated answers', () => {
  const stacked = [
    'H:1,1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ] as TilingNode[];

  test('not stated keeps the current relation of every pair', async () => {
    const request = makeRequest('rearrange a bit', { tree: stacked });
    const { decision } = await run(
      request,
      () => ({
        choices: {
          ...Object.fromEntries(PAIR_IDS.map((id) => [id, 'not_stated'])),
          direction: 'not_stated',
        },
        scores: {
          'size/calendar-main': 2,
          'size/weather-main': 2,
          'size/tasks-main': 2,
        },
      }),
      notSpatialPlan(request),
    );
    expect(decision.tree).toEqual(stacked);
    expect(decision.pairwise.pairs?.[0]?.answer.choice).toBe('not_stated');
  });

  test('a not stated direction keeps the current board', async () => {
    const request = makeRequest('tidy the board', { tree: SIDE_BY_SIDE });
    const { decision } = await run(
      request,
      (payload) => ({
        reply: replyWith(payload, {
          ...pairs(LEANING_PAIR),
          direction: { side_by_side: 0.02, stacked: 0.08, not_stated: 0.9 },
        }),
      }),
      notSpatialPlan(request),
    );
    expect(decision.tree).toEqual(SIDE_BY_SIDE);
    expect(decision.pairwise.direction?.choice).toBe('not_stated');
  });

  test('a stacked answer turns a side-by-side board stacked when every pair answers not stated', async () => {
    const { decision } = await run(
      makeRequest('put them all one over the other', { tree: SIDE_BY_SIDE }),
      (payload) => ({
        reply: replyWith(payload, {
          ...pairs(LEANING_PAIR),
          direction: { side_by_side: 0.05, stacked: 0.85, not_stated: 0.1 },
        }),
      }),
    );
    expect(decision.pairwise.pairs?.map(({ answer }) => answer.choice)).toEqual(
      ['not_stated', 'not_stated', 'not_stated'],
    );
    expect(decision.source).toBe('jev');
    expect(decision.tree?.[0]).toStartWith('H');
    expect(decision.pairwise.direction?.choice).toBe('stacked');
  });

  test('a stacked answer stacks every pair that answers not stated', async () => {
    const leaningToColumn = {
      left_of: 0.02,
      right_of: 0,
      above: 0.4,
      below: 0.03,
      not_stated: 0.55,
    };
    const { decision } = await run(
      makeRequest('Stack the visible widgets vertically in equal rows.', {
        tree: SIDE_BY_SIDE,
      }),
      (payload) => ({
        reply: replyWith(payload, {
          ...pairs(leaningToColumn),
          direction: { side_by_side: 0, stacked: 1, not_stated: 0 },
        }),
      }),
    );
    expect(decision.tree).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });
});

describe('direction redirects not stated only when it changes the top split', () => {
  const columnThenTasks = [
    'V:1,1',
    'H:1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ] as TilingNode[];
  const unstated = {
    left_of: 0.02,
    right_of: 0,
    above: 0.03,
    below: 0,
    not_stated: 0.95,
  };
  const request = makeRequest(
    'Make the weather twice as tall as the calendar.',
    {
      tree: columnThenTasks,
    },
  );
  const reply =
    (direction: Readonly<Record<string, number>>) => (payload: Payload) => ({
      reply: replyWith(payload, { ...pairs(unstated), direction }),
    });

  test('keeps the column when the direction is the current top split', async () => {
    const { decision } = await run(
      request,
      reply({ side_by_side: 0.8, stacked: 0.1, not_stated: 0.1 }),
    );
    expect(decision.tree).toEqual([
      'V:2,1',
      'H',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('stacks every pair when the direction crosses the current top split', async () => {
    const { decision } = await run(
      request,
      reply({ side_by_side: 0.1, stacked: 0.8, not_stated: 0.1 }),
    );
    expect(decision.tree).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });
});

/** The reply to `step` with each listed score question answered with that fractional score and distribution. */
function withScores(
  payload: Payload,
  step: Extract<Step, { readonly choices: unknown }>,
  scores: Readonly<
    Record<
      string,
      {
        readonly score: number;
        readonly confidence: number;
        readonly probabilities: Readonly<Record<string, number>>;
      }
    >
  >,
) {
  const base = buildReply(
    payload,
    step.choices,
    step.confidence ?? 1,
    undefined,
    step.nouls,
    step.scores,
  );
  const answers = { ...base.answers } as Record<string, unknown>;
  for (const [id, answer] of Object.entries(scores)) {
    const levels = Object.values(payload.questions[id]?.criteria ?? {});
    answers[id] = {
      type: 'score',
      score: answer.score,
      confidence: answer.confidence,
      legend: Object.fromEntries(
        levels.map((text, index) => [String(index), text]),
      ),
      probabilities: Object.fromEntries(
        levels.map((_, index) => [
          String(index),
          answer.probabilities[String(index)] ?? 0,
        ]),
      ),
    };
  }
  return { ...base, answers };
}

const FOCUS_CHOICES = (FOCUS_STEP as { choices: Record<string, string> })
  .choices;
const FOCUS_SCORES = (FOCUS_STEP as { scores: Record<string, number> }).scores;

describe('fraction sizes', () => {
  test('gives a stated Instance its fraction and the rest of its column to the others', async () => {
    const { decision } = await run(makeRequest(FOCUS_INTENT), () => ({
      ...FOCUS_STEP,
      nouls: { 'size_stated_in_group/weather-main': 0.9 },
      scores: { ...FOCUS_SCORES, 'fraction_in_group/weather-main': 3 },
    }));
    expect(decision.tree).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H:2,1',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(
      decision.pairwise.groupFractions?.['weather-main']?.stated,
    ).toBeCloseTo(0.9);
  });

  test('interpolates the fraction between neighbouring levels', async () => {
    const step = {
      ...FOCUS_STEP,
      choices: FOCUS_CHOICES,
      nouls: { 'size_stated_in_group/weather-main': 0.9 },
    };
    const { decision } = await run(makeRequest(FOCUS_INTENT), (payload) => ({
      reply: withScores(payload, step, {
        'fraction_in_group/weather-main': {
          score: 3.5,
          confidence: 0.5,
          probabilities: { 3: 0.5, 4: 0.5 },
        },
      }),
    }));
    expect(decision.tree?.[2]).toBe('H:5,2');
  });

  const smallerWeather = { ...FOCUS_SCORES, 'size/tasks-main': 3 };

  test('splits a column with no stated size by the whole-Chart shares', async () => {
    const { decision } = await run(makeRequest(FOCUS_INTENT), () => ({
      ...FOCUS_STEP,
      nouls: { 'size_stated_in_group/weather-main': 0.2 },
      scores: smallerWeather,
    }));
    expect(decision.tree?.[2]).toBe('H:1,3');
  });

  test('still gives a stated Instance its fraction', async () => {
    const { decision } = await run(makeRequest(FOCUS_INTENT), () => ({
      ...FOCUS_STEP,
      nouls: { 'size_stated_in_group/weather-main': 0.9 },
      scores: { ...smallerWeather, 'fraction_in_group/weather-main': 3 },
    }));
    expect(decision.tree?.[2]).toBe('H:2,1');
  });
});

describe('spatial gate', () => {
  const notStated: Step = {
    choices: {
      ...Object.fromEntries(PAIR_IDS.map((id) => [id, 'not_stated'])),
      direction: 'not_stated',
    },
    confidence: 0.9,
  };
  const confidentNo: GateAnswer = {
    answer: 'no',
    probability: 0.1,
    confidence: 0.9,
  };

  function spatialPlan(
    spatial: GateAnswer,
    decisions: Readonly<Record<string, 'keep' | 'hide'>> = {},
  ) {
    const request = makeRequest('Refresh the weather.', { tree: SIDE_BY_SIDE });
    const plan: GatedActionPlan = {
      ...actionPlan(request, [], decisions),
      minConfidence: 1,
      gates: {
        needsActions: gate('no'),
        generatedContent: gate('no'),
        spatial,
        dependsOnScreen: gate('no'),
      },
    };
    return { request, plan };
  }

  async function runWithSpatial(
    spatial: GateAnswer,
    decisions: Readonly<Record<string, 'keep' | 'hide'>> = {},
  ) {
    const { request, plan } = spatialPlan(spatial, decisions);
    return run(request, () => notStated, plan);
  }

  test('defers as spatial not stated when the spatial gate says yes and every pair and the direction answer not stated', async () => {
    const { result } = await runResult(
      () => notStated,
      spatialPlan(gate('yes')).plan,
    );
    expect(deferralOf(result)).toBe('jevLayout/spatial_not_stated');
  });

  test('defers as spatial not stated when every pair and the direction lean to not stated without certainty', async () => {
    const { plan } = spatialPlan(gate('yes'));
    const { result } = await runResult(
      (payload) => ({
        reply: replyWith(payload, {
          ...pairs(LEANING_PAIR),
          direction: { side_by_side: 0.3, stacked: 0.1, not_stated: 0.6 },
        }),
      }),
      plan,
    );
    expect(deferralOf(result)).toBe('jevLayout/spatial_not_stated');
  });

  test('keeps the current tree on a resize with no request text, even when the spatial gate says yes and every answer is not stated', async () => {
    const request = makeRequest(
      [
        {
          type: 'chart_resize',
          previous: { columns: 12, rows: 8 },
          current: { columns: 30, rows: 18 },
        },
      ],
      { tree: SIDE_BY_SIDE },
    );
    const { result } = await runResult(() => notStated, gatedPlan(request));
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree).toEqual(SIDE_BY_SIDE);
  });

  test('keeps the current tree when the spatial gate says no and every answer is not stated', async () => {
    const { decision } = await runWithSpatial(confidentNo);
    expect(decision.tree).toEqual(SIDE_BY_SIDE);
    expect(decision.pairwise.route).toBe('same_instances');
  });

  test('ships the tree when the spatial gate says yes and one pair states a relation', async () => {
    const { plan } = spatialPlan(gate('yes'));
    const { result } = await runResult(
      () => ({
        ...notStated,
        choices: {
          ...notStated.choices,
          'pair/calendar-main/weather-main': 'right_of',
        },
      }),
      plan,
    );
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree).toEqual([
      'V:1,1,1',
      'ID:weather-main',
      'ID:calendar-main',
      'ID:tasks-main',
    ]);
  });

  test('ships the current tree when the spatial gate says yes and a pair states a relation the current board already has', async () => {
    const { plan } = spatialPlan(gate('yes'));
    const { result } = await runResult(
      () => ({
        ...notStated,
        choices: {
          ...notStated.choices,
          'pair/calendar-main/weather-main': 'left_of',
        },
      }),
      plan,
    );
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree).toEqual(SIDE_BY_SIDE);
  });

  test('ships the current tree when the spatial gate says yes and the direction states the current top split', async () => {
    const { plan } = spatialPlan(gate('yes'));
    const { result } = await runResult(
      () => ({
        ...notStated,
        choices: { ...notStated.choices, direction: 'side_by_side' },
      }),
      plan,
    );
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree).toEqual(SIDE_BY_SIDE);
  });

  test('ships the planned actions with the current tree when the spatial gate says yes and every answer is not stated', async () => {
    const { request, plan } = spatialPlan(gate('yes'));
    const withAction: GatedActionPlan = {
      ...plan,
      ...actionPlan(request, ['weather-main/setLocation']),
    };
    const { result } = await runResult(() => notStated, withAction);
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree).toEqual(SIDE_BY_SIDE);
  });

  test('defers as spatial not stated when the current tree writes equal weights differently', async () => {
    const request = makeRequest('Arrange everything in a 2x2 grid.', {
      tree: ['V:2,2,2', ...SIDE_BY_SIDE.slice(1)] as TilingNode[],
    });
    const { result } = await runResult(() => notStated, gatedPlan(request));
    expect(deferralOf(result)).toBe('jevLayout/spatial_not_stated');
  });

  test('ships when the spatial gate says yes, every answer is not stated and a size is stated within a row or column', async () => {
    const { plan } = spatialPlan(gate('yes'));
    const { result } = await runResult(
      () => ({
        ...notStated,
        nouls: { 'size_stated_in_group/weather-main': 0.9 },
        scores: { 'fraction_in_group/weather-main': 4 },
      }),
      plan,
    );
    expect(deferralOf(result)).toBeUndefined();
  });

  test('ships the tree without a hidden Instance when the spatial gate says yes and every answer is not stated', async () => {
    const { plan } = spatialPlan(gate('yes'), { 'tasks-main': 'hide' });
    const { result } = await runResult(() => notStated, plan);
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree?.slice(1)).toEqual([
      'ID:calendar-main',
      'ID:weather-main',
    ]);
  });

  test('ships a resized tree when the spatial gate says yes, every answer is not stated and the size answers change the weights', async () => {
    const { plan } = spatialPlan(gate('yes'));
    const { result } = await runResult(
      () => ({
        ...notStated,
        scores: {
          'size/calendar-main': 2,
          'size/weather-main': 4,
          'size/tasks-main': 2,
        },
      }),
      plan,
    );
    expect(deferralOf(result)).toBeUndefined();
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.tree?.slice(1)).toEqual(SIDE_BY_SIDE.slice(1));
    expect(result.value.tree?.[0]).not.toBe(SIDE_BY_SIDE[0]);
  });

  test('asks the pairs on the same Instances even on a confident no, and not stated keeps the current tree', async () => {
    const { decision, calls } = await runWithSpatial(confidentNo);
    expect(calls).toHaveLength(1);
    expect(decision.source).toBe('jev');
    expect(decision.pairwise).toMatchObject({
      route: 'same_instances',
      called: true,
    });
    expect(decision.tree?.slice(1)).toEqual(SIDE_BY_SIDE.slice(1));
  });

  test('makes no call with one visible Instance', async () => {
    const { decision, calls } = await runWithSpatial(confidentNo, {
      'weather-main': 'hide',
      'tasks-main': 'hide',
    });
    expect(calls).toHaveLength(0);
    expect(decision.tree).toEqual(['ID:calendar-main']);
  });
});

describe('size fallback and nothing fits', () => {
  const inARow: Step = {
    choices: {
      'pair/calendar-main/weather-main': 'left_of',
      'pair/calendar-main/tasks-main': 'left_of',
      'pair/weather-main/tasks-main': 'left_of',
    },
    confidence: 1,
  };

  test('raises a part below its minimum and keeps the best structure', async () => {
    const { decision } = await run(
      makeRequest('Put the tasks in a tiny strip at the bottom.'),
      () => ({
        choices: {
          'pair/calendar-main/weather-main': 'left_of',
          'pair/calendar-main/tasks-main': 'above',
          'pair/weather-main/tasks-main': 'above',
          direction: 'stacked',
        },
        scores: {
          'size/calendar-main': 4,
          'size/weather-main': 4,
          'size/tasks-main': 0,
        },
        confidence: 1,
      }),
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

  test('defers as no feasible layout when no tree fits after the size fallback', async () => {
    const request = makeRequest('Put them in a row.', {
      tree: SIDE_BY_SIDE,
      columns: 8,
    });
    const plan = gatedPlan(request);
    const result = await layoutComposedPairsGateAndDefer(
      scriptedAsk(() => inARow).ask,
    )(plan, makeContext(plan.selection.input));
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error).toMatchObject({
      reason: 'jevLayout/no_feasible_layout',
    });
  });

  test('defers when a single visible Instance does not fit', async () => {
    const request = makeRequest('Show the calendar.', {
      tree: ['ID:calendar-main'],
      columns: 1,
      rows: 1,
    });
    const plan = gatedPlan(request);
    const result = await layoutComposedPairsGateAndDefer(
      scriptedAsk(() => inARow).ask,
    )(plan, makeContext(plan.selection.input));
    expect(isOk(result)).toBe(false);
  });
});

describe('the best tree before one that fits as sized', () => {
  test('prefers the best tree raised to its minimums over a far worse tree that fits', async () => {
    const decision = await replayDemoTurn('log2:10');
    expect(decision.pairwise.fallback).toEqual({
      kind: 'raised_to_minimum',
      candidate: 0,
    });
    expect(decision.pairwise.chosen).toBeUndefined();
    expect(decision.tree).toEqual(WEATHER_STRIP_UNDER_NESTED_LAYOUT);
  });

  test('keeps the map above the journal at its minimum height', async () => {
    const decision = await replayDemoTurn('log1:25');
    expect(decision.pairwise.fallback).toEqual({
      kind: 'raised_to_minimum',
      candidate: 0,
    });
    expect(decision.pairwise.chosen).toBeUndefined();
    expect(decision.tree).toEqual(['H:1,3', 'ID:map-jev-1', 'ID:journal-main']);
  });
});

describe('the current layout kept as a candidate', () => {
  test('keeps the calendar and tasks column when the tasks get half of it', async () => {
    const decision = await replayDemoTurn('log1:11');
    expect(decision.pairwise.candidates[0]?.kind).toBe('current_layout');
    expect(decision.pairwise.fallback).toEqual({
      kind: 'raised_to_minimum',
      candidate: 0,
    });
    expect(decision.pairwise.chosen).toBeUndefined();
    expect(decision.tree).toEqual([
      'H:3,1',
      'V',
      'H',
      'ID:calendar-main',
      'ID:tasks-main',
      'ID:map-jev-1',
      'ID:weather-main',
    ]);
  });

  test('keeps the journal and map column when the calendar is made wider', async () => {
    const decision = await replayDemoTurn('log1:13');
    expect(decision.pairwise.candidates[0]?.kind).toBe('current_layout');
    expect(decision.pairwise.chosen).toBe(0);
    expect(decision.pairwise.fallback).toBeUndefined();
    expect(decision.tree).toEqual([
      'H:5,2',
      'V:6,2,1',
      'ID:calendar-main',
      'ID:tasks-main',
      'H',
      'ID:journal-main',
      'ID:map-jev-1',
      'ID:weather-main',
    ]);
  });

  test('ranks the weather strip under the nested layout first', async () => {
    const decision = await replayDemoTurn('log2:10');
    expect(decision.pairwise.candidates[0]).toMatchObject({
      kind: 'one_widget_moved',
      tree: [
        'H:5,1',
        'V:2,1',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-jev-1',
        'ID:weather-jev-1',
      ],
    });
    expect(decision.tree).toEqual(WEATHER_STRIP_UNDER_NESTED_LAYOUT);
  });
});

describe('the board restacked only when the whole board is meant', () => {
  test('keeps the top row when the calendar moves into a full-height column', async () => {
    const decision = await replayDemoTurn('log1:15');
    expect(decision.pairwise.chosen).toBe(1);
    expect(decision.tree).toEqual([
      'V:1,3',
      'ID:calendar-main',
      'H:3,1',
      'V:2,1,2',
      'ID:tasks-main',
      'ID:journal-main',
      'ID:map-jev-1',
      'ID:weather-main',
    ]);
  });

  test('keeps the board side by side when the calendar and tasks go into a narrow column', async () => {
    const decision = await replayDemoTurn('log1:16');
    expect(decision.pairwise.candidates[0]?.tree[0]).toStartWith('V');
    expect(decision.pairwise.chosen).toBe(0);
    expect(decision.tree).toEqual([
      'V:1,1,1,4',
      'ID:calendar-main',
      'ID:tasks-main',
      'ID:journal-main',
      'H',
      'ID:map-jev-1',
      'ID:weather-main',
    ]);
  });
});

async function replayDemoTurn(key: string): Promise<ComposedPairsDecision> {
  const turn = await demoTurn(key);
  const plan = demoTurnPlan(turn);
  const result = await layoutComposedPairsGateAndDefer(
    recordedAsk(turn.answers),
  )(plan, makeContext(plan.selection.input));
  if (!isOk(result)) throw new Error(`${key} did not plan`);
  return result.value;
}
