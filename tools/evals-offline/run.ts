import type { LoadedCase } from '../../packages/evals/src/adapters/offline-case.js';
import { validateJudgeSelection } from '../../packages/evals/src/core/judge.js';
import {
  type EvaluationRun,
  runEvaluationRun,
  selectEvaluationCases,
} from '../../packages/evals/src/core/run-orchestration.js';
import type { EvalOptions } from '../../packages/evals/src/core/run.js';
import type { EvaluationResult } from '../../packages/evals/src/core/runtime/evaluate.js';
import { validateStageJudgeSelection } from '../../packages/evals/src/core/stage-eval.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';

/** Runs selected synthetic case contracts, including sessions, through shared run orchestration. */
export function runOfflineCases(options: {
  /** Explicit catalog override for tests; otherwise uses the validated checked-in registry. */
  readonly cases?: readonly LoadedCase[];
  /** Explicit optional provider; the runner never reads environment or enables providers itself. */
  readonly judge?: EvalOptions['judge'];
  /** Independent surface/legacy rubric choice. */
  readonly judgeRubric?: EvalOptions['judgeRubric'];
  /** Catalog-order subset; no IDs means every catalog case. */
  readonly ids?: readonly string[];
  /** Optional profile subset, intersected with selected IDs. */
  readonly profiles?: readonly string[];
  readonly runId?: string;
  readonly repeats: number;
  readonly concurrency?: number;
  readonly onEvaluation?: (result: EvaluationResult<unknown>) => void;
  /** Local reporting hook; publishing never triggers additional judge calls. */
  readonly report?: (
    run: EvaluationRun<unknown, EvaluationResult<unknown>>,
  ) => void | Promise<void>;
}): Promise<EvaluationRun<unknown, EvaluationResult<unknown>>> {
  const catalog = options.cases ?? loadOfflineCases();
  const profiles = new Set(options.profiles ?? []);
  const knownProfiles = new Set<string>(
    catalog.map((value) => value.definition.profile),
  );
  const unknownProfiles = [...profiles].filter(
    (profile) => !knownProfiles.has(profile),
  );
  if (unknownProfiles.length)
    throw new Error(
      `Unknown evaluation profiles: ${unknownProfiles.join(', ')}. Choose profiles from the evaluation catalog.`,
    );
  const cases = selectEvaluationCases(catalog, {
    id: (value) => value.definition.id,
    ids: options.ids,
    include: (value) =>
      profiles.size === 0 || profiles.has(value.definition.profile),
  });
  return runEvaluationRun({
    runId: options.runId,
    policy: 'offline:declared-case/v1',
    cases,
    runtimes: ['declared-profile'],
    repeats: options.repeats,
    concurrency: options.concurrency,
    caseId: (value) => value.definition.id,
    runtimeId: (value) => value.definition.profile,
    preflight() {
      if (cases.some((value) => value.definition.surface === 'isolated-stage'))
        validateStageJudgeSelection(options.judge, options.judgeRubric);
      else validateJudgeSelection(options.judge, options.judgeRubric);
    },
    prepare: (value) => value,
    invocation: (value) => ({
      adapter: caseAdapter(value, options),
      finish: (result) => result,
    }),
    onEvaluation: options.onEvaluation,
    report: options.report,
  });
}
