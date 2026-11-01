import { expect, test } from 'bun:test';
import {
  judgeFromGrader,
  judgeNotRun,
} from '../../packages/evals/src/core/judge-result.ts';
import {
  createEvaluationPublisher,
  prepareEvaluationPublication,
} from '../../packages/evals/src/core/publication.ts';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { importFullPlannerRun } from './full-planner-run.ts';
import { mapLangfuseV3Publication } from './mapping.ts';

const identity = { runId: 'run', caseId: 'case', runtimeId: 'fake', sample: 1 };
const grade = {
  graderVersion: 2,
  verbalizerVersion: 1,
  dimensions: {
    request_satisfied: { score: 0.8, samples: [3.2] },
    arrangement_match: { score: 0.25, samples: [1] },
  },
  calls: [{ private: 'SECRET' }],
};
const config = { destinationId: 'test', maxBatchBytes: 65_536 };
const options = {
  destinationId: 'test',
  artifactId: 'summary',
  preparedAt: '2026-10-27T15:00:00.000Z',
  policy: { maxBytes: 32_768, review: () => true },
};

function imported(extra: Record<string, unknown>) {
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  return importFullPlannerRun(
    bytes([
      {
        scenarioId: 'case',
        arm: 'baseline',
        suite: 'development',
        kind: 'baseline',
        repeat: 1,
        expectedDeferral: false,
        score: { pass: false },
        ...extra,
      },
    ]),
    bytes({
      meta: { arms: 'baseline', repeats: 1, scenarios: 1 },
      summaries: [],
    }),
    10,
  ).samples[0].result;
}

test('historical native grades convert to separate bounded Langfuse scores, while missing/failure grades never become zero', () => {
  for (const extra of [
    { grader: grade },
    {},
    {
      grader: {
        graderVersion: 2,
        verbalizerVersion: 1,
        failure: 'SECRET provider error',
      },
    },
  ]) {
    const sample = imported(extra);
    const publication = prepareEvaluationPublication(sample, options);
    expect(publication.json).not.toContain('SECRET');
    const batch = mapLangfuseV3Publication(publication, config);
    const scores = batch.batch.filter((event) => event.type === 'score-create');
    expect(
      scores.find((event) => event.body.name === 'eval.correctness')?.body
        .value,
    ).toBe(0);
    const secondary = scores.filter((event) =>
      event.body.name.startsWith('eval.judge.'),
    );
    expect(secondary.map((event) => event.body.value)).toEqual(
      extra.grader === grade ? [0.8, 0.25] : [],
    );
    if (secondary.length)
      expect(secondary[0].body.name).toBe(
        'eval.judge.planner_response_text_1.v2.unknown.request_satisfied',
      );
    const payload = JSON.parse(publication.json);
    expect(payload.judge.status).toBe(
      extra.grader === grade ? 'scored' : extra.grader ? 'failed' : 'not_run',
    );
    if (!extra.grader) expect(payload.judge.reason).toBe('historical_unknown');
  }
});

test('all sinks receive the same finalized judge evidence; retry and persisted re-export never execute or judge again', async () => {
  let executed = 0;
  let judged = 0;
  const result = await evaluateSample(identity, {
    surface: 'session',
    provenance: 'synthetic',
    async execute() {
      executed++;
      return {
        completeness: 'complete',
        disposition: 'planned',
        value: 'SECRET observation',
      };
    },
    score() {
      return { outcome: 'fail', failures: [] };
    },
    async judge() {
      judged++;
      return judgeFromGrader(grade, {
        kind: 'llm',
        provider: 'openai',
        model: 'fake',
      });
    },
  });
  const publication = prepareEvaluationPublication(result, options);
  const batch = mapLangfuseV3Publication(publication, config);
  let attempts = 0;
  const publisher = createEvaluationPublisher({
    destinationId: 'test',
    maxEntries: 2,
    timeoutMs: 100,
    sink: {
      async publish(saved) {
        expect(mapLangfuseV3Publication(saved, config)).toEqual(batch);
        return { status: ++attempts === 1 ? 'partial' : 'accepted' };
      },
    },
  });
  expect((await publisher.publish(publication)).status).toBe('partial');
  expect((await publisher.publish(publication)).status).toBe('accepted');
  await publisher.publish(publication);
  expect(
    mapLangfuseV3Publication(JSON.parse(JSON.stringify(publication)), config),
  ).toEqual(batch);
  const recording = prepareEvaluationPublication(result, {
    ...options,
    artifactId: 'recording',
    recording: { records: [] },
  });
  expect(JSON.parse(recording.json).judge).toEqual(
    JSON.parse(publication.json).judge,
  );
  expect(recording.json).not.toContain('SECRET');
  expect([executed, judged, attempts]).toEqual([1, 1, 2]);
});

test('current scalar/heuristic statuses survive import without being mistaken for correctness or native dimensions', () => {
  const judge = {
    schemaVersion: 1,
    status: 'scored',
    rubric: { id: 'legacy_task', version: 2 },
    provenance: { kind: 'heuristic', provider: 'heuristic' },
    calibration: 'unvalidated',
    scores: [{ name: 'llm_judge_score', value: 0.5, min: 0, max: 1 }],
  };
  const sample = imported({ judge });
  const batch = mapLangfuseV3Publication(
    prepareEvaluationPublication(sample, options),
    config,
  );
  expect(
    batch.batch
      .filter((event) => event.type === 'score-create')
      .map((event) => event.body.name),
  ).toEqual([
    'eval.correctness',
    'eval.judge.legacy_task.v2.heuristic.llm_judge_score',
  ]);
  const disabled = prepareEvaluationPublication(
    { ...sample, judge: judgeNotRun('disabled') },
    options,
  );
  expect(
    mapLangfuseV3Publication(disabled, config).batch.filter(
      (event) => event.type === 'score-create',
    ),
  ).toHaveLength(1);
  for (const invalid of [
    { ...judge, prompt: 'SECRET' },
    { ...judge, scores: [{ name: 'bad', value: 2, min: 0, max: 1 }] },
    { ...judge, scores: [...judge.scores, ...judge.scores] },
  ])
    expect(() => imported({ judge: invalid })).toThrow();
});
