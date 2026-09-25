import { expect, test } from 'bun:test';

import type { Logger } from '@maelstrom-co/engine';
import {
  type Payload,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import type { JudgeInput } from '../../core/plugin.js';
import { createTypeSafeJudge } from './typesafe-judge.js';
import { typesafeSettings } from './typesafe-settings.js';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = { logger: silent };

const input: JudgeInput = {
  state: { intent: 'Swap them.', before: 'a', after: 'b' },
  dimensions: [
    {
      name: 'request_satisfied',
      question: 'How fully?',
      levels: ['none', 'all'],
    },
    { name: 'arrangement_match', question: 'How well?', levels: ['no', 'yes'] },
  ],
};

function judgeWith(script: Parameters<typeof scriptedFetch>[0]) {
  const transport = scriptedFetch(script);
  return {
    judge: createTypeSafeJudge(
      typesafeSettings({
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch: transport.fetch,
      }),
    ),
    payloads: transport.calls,
  };
}

function scoreReply(
  payload: Payload,
  scores: Readonly<Record<string, number>>,
) {
  return {
    model: TEST_MODEL,
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => {
        const levels = Object.values(question.criteria);
        const score = scores[id] ?? 0;
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
                index === Math.round(score) ? 1 : 0,
              ]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 40, output_tokens: 3 },
  };
}

test('asks one score question per dimension with its levels as the criteria, on the grader caller', async () => {
  const { judge, payloads } = judgeWith((payload) => ({
    reply: scoreReply(payload, { request_satisfied: 1, arrangement_match: 0 }),
  }));
  const verdict = await judge.score(input, ctx);
  expect(payloads).toHaveLength(1);
  const [payload] = payloads;
  expect(payload?.state).toEqual(input.state);
  expect(Object.keys(payload?.questions ?? {}).sort()).toEqual([
    'arrangement_match',
    'request_satisfied',
  ]);
  expect(
    Object.values(payload?.questions.request_satisfied.criteria ?? {}),
  ).toEqual(['none', 'all']);
  expect('answers' in verdict && verdict.answers).toEqual({
    request_satisfied: { score: 1, probabilities: { '0': 0, '1': 1 } },
    arrangement_match: { score: 0, probabilities: { '0': 1, '1': 0 } },
  });
  expect(verdict.calls).toMatchObject([
    { outcome: 'ok', usage: { inputTokens: 40, outputTokens: 3 } },
  ]);
  expect(judge.requiredEnv).toEqual(['TYPESAFE_API_KEY', 'JEV_MODEL']);
});

test('reports a provider failure as the deferral reason, with the failed call', async () => {
  const { judge } = judgeWith(() => ({ status: 500 }));
  const verdict = await judge.score(input, ctx);
  expect('failure' in verdict && verdict.failure).toBe('grader/provider_http');
  expect(verdict.calls).toMatchObject([{ outcome: 'provider_http' }]);
});

test('reports a reply that answers only some dimensions as an invalid reply', async () => {
  const { judge } = judgeWith((payload) => {
    const reply = scoreReply(payload, { request_satisfied: 1 });
    const { arrangement_match: _dropped, ...answers } = reply.answers;
    return { reply: { ...reply, answers } };
  });
  const verdict = await judge.score(input, ctx);
  expect('failure' in verdict && verdict.failure).toBe(
    'grader/provider_invalid_reply',
  );
});
