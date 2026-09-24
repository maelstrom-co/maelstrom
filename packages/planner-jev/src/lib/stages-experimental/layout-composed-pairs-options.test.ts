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
  const options: ComposedPairsOptions = {
    layoutId: 'fractions',
    sizeAnswers: { kind: 'fractions_within_part' },
  };

  test('asks per Instance whether a size is stated within its group and what fraction', async () => {
    const { calls } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => FOCUS_STEP,
    );
    const questions = calls[0]?.questions ?? {};
    expect(questions['size_stated_in_group/weather-main']?.type).toBe('noul');
    expect(questions['fraction_in_group/weather-main']?.type).toBe('score');
    expect(questions['size/weather-main']?.type).toBe('score');
  });

  test('gives a stated Instance its fraction and the rest of its column to the others', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => ({
        ...FOCUS_STEP,
        nouls: { 'size_stated_in_group/weather-main': 0.9 },
        scores: { ...FOCUS_SCORES, 'fraction_in_group/weather-main': 3 },
      }),
    );
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
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      (payload) => ({
        reply: withScores(payload, step, {
          'fraction_in_group/weather-main': {
            score: 3.5,
            confidence: 0.5,
            probabilities: { 3: 0.5, 4: 0.5 },
          },
        }),
      }),
    );
    expect(decision.tree?.[2]).toBe('H:5,2');
  });

  test('splits a column evenly when no size is stated within it', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => ({
        ...FOCUS_STEP,
        nouls: { 'size_stated_in_group/weather-main': 0.2 },
        scores: { ...FOCUS_SCORES, 'fraction_in_group/weather-main': 4 },
      }),
    );
    expect(decision.tree?.[2]).toBe('H');
  });
});

