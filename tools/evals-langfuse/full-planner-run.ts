import { createHash } from 'node:crypto';
import {
  judgeFromGrader,
  normalizeJudgeResult,
} from '../../packages/evals/src/core/judge-result.ts';
import type { EvaluationPublicationMetadata } from '../../packages/evals/src/core/publication.js';
import type { EvaluationResult } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  unavailableOperationalTelemetry,
  validateOperationalTelemetry,
} from '../../packages/evals/src/core/runtime/operational-telemetry.ts';

/** One conservatively mapped native planner sample, with non-score facts kept separate. */
export interface ImportedPlannerSample {
  /** Status and score projection, never raw planner output. */
  readonly result: EvaluationResult<unknown>;
  /** Explicit deferral facts for publication review, not correctness scores. */
  readonly metadata: EvaluationPublicationMetadata;
}

/** Projects native records after validating both report files and unique sample identities. */
export function importFullPlannerRun(
  recordsBytes: Uint8Array,
  summaryBytes: Uint8Array,
  maxPublications: number,
) {
  const decode = (bytes: Uint8Array): unknown =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const records = decode(recordsBytes);
  const summary = decode(summaryBytes);
  if (
    !Number.isSafeInteger(maxPublications) ||
    maxPublications < 1 ||
    !Array.isArray(records) ||
    records.length === 0 ||
    records.length > maxPublications ||
    !object(summary) ||
    !object(summary.meta) ||
    !Array.isArray(summary.summaries)
  )
    throw new Error('Invalid planner report');
  const { arms: armNames, repeats, scenarios } = summary.meta;
  if (
    !text(armNames) ||
    !positiveInteger(repeats) ||
    !positiveInteger(scenarios)
  )
    throw new Error('Invalid planner count metadata');
  const arms = armNames.split(',').map((arm) => arm.trim());
  const expectedRecordCount = scenarios * repeats * arms.length;
  if (
    arms.some((arm) => !text(arm)) ||
    new Set(arms).size !== arms.length ||
    !Number.isSafeInteger(expectedRecordCount) ||
    records.length !== expectedRecordCount
  )
    throw new Error('Inconsistent planner record counts');

  const hash = createHash('sha256').update('maelstrom/full-planner-run/v1\0');
  for (const bytes of [recordsBytes, summaryBytes]) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.byteLength));
    hash.update(length).update(bytes);
  }
  const source = {
    runId: `full-planner-${hash.digest('hex')}`,
    recordsDigest: createHash('sha256').update(recordsBytes).digest('hex'),
    summaryDigest: createHash('sha256').update(summaryBytes).digest('hex'),
    actualRecordCount: records.length,
    expectedRecordCount,
  };
  const seen = new Set<string>();
  const samples: ImportedPlannerSample[] = records.map((record) => {
    if (
      !object(record) ||
      !text(record.scenarioId) ||
      !text(record.arm) ||
      !text(record.suite) ||
      !text(record.kind) ||
      typeof record.repeat !== 'number' ||
      !Number.isSafeInteger(record.repeat) ||
      record.repeat < 1 ||
      typeof record.expectedDeferral !== 'boolean' ||
      (Object.hasOwn(record, 'deferredAsExpected') &&
        typeof record.deferredAsExpected !== 'boolean') ||
      (Object.hasOwn(record, 'error') &&
        (!object(record.error) ||
          typeof record.error.tag !== 'string' ||
          typeof record.error.message !== 'string')) ||
      (Object.hasOwn(record, 'score') &&
        (!object(record.score) ||
          (Object.hasOwn(record.score, 'pass') &&
            typeof record.score.pass !== 'boolean') ||
          (Object.hasOwn(record.score, 'failures') &&
            (!Array.isArray(record.score.failures) ||
              !record.score.failures.every(
                (failure) => typeof failure === 'string',
              )))))
    )
      throw new Error('Invalid planner record');
    const key = JSON.stringify([record.scenarioId, record.arm, record.repeat]);
    if (seen.has(key)) throw new Error('Duplicate planner sample');
    seen.add(key);
    const identity = {
      runId: source.runId,
      caseId: record.scenarioId,
      runtimeId: record.arm,
      sample: record.repeat,
    };
    const error = Object.hasOwn(record, 'error');
    const score = object(record.score) ? record.score : undefined;
    const scored =
      !error && !record.expectedDeferral && typeof score?.pass === 'boolean';
    const operational =
      record.operational === undefined
        ? unavailableOperationalTelemetry()
        : validateOperationalTelemetry(record.operational);
    if (operational.scope !== 'sample')
      throw new Error('Native turn requires sample-owned telemetry');
    return {
      result: {
        operational,
        judge:
          record.judge === undefined
            ? judgeFromGrader(record.grader)
            : normalizeJudgeResult(record.judge),
        schemaVersion: 1,
        identity,
        sampleKey: JSON.stringify([
          identity.runId,
          identity.caseId,
          identity.runtimeId,
          identity.sample,
        ]),
        surface: 'planner-report',
        provenance: 'imported:full-planner-run/v1',
        execution: error ? 'error' : 'completed',
        evaluation: scored ? (score?.pass ? 'pass' : 'fail') : 'unscored',
        completeness: scored ? 'complete' : 'absent',
        ...(scored && { disposition: 'planned' }),
        failures:
          scored && Array.isArray(score?.failures) ? score.failures : [],
        records: [],
        ...(error && {
          error: { phase: 'execution', message: 'Source error text omitted' },
        }),
      },
      metadata: {
        expectedDeferral: record.expectedDeferral,
        ...(typeof record.deferredAsExpected === 'boolean' && {
          deferredAsExpected: record.deferredAsExpected,
        }),
      },
    };
  });
  return { source, samples };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
