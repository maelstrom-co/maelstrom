import { expect, test } from 'bun:test';
import { gradeResponse } from '../../core/grader.js';
import { judgeEvidence } from '../../core/judge.js';
import {
  evaluationJudgeSchema,
  judgeFromGrader,
  normalizeJudgeResult,
  renderJudgeSummary,
  summarizeJudges,
} from '../../core/judge-result.js';
import { evaluateSample } from '../../core/runtime/evaluate.js';
import { selectScenarios } from '../../core/scenarios.js';
import { configureJudge } from './config.js';
import { createHeuristicJudge, createOpenAIJudge } from './providers.js';

const context = { logger: { debug() {}, info() {}, warn() {}, error() {} } };
const identity = { runId: 'run', caseId: 'case', runtimeId: 'fake', sample: 1 };
const env = {
  OPENAI_API_KEY: 'fake-openai',
  TYPESAFE_API_KEY: 'fake-typesafe',
  JEV_MODEL: 'fake-model',
};

function transport(reply: unknown, status = 200) {
  const requests: unknown[] = [];
  const send = async (_url: unknown, options?: RequestInit) => {
    requests.push(JSON.parse(String(options?.body)));
    return Response.json(reply, { status });
  };
  return {
    requests,
    fetch: Object.assign(send, { preconnect() {} }) as typeof fetch,
  };
}

test('judge activation is opt-in, supports legacy env defaults, and explicit options override env', () => {
  expect(configureJudge({}, env)).toEqual({});
  expect(
    configureJudge(
      { enabled: false },
      {
        MAELSTROM_ENABLE_LLM_JUDGE: 'true',
        MAELSTROM_LLM_JUDGE_PROVIDER: 'bad',
      },
    ),
  ).toEqual({});
  const legacy = configureJudge({}, { MAELSTROM_ENABLE_LLM_JUDGE: '1' });
  expect(legacy.judge?.provenance).toEqual({
    kind: 'heuristic',
    provider: 'heuristic',
  });
  expect(legacy.judgeRubric).toBe('legacy');
  const openai = configureJudge(
    {},
    {
      ...env,
      MAELSTROM_ENABLE_LLM_JUDGE: 'true',
      MAELSTROM_LLM_JUDGE_PROVIDER: 'openai',
    },
  );
  expect(openai.judge?.provenance?.model).toBe('gpt-5.4-mini');
  expect(openai.judgeRubric).toBe('legacy');
  const current = configureJudge(
    {
      enabled: true,
      provider: 'typesafe',
      model: 'explicit',
      rubric: 'surface',
    },
    {
      ...env,
      MAELSTROM_ENABLE_LLM_JUDGE: 'false',
      MAELSTROM_LLM_JUDGE_PROVIDER: 'openai',
      MAELSTROM_LLM_JUDGE_MODEL: 'environment',
      MAELSTROM_LLM_JUDGE_RUBRIC: 'legacy',
    },
  );
  expect(current.judge?.provenance).toEqual({
    kind: 'llm',
    provider: 'typesafe',
    model: 'explicit',
  });
  expect(current.judgeRubric).toBe('surface');
  expect(
    configureJudge({ provider: 'openai', rubric: 'surface' }, env).judgeRubric,
  ).toBe('surface');
});

test('enabled invalid configuration fails synchronously without making calls or falling back', () => {
  for (const explicit of [
    { enabled: true, provider: 'unknown' },
    { enabled: true, provider: 'openai', model: '' },
    { enabled: true, provider: 'typesafe' },
    { enabled: true, provider: 'heuristic', rubric: 'surface' },
    { enabled: true, provider: 'openai', rubric: 'unknown' },
  ])
    expect(() => configureJudge(explicit, {})).toThrow();
  expect(() =>
    configureJudge({}, { MAELSTROM_ENABLE_LLM_JUDGE: 'maybe' }),
  ).toThrow();
});

