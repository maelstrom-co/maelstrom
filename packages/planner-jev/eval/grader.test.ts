import { expect, test } from 'bun:test';

import type { Logger } from '@maelstrom-co/engine';
import {
  ActionName,
  InstanceId,
  type TilingNode,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import {
  type Payload,
  type Script,
  scriptedAsk,
  TEST_MODEL,
} from '../src/lib/__test-helpers__/scripted-fetch.js';
import {
  ARRANGEMENT_MATCH_LEVELS,
  type GradeInput,
  gradeResponse,
  REQUEST_SATISFIED_LEVELS,
} from './grader.js';
import { selectScenarios } from './scenarios.js';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = { logger: silent };

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

test('asks both dimensions once and normalises a confident score to [0, 1]', async () => {
  const { ask, calls } = scriptedAsk(() => ({
    choices: {},
    scores: { request_satisfied: 3, arrangement_match: 4 },
  }));

  const grade = await gradeResponse(ask, swapped, ctx);

  expect(grade.failure).toBe(undefined);
  expect(grade.dimensions?.request_satisfied).toEqual({
    score: 0.75,
    samples: [3],
  });
  expect(grade.dimensions?.arrangement_match).toEqual({
    score: 1,
    samples: [4],
  });
  expect(calls).toHaveLength(1);
  const [payload] = calls;
  expect(Object.keys(payload?.questions ?? {}).sort()).toEqual([
    'arrangement_match',
    'request_satisfied',
  ]);
  expect(
    Object.values(payload?.questions.request_satisfied.criteria ?? {}),
  ).toEqual([...REQUEST_SATISFIED_LEVELS]);
  expect(
    Object.values(payload?.questions.arrangement_match.criteria ?? {}),
  ).toEqual([...ARRANGEMENT_MATCH_LEVELS]);
  expect(REQUEST_SATISFIED_LEVELS[0]).toContain('Nothing the user asked for');
  expect(REQUEST_SATISFIED_LEVELS[4]).toContain('nothing else changed');
  expect(ARRANGEMENT_MATCH_LEVELS[0]).toContain('contradicts');
  expect(ARRANGEMENT_MATCH_LEVELS[4]).toContain('exactly the stated');
});

test('states the intent, both layouts in words, the plan and the message', async () => {
  const { ask, calls } = scriptedAsk(() => ({ choices: {} }));
  await gradeResponse(
    ask,
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
  const state = calls[0]?.state as Record<string, unknown>;
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

test('describes the after layout with the variants the response declares', async () => {
  const { ask, calls } = scriptedAsk(() => ({ choices: {} }));
  await gradeResponse(
    ask,
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
  const state = calls[0]?.state as Record<string, string>;
  expect(state.after).toContain('map-main: map (satellite)');
  expect(state.before).toContain('map-main: map (overview)');
});

test('samples three times only the dimension whose top two levels are within 0.15, and takes the mean', async () => {
  const replies: Record<string, number>[] = [
    { request_satisfied: 2.4, arrangement_match: 4 },
    { request_satisfied: 2 },
    { request_satisfied: 3 },
  ];
  const { ask, calls } = scriptedAsk((payload, call) => ({
    reply: scoreReply(payload, replies[call] ?? {}, {
      // Levels 2 and 3 at 0.45 and 0.40: near a boundary.
      request_satisfied: { '1': 0.05, '2': 0.45, '3': 0.4, '4': 0.1 },
    }),
  }));

  const grade = await gradeResponse(ask, swapped, ctx);

  expect(calls.map((payload) => Object.keys(payload.questions).sort())).toEqual(
    [
      ['arrangement_match', 'request_satisfied'],
      ['request_satisfied'],
      ['request_satisfied'],
    ],
  );
  expect(grade.dimensions?.request_satisfied.samples).toEqual([2.4, 2, 3]);
  expect(grade.dimensions?.request_satisfied.score).toBeCloseTo(
    (2.4 + 2 + 3) / 3 / 4,
    10,
  );
  expect(grade.dimensions?.arrangement_match).toEqual({
    score: 1,
    samples: [4],
  });
});

test('does not resample when the top two levels are more than 0.15 apart', async () => {
  const { ask, calls } = scriptedAsk((payload) => ({
    reply: scoreReply(
      payload,
      { request_satisfied: 2.3, arrangement_match: 1 },
      { request_satisfied: { '2': 0.6, '3': 0.4 } },
    ),
  }));
  const grade = await gradeResponse(ask, swapped, ctx);
  expect(calls).toHaveLength(1);
  expect(grade.dimensions?.request_satisfied.score).toBeCloseTo(2.3 / 4, 10);
  expect(grade.dimensions?.arrangement_match.score).toBe(0.25);
});

test('records a provider failure as a failed grade instead of throwing', async () => {
  const { ask } = scriptedAsk(() => ({ status: 500 }));
  const grade = await gradeResponse(ask, swapped, ctx);
  expect(grade.dimensions).toBe(undefined);
  expect(grade.failure).toBe('grader/provider_http');
});

test('a failed resample fails the grade rather than averaging fewer samples', async () => {
  const script: Script = (payload, call) =>
    call === 0
      ? {
          reply: scoreReply(
            payload,
            { request_satisfied: 2, arrangement_match: 4 },
            { request_satisfied: { '2': 0.5, '3': 0.5 } },
          ),
        }
      : { status: 503 };
  const { ask, calls } = scriptedAsk(script);
  const grade = await gradeResponse(ask, swapped, ctx);
  expect(calls).toHaveLength(2);
  expect(grade.failure).toBe('grader/provider_http');
  expect(grade.dimensions).toBe(undefined);
});

/**
 * A valid reply giving each score question the fractional `scores` value
 * and, where listed, the given level probabilities (all probability on the
 * rounded score otherwise).
 */
function scoreReply(
  payload: Payload,
  scores: Readonly<Record<string, number>>,
  probabilities: Readonly<Record<string, Readonly<Record<string, number>>>>,
) {
  return {
    model: TEST_MODEL,
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => {
        const levels = Object.values(question.criteria);
        const score = scores[id] ?? 0;
        const listed = probabilities[id];
        return [
          id,
          {
            type: 'score',
            score,
            confidence: 0.9,
            legend: Object.fromEntries(
              levels.map((text, index) => [String(index), text]),
            ),
            probabilities: Object.fromEntries(
              levels.map((_, index) => [
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
    usage: { input_tokens: 40, output_tokens: 3 },
  };
}
