import { createHash } from 'node:crypto';
import type { LangfuseClient } from '@langfuse/client';
import type { EvaluationPublication } from '../../packages/evals/src/core/publication.js';
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
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    !['summary', 'recording'].includes(payload.kind)
  )
    throw new Error('Unsupported publication schema');
  const identity = payload.identity;
  for (const value of [
    identity?.runId,
    identity?.caseId,
    identity?.runtimeId,
    publication.artifactId,
  ])
    if (typeof value !== 'string' || !value.trim())
      throw new Error('Invalid publication identity');
  if (!Number.isSafeInteger(identity.sample) || identity.sample < 1)
    throw new Error('Invalid sample');
  const sampleKey = JSON.stringify([
    identity.runId,
    identity.caseId,
    identity.runtimeId,
    identity.sample,
  ]);
  const key = hash(
    JSON.stringify([
      1,
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
    !['completed', 'error', 'invalid'].includes(payload.execution) ||
    !['pass', 'fail', 'unscored', 'not_applicable'].includes(
      payload.evaluation,
    ) ||
    !['complete', 'partial', 'absent'].includes(payload.completeness) ||
    ![null, 'planned', 'deferred', 'handed_off', 'not_applicable'].includes(
      payload.disposition,
    ) ||
    ![null, 'preflight', 'execution', 'scoring'].includes(payload.errorPhase)
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
  const metadata = {
    publicationId: publication.publicationId,
    publicationKey: publication.publicationKey,
    payloadDigest: publication.payloadDigest,
    artifactId: publication.artifactId,
    ...identity,
    execution: payload.execution,
    evaluation: payload.evaluation,
    completeness: payload.completeness,
    disposition: payload.disposition,
    timing: 'publication only; not evaluation latency',
  };
  const batch: BatchRequest['batch'] = [
    {
      type: 'trace-create',
      id: eventId('trace-create'),
      timestamp,
      body: {
        id: traceId,
        timestamp,
        name: 'maelstrom.eval.publication',
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
  const request = { batch };
  if (Buffer.byteLength(JSON.stringify(request)) > config.maxBatchBytes)
    throw new Error('Langfuse batch exceeds limit');
  return request;
}