test('OpenAI executes native dimensions once without invented probabilities, and separately supports the legacy scalar rubric', async () => {
  const native = transport({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answers: { request_satisfied: 4, arrangement_match: 2 },
          }),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });
  const judge = createOpenAIJudge({
    apiKey: 'fake',
    model: 'fake-model',
    fetch: native.fetch,
  });
  const [scenario] = selectScenarios('all', ['preserve']);
  if (scenario.request.layout.type !== 'tiling')
    throw new Error('Expected tiling');
  const grade = await gradeResponse(
    judge,
    {
      request: scenario.request,
      response: {
        userMessage: 'same',
        executionPlan: [],
        tree: scenario.request.layout.tree,
        instances: scenario.request.instances,
      },
    },
    context,
  );
  expect(grade.dimensions?.request_satisfied.score).toBe(1);
  expect(grade.dimensions?.arrangement_match.score).toBe(0.5);
  expect(native.requests).toHaveLength(1);
  expect(grade.calls[0].usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  const scalar = transport({
    choices: [{ message: { content: '{"answers":{"llm_judge_score":0.7}}' } }],
  });
  const result = await judgeEvidence(
    createOpenAIJudge({
      apiKey: 'fake',
      model: 'fake-model',
      fetch: scalar.fetch,
    }),
    'legacy_task',
    { observation: ['actual trajectory'] },
    context,
  );
  expect(result).toMatchObject({
    status: 'scored',
    rubric: { id: 'legacy_task', version: 2 },
    scores: [{ name: 'llm_judge_score', value: 0.7 }],
    provenance: { kind: 'llm', provider: 'openai' },
  });
});

test('OpenAI failure/malformed scores produce no numeric verdict or raw provider text', async () => {
  for (const response of [
    { error: 'PRIVATE KEY' },
    { choices: [{ message: { content: 'not json PRIVATE' } }] },
    {
      choices: [{ message: { content: '{"answers":{"llm_judge_score":9}}' } }],
    },
    { choices: [{ message: { content: '{"answers":{}}' } }] },
  ]) {
    const fake = transport(response);
    const result = await judgeEvidence(
      createOpenAIJudge({
        apiKey: 'PRIVATE KEY',
        model: 'fake',
        fetch: fake.fetch,
      }),
      'legacy_task',
      { observation: 'actual' },
      context,
    );
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect('scores' in result).toBe(false);
    expect(fake.requests).toHaveLength(1);
  }
});

test('legacy heuristic is labeled non-LLM, preserves exact/nonempty/empty scoring, and requires actual text', async () => {
  for (const [state, expected] of [
    [{ assistantText: '  exact  text ', expectedText: 'exact text' }, 1],
    [{ assistantText: 'wrong', expectedText: 'exact text' }, 0],
    [{ assistantText: 'present' }, 0.5],
    [{ assistantText: '' }, 0],
  ] as const) {
    const result = await judgeEvidence(
      createHeuristicJudge(),
      'legacy_task',
      state,
      context,
    );
    expect(result).toMatchObject({
      status: 'scored',
      provenance: { kind: 'heuristic' },
      scores: [{ name: 'llm_judge_score', value: expected }],
    });
  }
  expect(
    await judgeEvidence(
      createHeuristicJudge(),
      'legacy_task',
      { output: { actions: [] } },
      context,
    ),
  ).toMatchObject({ status: 'not_run', reason: 'no_valid_evidence' });
});

test('shared lifecycle judges a deterministic failure after cleanup once, preserving verdict and isolating mutation', async () => {
  const events: string[] = [];
  const result = await evaluateSample(identity, {
    surface: 'synthetic',
    provenance: 'test',
    async execute() {
      events.push('execute');
      return {
        completeness: 'complete',
        disposition: 'planned',
        value: { actual: 1 },
      };
    },
    score() {
      events.push('score');
      return { outcome: 'fail', failures: ['primary'] };
    },
    dispose() {
      events.push('dispose');
    },
    async judge(sample) {
      events.push('judge');
      sample.observation!.actual = 9;
      return judgeEvidence(
        createHeuristicJudge(),
        'legacy_task',
        { assistantText: 'good' },
        context,
      );
    },
  });
  expect(events).toEqual(['execute', 'score', 'dispose', 'judge']);
  expect(result.evaluation).toBe('fail');
  expect(result.observation).toEqual({ actual: 1 });
  expect(result.judge?.status).toBe('scored');
  const failure = await evaluateSample(identity, {
    surface: 'synthetic',
    provenance: 'test',
    async execute() {
      return { completeness: 'complete', disposition: 'planned', value: 1 };
    },
    score() {
      return { outcome: 'pass', failures: [] };
    },
    async judge() {
      throw new Error('PRIVATE');
    },
  });
  expect(failure.evaluation).toBe('pass');
  expect(failure.judge).toEqual({
    schemaVersion: 1,
    status: 'failed',
    reason: 'exception',
  });
});

