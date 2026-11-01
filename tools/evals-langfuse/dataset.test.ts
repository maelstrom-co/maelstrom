import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { judgeFromGrader } from '../../packages/evals/src/core/judge-result.ts';
import { prepareEvaluationPublication } from '../../packages/evals/src/core/publication.ts';
import { defaultDatasetName, mapLangfuseV3DatasetItem } from './dataset.ts';
import { importFullPlannerRun } from './full-planner-run.ts';
import { mapLangfuseV3Publication } from './mapping.ts';

const config = {
  destinationId: 'test',
  maxBatchBytes: 65_536,
  datasetName: defaultDatasetName,
};
const grade = {
  graderVersion: 2,
  verbalizerVersion: 1,
  dimensions: {
    request_satisfied: { score: 0.8 },
    arrangement_match: { score: 0.25 },
  },
  calls: [
    {
      prompt: 'SECRET PROMPT',
      response: 'SECRET RESPONSE',
      rationale: 'SECRET RATIONALE',
    },
  ],
};
function prepare(
  extra: Record<string, unknown> = {},
  preparedAt = '2026-10-27T15:00:00.000Z',
) {
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const { result, metadata } = importFullPlannerRun(
    bytes([
      {
        scenarioId: 'weather-hourly',
        arm: 'baseline',
        repeat: 1,
        suite: 'development',
        kind: 'baseline',
        expectedDeferral: false,
        score: { pass: true, failures: ['SECRET FAILURE'] },
        grader: grade,
        prompt: 'SECRET PROMPT',
        response: 'SECRET RESPONSE',
        expectedOutput: 'SECRET EXPECTED',
        ...extra,
      },
    ]),
    bytes({
      meta: { arms: 'baseline', repeats: 1, scenarios: 1 },
      summaries: [],
    }),
    10,
  ).samples[0];
  return prepareEvaluationPublication(result, {
    destinationId: config.destinationId,
    artifactId: 'summary',
    preparedAt,
    metadata,
    policy: { maxBytes: 16_384, review: () => true },
  });
}

test('catalog projection contains exact identifiers, allowlisted scalar metadata and a case-named trace link', () => {
  const publication = prepare();
  const item = mapLangfuseV3DatasetItem(publication, config);
  const trace = mapLangfuseV3Publication(publication, config).batch[0];
  expect(trace.body).toMatchObject({
    name: 'maelstrom.eval.weather-hourly',
    id: item.sourceTraceId,
  });
  const previousId = (kind: string) =>
    createHash('sha256')
      .update(JSON.stringify([publication.publicationId, kind]))
      .digest('hex');
  expect(item.sourceTraceId).toBe(previousId('trace').slice(0, 32));
  expect(trace.id).not.toBe(previousId('trace-create'));
  expect(Object.keys(item).sort()).toEqual([
    'datasetName',
    'id',
    'input',
    'metadata',
    'sourceTraceId',
  ]);
  expect(item.input).toEqual({
    caseId: 'weather-hourly',
    arm: 'baseline',
    repeat: 1,
  });
  expect(item.metadata).toEqual({
    publicationKey: publication.publicationKey,
    publicationId: publication.publicationId,
    runId: JSON.parse(publication.json).identity.runId,
    execution: 'completed',
    evaluation: 'pass',
    completeness: 'complete',
    correctness: 1,
    judgeStatus: 'scored',
    judgeRubric: 'planner_response_text_1',
    judgeRubricVersion: 2,
    judgeKind: 'unknown',
    judgeProvider: 'historical',
    judgeCalibration: 'unvalidated',
    'judge.request_satisfied.value': 0.8,
    'judge.request_satisfied.min': 0,
    'judge.request_satisfied.max': 1,
    'judge.arrangement_match.value': 0.25,
    'judge.arrangement_match.min': 0,
    'judge.arrangement_match.max': 1,
  });
  expect(item).not.toHaveProperty('expectedOutput');
  expect(JSON.stringify(item)).not.toContain('SECRET');
});

test('dataset IDs are stable across retries and namespaced across datasets and provider publications', () => {
  const publication = prepare();
  const item = mapLangfuseV3DatasetItem(publication, config);
  expect(
    mapLangfuseV3DatasetItem(JSON.parse(JSON.stringify(publication)), config),
  ).toEqual(item);
  expect(
    mapLangfuseV3DatasetItem(prepare({}, '2026-10-28T15:00:00.000Z'), config)
      .id,
  ).toBe(item.id);
  expect(
    mapLangfuseV3DatasetItem(publication, { ...config, datasetName: 'other' })
      .id,
  ).not.toBe(item.id);
  const ids = ['typesafe', 'openai'].map((provider) => {
    const judge = judgeFromGrader(grade, {
      kind: 'llm',
      provider,
      model: 'test-model',
    });
    const next = mapLangfuseV3DatasetItem(prepare({ judge }), config);
    expect(next.metadata.judgeProvider).toBe(provider);
    expect(next.metadata.judgeModel).toBe('test-model');
    expect(next.input).toEqual(item.input);
    return next.id;
  });
  expect(new Set([item.id, ...ids]).size).toBe(3);
});

test('unscored and failed judge rows retain statuses without inventing zero scores or copying errors', () => {
  const item = mapLangfuseV3DatasetItem(
    prepare({
      error: { tag: 'SECRET TAG', message: 'SECRET ERROR' },
      grader: {
        graderVersion: 2,
        verbalizerVersion: 1,
        failure: 'SECRET JUDGE ERROR',
      },
    }),
    config,
  );
  expect(item.metadata).toMatchObject({
    execution: 'error',
    evaluation: 'unscored',
    judgeStatus: 'failed',
  });
  expect(item.metadata).not.toHaveProperty('correctness');
  expect(
    Object.keys(item.metadata).some((key) => key.startsWith('judge.')),
  ).toBe(false);
  expect(JSON.stringify(item)).not.toContain('SECRET');
});

test('dataset projection rejects unbounded names, altered publication bytes and oversized requests', () => {
  const publication = prepare();
  for (const datasetName of ['', '../other', 'x'.repeat(129), 'name\n'])
    expect(() =>
      mapLangfuseV3DatasetItem(publication, { ...config, datasetName }),
    ).toThrow();
  expect(() =>
    mapLangfuseV3DatasetItem(
      { ...publication, json: `${publication.json} ` },
      config,
    ),
  ).toThrow();
  expect(() =>
    mapLangfuseV3DatasetItem(publication, { ...config, maxBatchBytes: 1 }),
  ).toThrow();
});
