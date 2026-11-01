import { createHash } from 'node:crypto';
import { normalizeJudgeResult } from '../../packages/evals/src/core/judge-result.ts';
import type { EvaluationPublication } from '../../packages/evals/src/core/publication.js';
import { mapLangfuseV3Publication } from './mapping.ts';
import type { LangfuseV3Config } from './sink.js';

/** Shared results catalog; not a runnable experiment dataset. */
export const defaultDatasetName = 'maelstrom-evals-v1';

/** Exact outbound dataset-item projection; no expected output or raw evidence. */
export interface LangfuseV3DatasetItem {
  /** Project-scoped stable ID, namespaced by dataset and publication key. */
  readonly id: string;
  /** Explicit reviewed dataset name. */
  readonly datasetName: string;
  /** Identifiers only, never task content. */
  readonly input: {
    /** Scenario identifier. */
    readonly caseId: string;
    /** Planner arm identifier. */
    readonly arm: string;
    /** One-based sample repeat. */
    readonly repeat: number;
  };
  /** Strict scalar projection of finalized statuses, provenance and scores. */
  readonly metadata: Readonly<Record<string, string | number>>;
  /** Corresponding private publication trace; not a dataset-run association. */
  readonly sourceTraceId: string;
}

/** Validates a bounded catalog identifier supplied by the operator, not a sample. */
export function validateDatasetName(name: string): void {
  if (
    typeof name !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(name)
  )
    throw new Error('Invalid dataset name');
}

/** Projects saved full-planner summaries offline, using the same mapping as publication. */
export function mapLangfuseV3DatasetItem(
  publication: EvaluationPublication,
  config: Pick<LangfuseV3Config, 'destinationId' | 'maxBatchBytes'> & {
    readonly datasetName: string;
  },
): LangfuseV3DatasetItem {
  validateDatasetName(config.datasetName);
  const ingestion = mapLangfuseV3Publication(publication, config);
  const payload = JSON.parse(publication.json);
  if (
    payload.schemaVersion !== 1 ||
    payload.kind !== 'summary' ||
    payload.surface !== 'planner-report' ||
    payload.provenance !== 'imported:full-planner-run/v1'
  )
    throw new Error('Dataset requires a full-planner summary');
  const trace = ingestion.batch[0];
  if (trace.type !== 'trace-create' || !trace.body.id)
    throw new Error('Missing publication trace');
  const judge = normalizeJudgeResult(payload.judge);
  const metadata: Record<string, string | number> = {
    publicationKey: publication.publicationKey,
    publicationId: publication.publicationId,
    runId: payload.identity.runId,
    execution: payload.execution,
    evaluation: payload.evaluation,
    completeness: payload.completeness,
    judgeStatus: judge.status,
  };
  if (judge.rubric) {
    metadata.judgeRubric = judge.rubric.id;
    metadata.judgeRubricVersion = judge.rubric.version;
  }
  if (judge.provenance) {
    metadata.judgeKind = judge.provenance.kind;
    metadata.judgeProvider = judge.provenance.provider;
    if (judge.provenance.model) metadata.judgeModel = judge.provenance.model;
  }
  if (judge.status === 'scored') {
    metadata.judgeCalibration = judge.calibration;
    for (const score of judge.scores) {
      metadata[`judge.${score.name}.value`] = score.value;
      metadata[`judge.${score.name}.min`] = score.min;
      metadata[`judge.${score.name}.max`] = score.max;
    }
  }
  for (const event of ingestion.batch)
    if (event.type === 'score-create' && event.body.name === 'eval.correctness')
      metadata.correctness = event.body.value;
  const item: LangfuseV3DatasetItem = {
    id: createHash('sha256')
      .update(
        JSON.stringify([
          'maelstrom/dataset-item/v1',
          config.datasetName,
          publication.publicationKey,
        ]),
      )
      .digest('hex'),
    datasetName: config.datasetName,
    input: {
      caseId: payload.identity.caseId,
      arm: payload.identity.runtimeId,
      repeat: payload.identity.sample,
    },
    metadata,
    sourceTraceId: trace.body.id,
  };
  if (Buffer.byteLength(JSON.stringify(item)) > config.maxBatchBytes)
    throw new Error('Dataset item exceeds limit');
  return item;
}
