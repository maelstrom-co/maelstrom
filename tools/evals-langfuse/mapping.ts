import { createHash } from 'node:crypto';
import type { LangfuseClient } from '@langfuse/client';
import { normalizeJudgeResult } from '../../packages/evals/src/core/judge-result.ts';
import type { EvaluationPublication } from '../../packages/evals/src/core/publication.js';
import { validateOperationalTelemetry } from '../../packages/evals/src/core/runtime/operational-telemetry.ts';
import type { LangfuseV3Config } from './sink.js';

type BatchRequest = Parameters<LangfuseClient['api']['ingestion']['batch']>[0];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Maps and bounds one reviewed payload without constructing an SDK client or sending it. */
export function mapLangfuseV3Publication(
  publication: EvaluationPublication,
  config: Pick<LangfuseV3Config, 'destinationId' | 'maxBatchBytes'>,
): BatchRequest {
  if (
    publication.destinationId !== config.destinationId ||
    typeof publication.json !== 'string' ||
    publication.json.length > config.maxBatchBytes ||
    Buffer.byteLength(publication.json) !== publication.bytes ||
    publication.bytes > config.maxBatchBytes ||
    hash(publication.json) !== publication.payloadDigest
  )
    throw new Error('Invalid publication');
  const payload = JSON.parse(publication.json);
  const run =
    payload?.schemaVersion === 2 &&
    payload.scope === 'run' &&
    payload.kind === 'operational-summary';
  if (
    !payload ||
    (!run &&
      (payload.schemaVersion !== 1 ||
        !['summary', 'recording'].includes(payload.kind)))
  )
    throw new Error('Unsupported publication schema');
  const identity = payload.identity;
  for (const value of [
    identity?.runId,
    ...(run ? [] : [identity?.caseId]),
    identity?.runtimeId,
    publication.artifactId,
  ])
    if (typeof value !== 'string' || !value.trim())
      throw new Error('Invalid publication identity');
  if (!run && (!Number.isSafeInteger(identity.sample) || identity.sample < 1))
    throw new Error('Invalid sample');
  if (
    run &&
    Object.keys(identity).some((key) => !['runId', 'runtimeId'].includes(key))
  )
    throw new Error('Invalid run identity');
  const sampleKey = run
    ? JSON.stringify(['run', identity.runId, identity.runtimeId])
    : JSON.stringify([
        identity.runId,
        identity.caseId,
        identity.runtimeId,
        identity.sample,
      ]);
  const key = hash(
    JSON.stringify([
      run ? 2 : 1,
      config.destinationId,
      sampleKey,
      publication.artifactId,
    ]),
  );
  if (
    key !== publication.publicationKey ||
    hash(JSON.stringify([key, publication.payloadDigest])) !==
      publication.publicationId
  )
    throw new Error('Inconsistent publication identity');
  if (
    !run &&
    (!['completed', 'error', 'invalid'].includes(payload.execution) ||
      !['pass', 'fail', 'unscored', 'not_applicable'].includes(
        payload.evaluation,
      ) ||
      !['complete', 'partial', 'absent'].includes(payload.completeness) ||
      ![null, 'planned', 'deferred', 'handed_off', 'not_applicable'].includes(
        payload.disposition,
      ) ||
      ![null, 'preflight', 'execution', 'scoring'].includes(payload.errorPhase))
  )
    throw new Error('Invalid publication status');
  const eventId = (kind: string) =>
    hash(JSON.stringify([publication.publicationId, kind]));
  const traceId = eventId('trace').slice(0, 32);
  const spanId = eventId('observation').slice(0, 16);
  const timestamp = payload.preparedAt;
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !== timestamp
  )
    throw new Error('Invalid publication preparation time');
  const judge = run ? undefined : normalizeJudgeResult(payload.judge);
  const metadata = {
    ...(judge && { judge }),
    publicationId: publication.publicationId,
    publicationKey: publication.publicationKey,
    payloadDigest: publication.payloadDigest,
    artifactId: publication.artifactId,
    ...identity,
    scope: run ? 'run' : 'sample',
    ...(run
      ? {}
      : {
          surface: payload.surface,
          provenance: payload.provenance,
          execution: payload.execution,
          evaluation: payload.evaluation,
          completeness: payload.completeness,
          disposition: payload.disposition,
        }),
    timing: 'publication only; not evaluation latency',
  };
  const batch: BatchRequest['batch'] = [
    {
      type: 'trace-create',
      // Rename existing traces without reusing the old trace-create event's deduplication key.
      id: eventId(run ? 'trace-create' : 'trace-create:case-name/v1'),
      timestamp,
      body: {
        id: traceId,
        timestamp,
        name: run
          ? 'maelstrom.eval.publication'
          : `maelstrom.eval.${identity.caseId}`,
        sessionId: identity.runId,
        environment: 'maelstrom-eval',
        public: false,
        metadata,
      },
    },
    {
      type: 'span-create',
      id: eventId('span-create'),
      timestamp,
      body: {
        id: spanId,
        traceId,
        name: 'maelstrom.eval.export',
        startTime: timestamp,
        endTime: timestamp,
        environment: 'maelstrom-eval',
        metadata,
        output: payload,
      },
    },
  ];
  if (
    !run &&
    ['pass', 'fail'].includes(payload.evaluation) &&
    payload.execution === 'completed' &&
    payload.completeness === 'complete' &&
    payload.errorPhase === null &&
    ['planned', 'deferred'].includes(payload.disposition)
  )
    batch.push({
      type: 'score-create',
      id: eventId('score-create'),
      timestamp,
      body: {
        id: eventId('correctness'),
        traceId,
        observationId: spanId,
        name: 'eval.correctness',
        dataType: 'BOOLEAN',
        value: payload.evaluation === 'pass' ? 1 : 0,
        environment: 'maelstrom-eval',
      },
    });
  if (judge?.status === 'scored') {
    for (const score of judge.scores) {
      const name = `eval.judge.${judge.rubric.id}.v${judge.rubric.version}.${judge.provenance.kind}.${score.name}`;
      batch.push({
        type: 'score-create',
        id: eventId(`score-create:${name}`),
        timestamp,
        body: {
          id: eventId(`score:${name}`),
          traceId,
          observationId: spanId,
          name,
          dataType: 'NUMERIC',
          value: score.value,
          comment: `unvalidated; range [${score.min}, ${score.max}]; provider ${judge.provenance.provider}`,
          environment: 'maelstrom-eval',
        },
      });
    }
  }
  if (payload.operational !== undefined) {
    const operational = validateOperationalTelemetry(payload.operational);
    if (operational.scope !== (run ? 'run' : 'sample'))
      throw new Error('Operational scope mismatch');
    for (const group of operational.groups) {
      const prefix = `eval.operational.${group.operation}.${group.outcome}`;
      const metrics: [string, number][] = [
        ['count', group.count],
        ['duration_sample_count', group.durationSampleCount],
      ];
      if (group.durationMeanMs !== undefined)
        metrics.push(['duration_mean_ms', group.durationMeanMs]);
      for (const [metric, value] of metrics) {
        const key = JSON.stringify([
          'operational',
          operational.schemaVersion,
          operational.scope,
          group.operation,
          group.outcome,
          metric,
        ]);
        batch.push({
          type: 'score-create',
          id: eventId(`score-create:${key}`),
          timestamp,
          body: {
            id: eventId(`score:${key}`),
            traceId,
            observationId: spanId,
            name: `${prefix}.${metric}`,
            dataType: 'NUMERIC',
            value,
            environment: 'maelstrom-eval',
          },
        });
      }
    }
  } else if (run) throw new Error('Run telemetry missing');
  const request = { batch };
  if (Buffer.byteLength(JSON.stringify(request)) > config.maxBatchBytes)
    throw new Error('Langfuse batch exceeds limit');
  return request;
}
