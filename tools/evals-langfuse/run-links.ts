import { createHash } from 'node:crypto';
import type { EvaluationPublication } from '../../packages/evals/src/core/publication.js';
import type { LangfuseV3DatasetItem } from './dataset.ts';
import type { importFullPlannerRun } from './full-planner-run.ts';

/** Explicit warning included in every reviewed run-link plan. */
export const evaluatorWarning =
  'Run-item writes can enqueue configured server-side trace/dataset evaluations, including paid provider calls. Confirm no active evaluators before publishing; this importer cannot disable or continuously verify them.';

/** Exact public SDK run-item request; intentionally no datasetVersion or observationId. */
export interface RunLinkRequest {
  /** Deterministic name for this fixed evidence and judge. */
  readonly runName: string;
  /** Human-readable scope, not a calibration claim. */
  readonly runDescription: string;
  /** Allowlisted scalar run provenance. */
  readonly metadata: Readonly<Record<string, string | number>>;
  /** Previously published item, never recreated by this operation. */
  readonly datasetItemId: string;
  /** Previously published trace containing this judge's scores. */
  readonly traceId: string;
  /** Saved publication preparation time, not runtime latency. */
  readonly createdAt: string;
}

/** Constructs the first TypeSafe run without executing tasks or reading remote state. */
export function planRunLinks(
  publications: readonly EvaluationPublication[],
  items: readonly LangfuseV3DatasetItem[],
  source: ReturnType<typeof importFullPlannerRun>['source'],
  catalogApprovalSha256: string,
  maxRequestBytes: number,
) {
  if (
    !items.length ||
    items.length !== publications.length ||
    items.length !== source.actualRecordCount
  )
    throw new Error('Invalid link count');
  const first = items[0];
  const createdAt: string = JSON.parse(publications[0].json).preparedAt;
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const metadata = item.metadata;
    if (
      seen.has(item.id) ||
      item.datasetName !== first.datasetName ||
      metadata.runId !== source.runId ||
      metadata.judgeStatus !== 'scored' ||
      metadata.judgeKind !== 'llm' ||
      metadata.judgeProvider !== 'typesafe' ||
      metadata.judgeModel !== 'jev-1.13.0' ||
      metadata.judgeRubric !== 'planner_response_text_1' ||
      metadata.judgeRubricVersion !== 2 ||
      metadata.judgeCalibration !== 'unvalidated' ||
      !['baseline', 'jev-poc'].includes(item.input.arm) ||
      JSON.parse(publications[index].json).preparedAt !== createdAt ||
      publications[index].destinationId !== publications[0].destinationId ||
      publications[index].artifactId !== publications[0].artifactId
    )
      throw new Error('Unsupported or mixed judge evidence');
    for (const dimension of ['request_satisfied', 'arrangement_match'])
      if (
        metadata[`judge.${dimension}.min`] !== 0 ||
        metadata[`judge.${dimension}.max`] !== 1 ||
        typeof metadata[`judge.${dimension}.value`] !== 'number'
      )
        throw new Error('Unsupported score scale');
    if (
      Object.keys(metadata).filter((key) => key.startsWith('judge.')).length !==
      6
    )
      throw new Error('Unsupported judge dimensions');
    seen.add(item.id);
  }
  const arms = [...new Set(items.map((item) => item.input.arm))].sort();
  const judge = {
    provider: 'typesafe',
    model: 'jev-1.13.0',
    rubric: 'planner_response_text_1',
    rubricVersion: 2,
    evidenceRendering: 'planner_response_text_1',
    calibration: 'unvalidated',
    scores: ['request_satisfied', 'arrangement_match'].map((name) => ({
      name,
      min: 0,
      max: 1,
    })),
  };
  // Excludes preparation time and transport limits so changed settings cannot bypass the local retry guard.
  const runKey = createHash('sha256')
    .update(
      JSON.stringify([
        'maelstrom/run-links/v1',
        first.datasetName,
        publications[0].destinationId,
        source.runId,
        publications[0].artifactId,
        judge,
      ]),
    )
    .digest('hex');
  const scope = arms.length > 1 ? 'mixed-arms' : arms[0];
  const runName = `typesafe-jev-1.13.0-${scope}-${runKey}`;
  const runDescription = `Imported saved TypeSafe jev-1.13.0 judgments; planner_response_text_1 v2; unvalidated; ${scope} (${arms.join(', ')}). Descriptive fixed evidence, not a paired planner-arm comparison. Publication timestamps are not evaluation latency.`;
  const metadata = {
    sourceRunId: source.runId,
    provider: judge.provider,
    model: judge.model,
    rubric: judge.rubric,
    rubricVersion: judge.rubricVersion,
    calibration: judge.calibration,
    arms: arms.join(','),
    samples: items.length,
    timing: 'publication preparation only',
  };
  const requests: RunLinkRequest[] = items.map((item) => ({
    runName,
    runDescription,
    metadata,
    datasetItemId: item.id,
    traceId: item.sourceTraceId,
    createdAt,
  }));
  if (
    requests.some(
      (request) => Buffer.byteLength(JSON.stringify(request)) > maxRequestBytes,
    )
  )
    throw new Error('Run-link request exceeds limit');
  const manifest = {
    schemaVersion: 1,
    datasetName: first.datasetName,
    catalogApprovalSha256,
    source,
    judge,
    samples: items.map((item, index) => ({
      ...item.input,
      datasetItemId: item.id,
      traceId: item.sourceTraceId,
      publicationKey: publications[index].publicationKey,
      publicationId: publications[index].publicationId,
      payloadDigest: publications[index].payloadDigest,
    })),
  };
  return {
    manifest,
    manifestSha256: createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex'),
    requests,
    evaluatorWarning,
    datasetVersionPolicy:
      'latest existing item; preparation predates item creation',
    journalFile: `langfuse-run-links-${runKey}.jsonl`,
    recoveryPolicy:
      'No automatic retry or resume. Preserve the journal beside the original saved run. Any existing journal blocks publication; reconcile attempts manually. An absent eventually-consistent remote read does not authorize a retry.',
  };
}

/** Frozen local manifest and exact outbound run-item requests. */
export type RunLinkPlan = ReturnType<typeof planRunLinks>;
