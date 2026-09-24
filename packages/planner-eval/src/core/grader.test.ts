import { expect, test } from 'bun:test';

import {
  ActionName,
  InstanceId,
  type TilingNode,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { scriptedJudge } from './__test-helpers__/fake-planner.js';
import { silentLogger } from './__test-helpers__/fixtures.js';
import {
  ARRANGEMENT_MATCH_LEVELS,
  GRADER_VERSION,
  type GradeInput,
  gradeResponse,
  REQUEST_SATISFIED_LEVELS,
} from './grader.js';
import type { JudgeInput, JudgeVerdict } from './plugin.js';
import { selectScenarios } from './scenarios.js';

const ctx = { logger: silentLogger };

const [swap] = selectScenarios('development', ['swap']);
if (!swap) throw new Error('fixture scenario swap is missing');

const swapped: GradeInput = {
  request: swap.request,
  response: {
    userMessage: 'The map is now on the left of the calendar.',
    executionPlan: [],
    tree: ['V', 'ID:map-main', 'ID:calendar-main'] as TilingNode[],
    instances: swap.request.instances,
  },
};

/**
 * A verdict giving each asked dimension the fractional `scores` value and,
 * where listed, the given level probabilities (all probability on the
 * rounded score otherwise).
 */
function verdict(
  input: JudgeInput,
  scores: Readonly<Record<string, number>>,
  probabilities: Readonly<
    Record<string, Readonly<Record<string, number>>>
  > = {},
): JudgeVerdict {
  return {
    answers: Object.fromEntries(
      input.dimensions.map((dimension) => {
        const score = scores[dimension.name] ?? 0;
        const listed = probabilities[dimension.name];
        return [
          dimension.name,
          {
            score,
            probabilities: Object.fromEntries(
              dimension.levels.map((_, index) => [
                String(index),
                listed
                  ? (listed[String(index)] ?? 0)
                  : index === Math.round(score)
                    ? 1
                    : 0,
              ]),
            ),
          },
        ];
      }),
    ),
    calls: [{ latencyMs: 40, usage: { inputTokens: 40, outputTokens: 3 } }],
  };
}

test('asks both dimensions once, with their levels, and normalises a confident score to [0, 1]', async () => {
  const judge = scriptedJudge((input) =>
    verdict(input, { request_satisfied: 3, arrangement_match: 4 }),
  );

  const grade = await gradeResponse(judge, swapped, ctx);

  expect(grade.failure).toBe(undefined);
  expect(grade.dimensions?.request_satisfied).toEqual({
    score: 0.75,
    samples: [3],
  });
  expect(grade.dimensions?.arrangement_match).toEqual({
    score: 1,
    samples: [4],
  });
  expect(grade.calls).toEqual([
    { latencyMs: 40, usage: { inputTokens: 40, outputTokens: 3 } },
  ]);
  expect(judge.inputs).toHaveLength(1);
  const [input] = judge.inputs;
  expect(input?.dimensions.map((dimension) => dimension.name)).toEqual([
    'request_satisfied',
    'arrangement_match',
  ]);
  expect(input?.dimensions[0]?.levels).toEqual([...REQUEST_SATISFIED_LEVELS]);
  expect(input?.dimensions[1]?.levels).toEqual([...ARRANGEMENT_MATCH_LEVELS]);
  expect(input?.dimensions[0]?.question).toContain('userMessage is a claim');
  expect(REQUEST_SATISFIED_LEVELS[0]).toContain('Nothing the user asked for');
  expect(REQUEST_SATISFIED_LEVELS[4]).toContain('nothing else changed');
  expect(ARRANGEMENT_MATCH_LEVELS[0]).toContain('contradicts');
  expect(ARRANGEMENT_MATCH_LEVELS[4]).toContain('exactly the stated');
});

test('states the intent, both layouts in words, the plan and the message', async () => {
  const judge = scriptedJudge((input) => verdict(input, {}));
  await gradeResponse(
    judge,
    {
      ...swapped,
      response: {
        ...swapped.response,
        executionPlan: [
          {
            instanceId: InstanceId('map-main'),
            action: ActionName('setLocation'),
            params: { location: 'Oslo' },
          },
        ],
      },
    },
    ctx,
  );
  const state = judge.inputs[0]?.state as Record<string, unknown>;
  expect(state.intent).toBe('Swap the calendar and the map.');
  expect(state.before).toContain('calendar left of map');
  expect(state.after).toContain('map left of calendar');
  expect(state.executionPlan).toEqual([
    {
      instanceId: 'map-main',
      action: 'setLocation',
      params: { location: 'Oslo' },
    },
  ]);
  expect(state.userMessage).toBe('The map is now on the left of the calendar.');
});

test('states that the shipped layout is unchanged when its tree is identical to the incoming one', async () => {
  if (swap.request.layout.type !== 'tiling')
    throw new Error('fixture scenario swap is not tiling');
  const judge = scriptedJudge((input) => verdict(input, {}));
  await gradeResponse(
    judge,
    {
      ...swapped,
      response: {
        ...swapped.response,
        userMessage: 'The calendar and map are already arranged as requested.',
        tree: [...swap.request.layout.tree],
      },
    },
    ctx,
  );
  const state = judge.inputs[0]?.state as Record<string, unknown>;
  expect(state.layoutUnchanged).toBe(true);
});

test('states that the shipped layout changed when its tree differs from the incoming one', async () => {
  const judge = scriptedJudge((input) => verdict(input, {}));
  await gradeResponse(judge, swapped, ctx);
  const state = judge.inputs[0]?.state as Record<string, unknown>;
  expect(state.layoutUnchanged).toBe(false);
});

test('scores an unchanged layout at the lowest arrangement level when a change was stated', () => {
  expect(ARRANGEMENT_MATCH_LEVELS[0]).toContain('unchanged');
  expect(ARRANGEMENT_MATCH_LEVELS[4]).toContain(
    'with none stated, the previous arrangement is preserved or a sensible default is used',
  );
});

test('records the grader version that produced a grade', async () => {
  const judge = scriptedJudge((input) =>
    verdict(input, { request_satisfied: 4, arrangement_match: 4 }),
  );
  const grade = await gradeResponse(judge, swapped, ctx);
  expect(GRADER_VERSION).toBe(2);
  expect(grade.graderVersion).toBe(2);
});

test('describes the after layout with the variants the response declares', async () => {
  const judge = scriptedJudge((input) => verdict(input, {}));
  await gradeResponse(
    judge,
    {
      ...swapped,
      response: {
        ...swapped.response,
        instances: [
          ...swapped.request.instances.filter(
            (instance) => instance.instanceId !== 'map-main',
          ),
          {
            instanceId: InstanceId('map-main'),
            vesselId: VesselId('map'),
            variant: VariantName('satellite'),
          },
        ],
      },
    },
    ctx,
  );
  const state = judge.inputs[0]?.state as Record<string, string>;
  expect(state.after).toContain('map-main: map (satellite)');
  expect(state.before).toContain('map-main: map (overview)');
});

test('samples three times only the dimension whose top two levels are within 0.15, and takes the mean', async () => {
  const replies: Record<string, number>[] = [
    { request_satisfied: 2.4, arrangement_match: 4 },
    { request_satisfied: 2 },
    { request_satisfied: 3 },
  ];
  const judge = scriptedJudge((input, call) =>
    verdict(input, replies[call] ?? {}, {
      // Levels 2 and 3 at 0.45 and 0.40: near a boundary.
      request_satisfied: { '1': 0.05, '2': 0.45, '3': 0.4, '4': 0.1 },
    }),
  );

  const grade = await gradeResponse(judge, swapped, ctx);

  expect(
    judge.inputs.map((input) =>
      input.dimensions.map((dimension) => dimension.name).sort(),
    ),
  ).toEqual([
    ['arrangement_match', 'request_satisfied'],
    ['request_satisfied'],
    ['request_satisfied'],
  ]);
  expect(grade.dimensions?.request_satisfied.samples).toEqual([2.4, 2, 3]);
  expect(grade.dimensions?.request_satisfied.score).toBeCloseTo(
    (2.4 + 2 + 3) / 3 / 4,
    10,
  );
  expect(grade.dimensions?.arrangement_match).toEqual({
    score: 1,
    samples: [4],
  });
  expect(grade.calls).toHaveLength(3);
});

test('does not resample when the top two levels are more than 0.15 apart', async () => {
  const judge = scriptedJudge((input) =>
    verdict(
      input,
      { request_satisfied: 2.3, arrangement_match: 1 },
      { request_satisfied: { '2': 0.6, '3': 0.4 } },
    ),
  );
  const grade = await gradeResponse(judge, swapped, ctx);
  expect(judge.inputs).toHaveLength(1);
  expect(grade.dimensions?.request_satisfied.score).toBeCloseTo(2.3 / 4, 10);
  expect(grade.dimensions?.arrangement_match.score).toBe(0.25);
});

test('records a judge failure as a failed grade instead of throwing', async () => {
  const judge = scriptedJudge(() => ({
    failure: 'grader/provider_http',
    calls: [{ latencyMs: 5, outcome: 'provider_http' }],
  }));
  const grade = await gradeResponse(judge, swapped, ctx);
  expect(grade.dimensions).toBe(undefined);
  expect(grade.failure).toBe('grader/provider_http');
  expect(grade.calls).toEqual([{ latencyMs: 5, outcome: 'provider_http' }]);
});

test('a dimension the judge leaves unanswered fails the grade', async () => {
  const judge = scriptedJudge((input) => {
    const full = verdict(input, { request_satisfied: 4, arrangement_match: 4 });
    if ('failure' in full) return full;
    const { arrangement_match: _dropped, ...answers } = full.answers;
    return { answers, calls: full.calls };
  });
  const grade = await gradeResponse(judge, swapped, ctx);
  expect(grade.failure).toBe('grader/answer_missing');
});

test('a failed resample fails the grade rather than averaging fewer samples', async () => {
  const judge = scriptedJudge((input, call) =>
    call === 0
      ? verdict(
          input,
          { request_satisfied: 2, arrangement_match: 4 },
          { request_satisfied: { '2': 0.5, '3': 0.5 } },
        )
      : { failure: 'grader/provider_http', calls: [{ latencyMs: 1 }] },
  );
  const grade = await gradeResponse(judge, swapped, ctx);
  expect(judge.inputs).toHaveLength(2);
  expect(grade.failure).toBe('grader/provider_http');
  expect(grade.dimensions).toBe(undefined);
  expect(grade.calls).toHaveLength(2);
});
