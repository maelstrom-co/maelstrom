import {
  type EvaluationJudgeResult,
  evaluationJudgeSchema,
  judgeNotRun,
} from './judge-result.js';
import {
  type OperationalTelemetry,
  validateOperationalTelemetry,
} from './operational-telemetry.js';

/** Internal provisional identity; repeats are samples, not retries. */
export interface SampleIdentity {
  readonly runId: string;
  readonly caseId: string;
  readonly runtimeId: string;
  readonly sample: number;
}

/** Correctness is separate from runtime disposition and execution failure. */
export interface Verdict {
  readonly outcome: 'pass' | 'fail' | 'unscored';
  readonly failures: readonly string[];
}

/** Evidence required by this adapter's declared observation surface. */
export interface Observation<T> {
  readonly completeness: 'complete' | 'partial' | 'absent';
  readonly disposition:
    | 'planned'
    | 'deferred'
    | 'handed_off'
    | 'not_applicable';
  readonly value: T;
  readonly error?: string;
}

/** Eval-side linkage, deliberately outside operational telemetry dimensions. */
export interface EvidenceRecord {
  readonly sampleKey: string;
  readonly sequence: number;
  readonly kind: 'turn' | 'stage' | 'diagnostic';
  readonly value: unknown;
  readonly producer?: string;
  readonly requestId?: string;
}

/** Owned per invocation; never a global mutable current-case context. */
export interface EvaluationContext {
  readonly identity: SampleIdentity;
  readonly sampleKey: string;
  record(record: Omit<EvidenceRecord, 'sampleKey' | 'sequence'>): void;
}

/** Runtime-specific construction belongs behind this seam, not in the lifecycle. */
export interface EvaluationAdapter<T> {
  readonly surface: string;
  readonly provenance: string;
  /** Must reject incompatible inputs without executing the runtime. */
  preflight?(context: EvaluationContext): void | Promise<void>;
  execute(context: EvaluationContext): Promise<Observation<T>>;
  score(value: T): Verdict;
  /** Optional secondary grading after cleanup, before any result callback or report. */
  judge?(
    result: EvaluationResult<NoInfer<T>>,
    context: EvaluationContext,
  ): Promise<EvaluationJudgeResult>;
  /** Release resources created for this invocation, including on failure. */
  dispose?(): void | Promise<void>;
  /** Finalize owned telemetry after runtime cleanup, never infer it from diagnostic records. */
  finalizeOperational?(
    context: EvaluationContext,
  ): Promise<OperationalTelemetry>;
}

/** Serializable sample evidence; no provider token count is inferred from absence. */
export interface EvaluationResult<T> {
  readonly schemaVersion: 1;
  readonly identity: SampleIdentity;
  readonly sampleKey: string;
  readonly surface: string;
  readonly provenance: string;
  readonly execution: 'completed' | 'error' | 'invalid';
  readonly evaluation: 'pass' | 'fail' | 'unscored' | 'not_applicable';
  readonly completeness: Observation<T>['completeness'];
  readonly disposition?: Observation<T>['disposition'];
  readonly failures: readonly string[];
  readonly observation?: T;
  readonly records: readonly EvidenceRecord[];
  readonly error?: {
    readonly phase: 'preflight' | 'execution' | 'scoring';
    readonly message: string;
  };
  readonly cleanupError?: string;
  /** Optional finalized operational evidence; absence means collection unavailable. */
  readonly operational?: OperationalTelemetry;
  /** Finalized secondary verdict; absent only on historical input. */
  readonly judge?: EvaluationJudgeResult;
}

/** Executes one sample through the same preparation, evidence, scoring and cleanup lifecycle. */
export async function evaluateSample<T>(
  identity: SampleIdentity,
  adapter: EvaluationAdapter<T>,
): Promise<EvaluationResult<T>> {
  if (
    ![
      identity.runId,
      identity.caseId,
      identity.runtimeId,
      adapter.surface,
      adapter.provenance,
    ].every((value) => value.trim().length > 0) ||
    !Number.isSafeInteger(identity.sample) ||
    identity.sample < 1
  ) {
    throw new Error(
      'A sample requires nonempty identity/provenance and a positive integer sample',
    );
  }
  const ownedIdentity = Object.freeze({ ...identity });
  const sampleKey = JSON.stringify([
    identity.runId,
    identity.caseId,
    identity.runtimeId,
    identity.sample,
  ]);
  const records: EvidenceRecord[] = [];
  let active = true;
  const context: EvaluationContext = {
    identity: ownedIdentity,
    sampleKey,
    record(record) {
      if (!active) throw new Error('Sample evidence is already finalized');
      records.push({
        ...structuredClone(record),
        sampleKey,
        sequence: records.length,
      });
    },
  };
  const base = {
    schemaVersion: 1 as const,
    identity: ownedIdentity,
    sampleKey,
    surface: adapter.surface,
    provenance: adapter.provenance,
  };
  let phase: 'preflight' | 'execution' | 'scoring' = 'preflight';
  let observation: Observation<T> | undefined;
  let result: EvaluationResult<T>;
  try {
    await adapter.preflight?.(context);
    phase = 'execution';
    observation = structuredClone(await adapter.execute(context));
    if (observation.error !== undefined) throw new Error(observation.error);
    phase = 'scoring';
    const verdict =
      observation.completeness !== 'complete' ||
      observation.disposition === 'not_applicable' ||
      observation.disposition === 'handed_off'
        ? undefined
        : adapter.score(structuredClone(observation.value));
    result = {
      ...base,
      execution: 'completed',
      evaluation:
        observation.completeness !== 'complete'
          ? 'unscored'
          : observation.disposition === 'not_applicable'
            ? 'not_applicable'
            : (verdict?.outcome ?? 'unscored'),
      disposition: observation.disposition,
      completeness: observation.completeness,
      observation: observation.value,
      failures: verdict?.failures ?? [],
      records,
    };
  } catch (error) {
    result = {
      ...base,
      execution:
        phase === 'preflight'
          ? 'invalid'
          : phase === 'execution'
            ? 'error'
            : 'completed',
      evaluation: 'unscored',
      completeness:
        observation?.completeness ?? (records.length ? 'partial' : 'absent'),
      ...(observation && {
        observation: observation.value,
        disposition: observation.disposition,
      }),
      failures: [],
      records,
      error: { phase, message: describeError(error) },
    };
  } finally {
    active = false;
  }
  // Preflight owns no runtime resources. A failed execute still needs disposal.
  if (phase !== 'preflight') {
    try {
      await adapter.dispose?.();
    } catch (error) {
      result = { ...result, cleanupError: describeError(error) };
    }
  }
  if (phase !== 'preflight' && adapter.finalizeOperational) {
    try {
      const operational = validateOperationalTelemetry(
        await adapter.finalizeOperational(context),
      );
      if (operational.scope !== 'sample')
        throw new Error('Sample requires sample-owned telemetry');
      result = { ...result, operational };
    } catch (error) {
      result = {
        ...result,
        cleanupError: result.cleanupError ?? describeError(error),
      };
    }
  }
  let judge = judgeNotRun('disabled');
  if (adapter.judge) {
    try {
      const parsed = evaluationJudgeSchema.safeParse(
        await adapter.judge(structuredClone(result), context),
      );
      judge = parsed.success
        ? parsed.data
        : { schemaVersion: 1, status: 'failed', reason: 'invalid_result' };
    } catch {
      judge = { schemaVersion: 1, status: 'failed', reason: 'exception' };
    }
  }
  return structuredClone({ ...result, judge });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