test('historical absence, malformed scores and incompatible rubrics stay distinct', async () => {
  expect(normalizeJudgeResult(undefined)).toMatchObject({
    status: 'not_run',
    reason: 'historical_unknown',
  });
  const scored = await judgeEvidence(
    createHeuristicJudge(),
    'legacy_task',
    { assistantText: 'x' },
    context,
  );
  if (scored.status !== 'scored') throw new Error('Expected score');
  for (const scores of [
    [...scored.scores, ...scored.scores],
    [{ name: 'score', value: Infinity, min: 0, max: 1 }],
    [{ name: 'score', value: 2, min: 0, max: 1 }],
  ])
    expect(evaluationJudgeSchema.safeParse({ ...scored, scores }).success).toBe(
      false,
    );
  const native = judgeFromGrader({
    graderVersion: 2,
    verbalizerVersion: 1,
    dimensions: {
      request_satisfied: { score: 1 },
      arrangement_match: { score: 0.5 },
    },
  });
  const summary = summarizeJudges([scored, native, undefined]);
  expect(summary).toMatchObject({ scored: 2, failed: 0, notRun: 1 });
  expect(summary.means).toHaveLength(3);
  expect(renderJudgeSummary(summary)).toContain('unvalidated');
  expect(renderJudgeSummary(summary)).toContain('heuristic');
});

test('non-tiling grader evidence is unsupported, while provider and exception failures stay failed', () => {
  const provenance = {
    kind: 'llm' as const,
    provider: 'custom',
    model: 'fake',
  };
  const rubric = { id: 'planner_response_text_1', version: 2 };
  const failures = [
    ['grader/not_tiling', 'not_run', 'unsupported_surface'],
    ['grader/provider_http', 'failed', 'provider_failure'],
    ['grader/exception: PRIVATE', 'failed', 'provider_failure'],
  ] as const;
  const results = failures.map(([failure, status, reason]) => {
    const result = judgeFromGrader(
      { graderVersion: 2, verbalizerVersion: 1, failure, calls: [] },
      provenance,
    );
    expect(result.status).toBe(status);
    expect(result).toHaveProperty('reason', reason);
    expect(result).toMatchObject({ schemaVersion: 1, rubric, provenance });
    expect('scores' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    return result;
  });
  expect(summarizeJudges(results)).toMatchObject({
    scored: 0,
    failed: 2,
    notRun: 1,
    reasons: { unsupported_surface: 1, provider_failure: 2 },
    means: [],
  });
  expect(
    judgeFromGrader({
      graderVersion: 2,
      verbalizerVersion: 1,
      failure: 'grader/not_tiling',
    }),
  ).toEqual({
    schemaVersion: 1,
    status: 'not_run',
    reason: 'unsupported_surface',
    rubric,
    provenance: { kind: 'unknown', provider: 'historical' },
  });
});

test('judge envelope rejects accessors, hidden content, unknown status and invalid scales without executing getters', async () => {
  const value = await judgeEvidence(
    createHeuristicJudge(),
    'legacy_task',
    { assistantText: 'ok' },
    context,
  );
  if (value.status !== 'scored') throw new Error('Expected score');
  let accessed = false;
  const scores = [...value.scores];
  Object.defineProperty(scores, '0', {
    enumerable: true,
    get() {
      accessed = true;
      return value.scores[0];
    },
  });
  for (const invalid of [
    null,
    { ...value, status: 'unknown' },
    { ...value, prompt: 'PRIVATE' },
    { ...value, scores },
    { ...value, scores: [{ name: 'bad', value: 1, min: 1, max: 1 }] },
  ])
    expect(evaluationJudgeSchema.safeParse(invalid).success).toBe(false);
  expect(accessed).toBe(false);
  expect(
    configureJudge(
      { provider: 'openai' },
      { ...env, MAELSTROM_ENABLE_LLM_JUDGE: 'invalid' },
    ).judge?.provenance?.provider,
  ).toBe('openai');
});
