import { resolve } from 'node:path';
import type { ReportRecord } from './run.ts';

const percentile = (values: number[], fraction: number): number | null => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
};

export function analyze(records: ReportRecord[]) {
  const completed = records.filter((r) => r.result.status !== 'error');
  const model = completed.filter((r) => (r.requests ?? 0) > 0);
  const accepted = model.filter((r) => r.result.status === 'planned');
  const supported = model.filter((r) => r.expected.status === 'planned');
  const rejected = model.filter((r) => r.expected.status === 'deferred');
  const times = (rows: ReportRecord[]) =>
    rows.flatMap((r) => (r.elapsedMs === null ? [] : [r.elapsedMs]));
  return {
    totalTrials: records.length,
    completedTrials: completed.length,
    modelBackedTrials: model.length,
    deterministicTrials: completed.length - model.length,
    correctModelBackedTrials: model.filter((r) => !r.failures.length).length,
    acceptedPlans: accepted.length,
    incorrectAcceptedPlans: accepted.filter((r) => r.failures.length).length,
    expectedPlans: supported.length,
    correctAcceptedPlans: accepted.filter((r) => !r.failures.length).length,
    unnecessaryDeferrals: supported.filter(
      (r) => r.result.status === 'deferred',
    ).length,
    expectedDeferrals: rejected.length,
    correctDeferrals: rejected.filter((r) => r.result.status === 'deferred')
      .length,
    apiCalls: model.reduce((n, r) => n + (r.requests ?? 0), 0),
    errors: records.length - completed.length,
    modelBackedP50Ms: percentile(times(model), 0.5),
    modelBackedP95Ms: percentile(times(model), 0.95),
    acceptedPlanP50Ms: percentile(times(accepted), 0.5),
    acceptedPlanP95Ms: percentile(times(accepted), 0.95),
    returnedModels: [
      ...new Set(model.flatMap((r) => r.traces.map((t) => t.model))),
    ],
    byStage: Object.fromEntries(
      ['select', 'actions', 'arguments'].map((stage) => {
        const traces = model.flatMap((r) =>
          r.traces.filter((t) => t.stage === stage),
        );
        const latency = traces.flatMap((t) =>
          t.elapsedMs === null ? [] : [t.elapsedMs],
        );
        return [
          stage,
          {
            calls: traces.length,
            p50Ms: percentile(latency, 0.5),
            p95Ms: percentile(latency, 0.95),
            inputTokens: traces.reduce(
              (n, t) => n + (t.usage?.input_tokens ?? 0),
              0,
            ),
            outputTokens: traces.reduce(
              (n, t) => n + (t.usage?.output_tokens ?? 0),
              0,
            ),
          },
        ];
      }),
    ),
    byCase: Object.fromEntries(
      [...new Set(records.map((r) => r.id))].map((id) => {
        const rows = records.filter((r) => r.id === id);
        return [
          id,
          {
            trials: rows.length,
            passed: rows.filter((r) => !r.failures.length).length,
            failures: rows.flatMap((r) => r.failures),
          },
        ];
      }),
    ),
    postHocConfidenceSweep: [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(
      (threshold) => {
        const remaining = accepted.filter(
          (r) =>
            r.result.status === 'planned' &&
            (r.result.usedConfidence ?? 1) >= threshold,
        );
        return {
          threshold,
          accepted: remaining.length,
          incorrect: remaining.filter((r) => r.failures.length).length,
          correct: remaining.filter((r) => !r.failures.length).length,
          expectedPlans: supported.length,
        };
      },
    ),
    confidenceSweepCaveat:
      'Retrospective routing over captured outcomes, not a fresh run or calibrated policy. Falling back would add LLM latency and cost, neither measured here.',
  };
}

if (import.meta.main) {
  const directories = process.argv.slice(2);
  if (!directories.length)
    throw new Error('Pass one or more recorded run directories.');
  const runs = [];
  for (const directory of directories) {
    const source = resolve(directory);
    const summary = await Bun.file(`${source}/summary.json`).json();
    const records: ReportRecord[] = await Bun.file(
      `${source}/results.json`,
    ).json();
    runs.push({
      directory,
      metadata: {
        createdAt: summary.createdAt,
        model: summary.model,
        suite: summary.suite ?? 'development',
        plannerRevision: summary.plannerRevision ?? null,
        tokens: summary.tokens,
      },
      analysis: analyze(records),
    });
  }
  console.log(JSON.stringify(runs, null, 2));
}