describe('fraction sizes with whole-Chart shares for the unstated members', () => {
  const options: ComposedPairsOptions = {
    layoutId: 'fractions-proportional',
    sizeAnswers: {
      kind: 'fractions_within_part',
      unstatedSplit: 'whole_chart_shares',
    },
  };
  const smallerWeather = { ...FOCUS_SCORES, 'size/tasks-main': 3 };

  test('splits a column with no stated size by the whole-Chart shares', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => ({
        ...FOCUS_STEP,
        nouls: { 'size_stated_in_group/weather-main': 0.2 },
        scores: smallerWeather,
      }),
    );
    expect(decision.layoutId).toBe('fractions-proportional');
    expect(decision.tree?.[2]).toBe('H:1,3');
  });

  test('the even split ignores the whole-Chart shares inside the column', async () => {
    const { decision } = await runWith(
      { layoutId: 'fractions', sizeAnswers: { kind: 'fractions_within_part' } },
      makeRequest(FOCUS_INTENT),
      () => ({
        ...FOCUS_STEP,
        nouls: { 'size_stated_in_group/weather-main': 0.2 },
        scores: smallerWeather,
      }),
    );
    expect(decision.tree?.[2]).toBe('H');
  });

  test('still gives a stated Instance its fraction', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => ({
        ...FOCUS_STEP,
        nouls: { 'size_stated_in_group/weather-main': 0.9 },
        scores: { ...smallerWeather, 'fraction_in_group/weather-main': 3 },
      }),
    );
    expect(decision.tree?.[2]).toBe('H:2,1');
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
      reply: replyWith(payload, {
        ...Object.fromEntries(PAIR_IDS.map((id) => [id, unstated])),
        direction,
      }),
    });
  const sideBySide = { side_by_side: 0.8, stacked: 0.1, not_stated: 0.1 };

  test('keeps the column when the direction is the current top split', async () => {
    const { decision } = await runWith(
      {
        layoutId: 'limited',
        direction: 'redirects_not_stated_when_direction_changes',
      },
      request,
      reply(sideBySide),
    );
    expect(decision.layoutId).toBe('limited');
    expect(decision.tree).toEqual([
      'V:2,1',
      'H',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('the full redirect splits the column side by side', async () => {
    const { decision } = await runWith(
      { layoutId: 'full', direction: 'redirects_not_stated' },
      request,
      reply(sideBySide),
    );
    expect(decision.tree?.[0]).toStartWith('V');
    expect(decision.tree).not.toContain('H');
  });

  test('stacks every pair when the direction crosses the current top split', async () => {
    const { decision } = await runWith(
      {
        layoutId: 'limited',
        direction: 'redirects_not_stated_when_direction_changes',
      },
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

describe('score when confident', () => {
  const options: ComposedPairsOptions = {
    layoutId: 'confident',
    sizeAnswers: { kind: 'score_when_confident', minimumConfidence: 0.8 },
  };
  const step = { ...FOCUS_STEP, choices: FOCUS_CHOICES };
  const calendarAt = (confidence: number) => (payload: Payload) => ({
    reply: withScores(payload, step, {
      'size/calendar-main': {
        score: 3,
        confidence,
        probabilities: { 2: 0.45, 3: 0.1, 4: 0.45 },
      },
    }),
  });

  test('sizes a confident answer by its interpolated score', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      calendarAt(0.9),
    );
    expect(decision.tree?.[0]).toBe('V:3,2');
    expect(decision.pairwise.sizes?.['calendar-main']?.size).toBe(0.75);
  });

  test('sizes an answer below the threshold by its picked level', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      calendarAt(0.6),
    );
    expect(decision.tree?.[0]).toBe('V');
    expect(decision.pairwise.sizes?.['calendar-main']?.size).toBe(0.5);
  });
});

describe('size comparisons', () => {
  const options: ComposedPairsOptions = {
    layoutId: 'comparisons',
    sizeAnswers: { kind: 'pair_comparisons' },
  };
  const comparisonStep: Step = {
    choices: FOCUS_CHOICES,
    scores: {
      'size_comparison/calendar-main/weather-main': 4,
      'size_comparison/calendar-main/tasks-main': 4,
      'size_comparison/weather-main/tasks-main': 2,
    },
    confidence: 0.9,
  };

  test('asks one comparison per pair instead of a size per Instance', async () => {
    const { calls } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => comparisonStep,
    );
    const ids = Object.keys(calls[0]?.questions ?? {});
    expect(ids.filter((id) => id.startsWith('size_comparison/'))).toEqual([
      'size_comparison/calendar-main/weather-main',
      'size_comparison/calendar-main/tasks-main',
      'size_comparison/weather-main/tasks-main',
    ]);
    expect(ids.some((id) => id.startsWith('size/'))).toBe(false);
  });

  test('weights parts by the summed areas solved from the comparisons', async () => {
    const { decision } = await runWith(
      options,
      makeRequest(FOCUS_INTENT),
      () => comparisonStep,
    );
    expect(decision.tree).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(decision.pairwise.areaShares?.['calendar-main']).toBeCloseTo(2 / 3);
    expect(decision.pairwise.sizeComparisons).toHaveLength(3);
    expect(decision.pairwise.sizes).toBeUndefined();
  });
});

describe('spatial gate', () => {
  const notStated: Step = {
    choices: Object.fromEntries(PAIR_IDS.map((id) => [id, 'not_stated'])),
    confidence: 0.9,
  };

  async function runWithSpatial(
    options: ComposedPairsOptions,
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
      },
    };
    const scripted = scriptedAsk(() => notStated);
    const result = await layoutComposedPairsWithOptions(scripted.ask, options)(
      plan,
      makeContext(plan.selection.input),
    );
    if (!isOk(result)) throw new Error('expected a layout decision');
    return { decision: result.value as ComposedPairsDecision, ...scripted };
  }

  const unsure: GateAnswer = {
    answer: 'no',
    probability: 0.3,
    confidence: 0.6,
  };
  const confidentNo: GateAnswer = {
    answer: 'no',
    probability: 0.1,
    confidence: 0.9,
  };

  test('never skipping asks the pairs on the same Instances and not stated keeps the current tree', async () => {
    const { decision, calls } = await runWithSpatial(
      { layoutId: 'asks', spatialGate: 'never_skips' },
      confidentNo,
    );
    expect(calls).toHaveLength(1);
    expect(decision.source).toBe('jev');
    expect(decision.pairwise).toMatchObject({
      route: 'same_instances',
      called: true,
    });
    expect(decision.tree?.slice(1)).toEqual(SIDE_BY_SIDE.slice(1));
  });

  test('never skipping still makes no call with one visible Instance', async () => {
    const { decision, calls } = await runWithSpatial(
      { layoutId: 'asks', spatialGate: 'never_skips' },
      confidentNo,
      { 'weather-main': 'hide', 'tasks-main': 'hide' },
    );
    expect(calls).toHaveLength(0);
    expect(decision.tree).toEqual(['ID:calendar-main']);
  });

  test('a confident no keeps the current tree without a call', async () => {
    const { decision, calls } = await runWithSpatial(
      { layoutId: 'weak', spatialGate: { kind: 'confident_no', below: 0.2 } },
      confidentNo,
    );
    expect(calls).toHaveLength(0);
    expect(decision.source).toBe('preserve');
  });

  test('an unsure no asks the pairs', async () => {
    const { decision, calls } = await runWithSpatial(
      { layoutId: 'weak', spatialGate: { kind: 'confident_no', below: 0.2 } },
      unsure,
    );
    expect(calls).toHaveLength(1);
    expect(decision.source).toBe('jev');
    expect(decision.pairwise.called).toBe(true);
  });

  test('by default any no keeps the current tree without a call', async () => {
    const { decision, calls } = await runWithSpatial(
      { layoutId: 'default' },
      unsure,
    );
    expect(calls).toHaveLength(0);
    expect(decision.source).toBe('preserve');
  });
});

describe('nothing fits', () => {
  const inARow: Step = {
    choices: {
      'pair/calendar-main/weather-main': 'left_of',
      'pair/calendar-main/tasks-main': 'left_of',
      'pair/weather-main/tasks-main': 'left_of',
    },
    confidence: 1,
  };

  async function runNarrow(options: ComposedPairsOptions) {
    const request = makeRequest('Put them in a row.', {
      tree: SIDE_BY_SIDE,
      columns: 8,
    });
    const plan = gatedPlan(request);
    const scripted = scriptedAsk(() => inARow);
    const result = await layoutComposedPairsWithOptions(scripted.ask, options)(
      plan,
      makeContext(plan.selection.input),
    );
    return { result, ...scripted };
  }

  test('defers as no feasible layout when no tree fits after the size fallback', async () => {
    const { result } = await runNarrow({
      layoutId: 'defers',
      sizeFallback: true,
      nothingFits: 'defers',
    });
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
    const result = await layoutComposedPairsWithOptions(
      scriptedAsk(() => inARow).ask,
      { layoutId: 'defers', nothingFits: 'defers' },
    )(plan, makeContext(plan.selection.input));
    expect(isOk(result)).toBe(false);
  });

  test('still hands off when no tree fits by default', async () => {
    const { result } = await runNarrow({
      layoutId: 'hands-off',
      sizeFallback: true,
    });
    if (!isOk(result)) throw new Error('expected a layout decision');
    expect(result.value.source).toBe('llm');
  });
});
