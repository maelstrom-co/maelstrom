import type { RegisteredArm } from '../core/arms.js';
import { verifyReplay, verifyReplayShape } from '../core/replay.js';
import {
  type EvalOptions,
  type RunRecord,
  runEval,
  unmappedPhases,
} from '../core/run.js';
import type { EvaluationAdapter } from '../core/runtime/evaluate.js';
import type { Scenario } from '../core/scenarios.js';

/** Wraps one existing Engine/planner turn without replacing plugin, usage or replay semantics. */
export function plannerAdapter(options: {
  readonly scenario: Scenario;
  readonly arm: RegisteredArm;
  readonly provenance: string;
  readonly runtime: Pick<
    EvalOptions,
    'adapter' | 'fallback' | 'logger' | 'replay'
  >;
}): EvaluationAdapter<RunRecord> {
  const scenarios = [options.scenario];
  const arms = [options.arm];
  return {
    surface: 'planner-response',
    provenance: options.provenance,
    preflight() {
      const errors = unmappedPhases(arms, scenarios);
      if (errors.length) throw new Error(errors.join('\n'));
      const replay = options.runtime.replay;
      if (replay) {
        verifyReplay(replay.source, scenarios, 1);
        verifyReplayShape(
          replay.source,
          scenarios,
          1,
          replay.through,
          arms.filter(({ arm }) => !arm.baseline),
        );
      }
    },
    async execute(context) {
      const [record] = await runEval({
        ...options.runtime,
        scenarios,
        arms,
        repeats: 1,
        onRecord(record) {
          for (const stage of record.stages ?? [])
            context.record({ kind: 'stage', value: stage });
          context.record({ kind: 'turn', value: record });
        },
      });
      if (!record) throw new Error('Planner produced no record');
      return {
        completeness: record.error ? 'partial' : 'complete',
        disposition: record.deferral ? 'deferred' : 'planned',
        value: record,
        ...(record.error && { error: record.error.message }),
      };
    },
    score(record) {
      if (record.expectedDeferral)
        return {
          outcome: record.deferredAsExpected ? 'pass' : 'fail',
          failures: record.deferredAsExpected
            ? []
            : ['Expected planner deferral was not observed'],
        };
      if (!record.score)
        throw new Error('Planner record lacks correctness evidence');
      return {
        outcome: record.score.pass ? 'pass' : 'fail',
        failures: record.score.failures,
      };
    },
  };
}
