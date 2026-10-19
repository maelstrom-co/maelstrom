import type { EvaluationAdapter } from '../core/runtime/evaluate.js';
import type { Scenario } from '../core/scenarios.js';
import type {
  RegisteredStageEval,
  StageTurnRecord,
} from '../core/stage-eval.js';

/** Wraps one isolated stage; hand-off and applicability are not behavioral passes. */
export function stageAdapter(options: {
  readonly module: RegisteredStageEval;
  readonly scenario: Scenario;
  readonly variant: string;
  readonly provenance: string;
}): EvaluationAdapter<StageTurnRecord> {
  return {
    surface: 'isolated-stage',
    provenance: options.provenance,
    preflight() {
      if (!options.module.variants.includes(options.variant))
        throw new Error(`Unknown stage variant: ${options.variant}`);
    },
    async execute(context) {
      const [record] = await options.module.run({
        scenarios: [options.scenario],
        variants: [options.variant],
        repeats: 1,
        concurrency: 1,
        captureJudgeFailure: true,
      });
      if (!record) throw new Error('Stage produced no record');
      context.record({ kind: 'stage', value: record });
      const executionFailed =
        record.outcome === 'error' && !record.judgeFailure;
      return {
        completeness: executionFailed ? 'partial' : 'complete',
        disposition: record.judgeFailure
          ? 'planned'
          : record.outcome === 'not_applicable' ||
              record.outcome === 'handed_off'
            ? record.outcome
            : record.outcome === 'deferred' ||
                (record.expectedDeferral &&
                  record.reason === record.expectedDeferral)
              ? 'deferred'
              : 'planned',
        value: record,
        ...(executionFailed && {
          error: record.reason ?? 'Stage error',
        }),
      };
    },
    score(record) {
      if (record.judgeFailure) throw new Error(record.judgeFailure.message);
      return {
        outcome: record.outcome === 'pass' ? 'pass' : 'fail',
        failures: record.failures.length
          ? record.failures
          : record.outcome === 'pass'
            ? []
            : [record.reason ?? record.outcome],
      };
    },
  };
}
