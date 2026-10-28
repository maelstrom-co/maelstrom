import { randomUUID } from 'node:crypto';
import { type JudgeSummary, summarizeJudges } from './judge-result.js';
import {
  type EvaluationAdapter,
  type EvaluationResult,
  evaluateSample,
  type SampleIdentity,
} from './runtime/evaluate.js';

/** Stable catalog-order selection; unknown IDs do not manufacture cases. */
export function selectEvaluationCases<T>(
  catalog: readonly T[],
  selection: {
    readonly id: (value: T) => string;
    readonly ids?: readonly string[];
    readonly include?: (value: T) => boolean;
  },
): readonly T[] {
  const ids = new Set(selection.ids ?? []);
  return catalog.filter(
    (value) =>
      (ids.size === 0 || ids.has(selection.id(value))) &&
      (selection.include?.(value) ?? true),
  );
}

/** Source-policy completion, including native error propagation and record projection. */
export interface RunInvocation<Value, Record> {
  /** Adapter for this invocation; no run scheduling belongs inside it. */
  readonly adapter: EvaluationAdapter<Value>;
  /** Called after sample cleanup; may retain native exception/report semantics. */
  finish(result: EvaluationResult<Value>): Record | Promise<Record>;
}

/** Common accounting, not an unlabeled correctness score across source policies. */
export interface EvaluationRunAccounting {
  /** Selected catalog entries, including inapplicable cases. */
  readonly selectedCases: number;
  /** Expanded case/repeat/runtime invocations after preparation policy. */
  readonly plannedSamples: number;
  /** Samples whose shared lifecycle finished, independent of task correctness. */
  readonly completedSamples: number;
  /** Runtime execution outcomes, never substituted for task correctness. */
  readonly execution: Readonly<
    Record<EvaluationResult<unknown>['execution'], number>
  >;
  /** Counts under the explicitly identified source scoring policy. */
  readonly evaluation: Readonly<
    Record<EvaluationResult<unknown>['evaluation'], number>
  >;
  /** Samples reporting cleanup failures separately from correctness. */
  readonly cleanupFailures: number;
  /** Secondary judge coverage and rubric-separated means. */
  readonly judge: JudgeSummary;
}

/** A completed run; native report formats remain projections owned by the source policy. */
export interface EvaluationRun<Value, Record> {
  /** Shared run identity, including every sample in this expansion. */
  readonly runId: string;
  /** Source scoring/report policy; do not combine policies without labeling them. */
  readonly policy: string;
  /** Native records in expansion order, irrespective of completion order. */
  readonly records: readonly Record[];
  /** Shared finalized sample evidence in the same expansion order. */
  readonly samples: readonly EvaluationResult<Value>[];
  /** Run-wide accounting computed by the common orchestrator. */
  readonly accounting: EvaluationRunAccounting;
}

/** Runtime-specific policies around one shared selection/expansion/scheduling/report lifecycle. */
export interface EvaluationRunOptions<Case, Prepared, Runtime, Value, Record> {
  readonly runId?: string;
  readonly policy: string;
  readonly cases: readonly Case[];
  readonly runtimes: readonly Runtime[];
  readonly repeats: number;
  readonly concurrency?: number;
  readonly caseId: (value: Case) => string;
  readonly runtimeId: (value: Case, runtime: Runtime) => string;
  /** Validate the whole selection before preparation or runtime work. */
  readonly preflight?: () => void | Promise<void>;
  /** Invoked once per case, before any sample starts. */
  readonly prepare: (value: Case) => Prepared | Promise<Prepared>;
  /** Native applicability policy may reduce a case to one recorded sample. */
  readonly sampleCount?: (prepared: Prepared, repeats: number) => number;
  readonly invocation: (
    value: Case,
    prepared: Prepared,
    runtime: Runtime,
    identity: SampleIdentity,
  ) => RunInvocation<Value, Record>;
  /** Receives a detached snapshot after secondary judging, before native completion/error policy runs. */
  readonly onEvaluation?: (result: EvaluationResult<Value>) => void;
  /** Native progress callback in completion order. */
  readonly onRecord?: (record: Record) => void;
  /** Dispatched once after all samples finish; never on a partially failed run. */
  readonly report?: (run: EvaluationRun<Value, Record>) => void | Promise<void>;
}

/** Expands, schedules, accounts and reports a run, preserving source-specific sample policies. */
export async function runEvaluationRun<Case, Prepared, Runtime, Value, Record>(
  options: EvaluationRunOptions<Case, Prepared, Runtime, Value, Record>,
): Promise<EvaluationRun<Value, Record>> {
  const repeats = positiveInteger(options.repeats);
  const concurrency = positiveInteger(options.concurrency ?? 1);
  const runId = options.runId ?? randomUUID();
  if (!runId.trim() || !options.policy.trim())
    throw new Error('Run identity and policy are required');
  const cases = [...options.cases];
  const runtimes = [...options.runtimes];
  if (!Number.isSafeInteger(cases.length * runtimes.length * repeats))
    throw new Error('Run expansion exceeds safe counts');
  await options.preflight?.();
  const plan: {
    value: Case;
    prepared: Prepared;
    runtime: Runtime;
    identity: SampleIdentity;
  }[] = [];
  const identities = new Set<string>();
  for (const value of cases) {
    const prepared = await options.prepare(value);
    const count = positiveInteger(
      options.sampleCount?.(prepared, repeats) ?? repeats,
    );
    if (count > repeats)
      throw new Error('Source policy cannot enlarge requested repeats');
    for (let sample = 1; sample <= count; sample++)
      for (const runtime of runtimes) {
        const identity = {
          runId,
          caseId: options.caseId(value),
          runtimeId: options.runtimeId(value, runtime),
          sample,
        };
        if (!identity.caseId.trim() || !identity.runtimeId.trim())
          throw new Error('Case/runtime identities are required');
        const key = JSON.stringify([
          identity.caseId,
          identity.runtimeId,
          sample,
        ]);
        if (identities.has(key))
          throw new Error('Duplicate run sample identity');
        identities.add(key);
        plan.push({ value, prepared, runtime, identity });
      }
  }
  const records: Record[] = new Array(plan.length);
  const samples: EvaluationResult<Value>[] = new Array(plan.length);
  const execution = { completed: 0, error: 0, invalid: 0 };
  const evaluation = { pass: 0, fail: 0, unscored: 0, not_applicable: 0 };
  let cleanupFailures = 0;
  let completedSamples = 0;
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < plan.length) {
      const index = next++;
      const { value, prepared, runtime, identity } = plan[index];
      try {
        const invocation = options.invocation(
          value,
          prepared,
          runtime,
          identity,
        );
        const result = await evaluateSample(identity, invocation.adapter);
        samples[index] = result;
        completedSamples++;
        execution[result.execution]++;
        evaluation[result.evaluation]++;
        if (result.cleanupError !== undefined) cleanupFailures++;
        options.onEvaluation?.(structuredClone(result));
        records[index] = await invocation.finish(result);
        options.onRecord?.(records[index]);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  // Stop admission on failure, but retire already-running invocations before rejecting.
  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.length) }, worker),
  );
  if (failure) throw failure.error;
  const run: EvaluationRun<Value, Record> = {
    runId,
    policy: options.policy,
    records,
    samples,
    accounting: {
      selectedCases: cases.length,
      plannedSamples: plan.length,
      completedSamples,
      execution,
      evaluation,
      cleanupFailures,
      judge: summarizeJudges(samples.map((sample) => sample.judge)),
    },
  };
  await options.report?.(run);
  return run;
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Run repeats/concurrency must be positive safe integers');
  return value;
}
