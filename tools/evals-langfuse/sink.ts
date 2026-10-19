import { createHash } from 'node:crypto';
import { LangfuseClient } from '@langfuse/client';
import type {
  EvaluationPublication,
  EvaluationResultSink,
  PublicationStatus,
} from '../../packages/evals/src/core/publication.js';

type Batch = LangfuseClient['api']['ingestion']['batch'];
type BatchRequest = Parameters<Batch>[0];
type BatchOptions = NonNullable<Parameters<Batch>[1]>;
type BatchReceipt = Awaited<ReturnType<Batch>>;

/** Public SDK API subset; an injected transport is borrowed and never shut down here. */
export interface LangfuseV3Transport {
  /** Public SDK ingestion request/response contract; no internal SDK imports. */
  batch(request: BatchRequest, options: BatchOptions): Promise<BatchReceipt>;
}

/** Explicit configuration for the v3-only adapter; no environment defaults. */
export interface LangfuseV3Config {
  /** Explicit operator assertion, not a remotely detected server version. */
  readonly serverVersion: '3.163.0';
  /** Must match the destination approved in the publication. */
  readonly destinationId: string;
  /** Trusted self-hosted endpoint, independent of publication content. */
  readonly baseUrl: string;
  /** Caller-provided project key; never inferred from the environment. */
  readonly publicKey: string;
  /** Caller-provided server secret; never included in evidence or errors. */
  readonly secretKey: string;
  /** Full serialized ingestion batch cap, at most the SDK-documented 3.5 MB. */
  readonly maxBatchBytes: number;
  /** Send deadline; abort does not prove remote cancellation. */
  readonly timeoutMs: number;
  /** Shutdown wait bound; unfinished requests yield uncertainty. */
  readonly shutdownTimeoutMs: number;
  /** Admission cap, including timed-out requests that have not settled. */
  readonly maxInFlight: number;
}

/** Explicitly started sink; shutdown stops admission and requests in-flight abort. */
export interface LangfuseV3Sink extends EvaluationResultSink {
  /** Idempotent close of owned resources; never disposes an injected transport. */
  shutdown(): Promise<'closed' | 'uncertain'>;
}

/**
 * Starts a caller-owned, v3-only publication sink. No global OTel registration, scheduler,
 * queued score writes or import-time client exists. Acceptance means per-event API receipt,
 * not persistence. Use only publications prepared/reviewed by the generic publisher.
 */
export function startLangfuseV3Sink(
  config: LangfuseV3Config,
  borrowedTransport?: LangfuseV3Transport,
): LangfuseV3Sink {
  validateConfig(config);
  const settings = Object.freeze({ ...config });
  const client = borrowedTransport
    ? undefined
    : new LangfuseClient({
        baseUrl: settings.baseUrl,
        publicKey: settings.publicKey,
        secretKey: settings.secretKey,
        timeout: settings.timeoutMs / 1_000,
      });
  const transport: LangfuseV3Transport = borrowedTransport ?? {
    batch: (request, options) => {
      if (!client) throw new Error('Langfuse client unavailable');
      return client.api.ingestion.batch(request, options);
    },
  };
  const active = new Map<Promise<void>, AbortController>();
  let closed = false;
  let shutdown: Promise<'closed' | 'uncertain'> | undefined;
  return {
    async publish(publication, signal) {
      if (closed || active.size >= settings.maxInFlight)
        return { status: 'failed' };
      if (signal.aborted) return { status: 'failed' };
      let request: BatchRequest;
      try {
        request = mapPublication(publication, settings);
      } catch {
        return { status: 'failed' };
      }
      const controller = new AbortController();
      let complete!: (status: PublicationStatus) => void;
      const result = new Promise<PublicationStatus>((resolve) => {
        complete = resolve;
      });
      const abort = () => {
        complete('uncertain');
        controller.abort();
      };
      signal.addEventListener('abort', abort, { once: true });
      controller.signal.addEventListener('abort', () => complete('uncertain'), {
        once: true,
      });
      const timer = setTimeout(abort, settings.timeoutMs);
      const pending = Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) return undefined;
          return transport.batch(request, {
            maxRetries: 0,
            timeoutInSeconds: settings.timeoutMs / 1_000,
            abortSignal: controller.signal,
          });
        })
        .then(
          (receipt): PublicationStatus =>
            controller.signal.aborted
              ? 'uncertain'
              : receiptStatus(receipt, request),
        )
        .catch((): PublicationStatus => 'uncertain')
        .then((status) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          active.delete(pending);
          complete(status);
        });
      // Keep a timed-out send counted until it actually settles; abort is not cancellation proof.
      active.set(pending, controller);
      return { status: await result };
    },
    shutdown() {
      if (shutdown) return shutdown;
      closed = true;
      for (const controller of active.values()) controller.abort();
      shutdown = new Promise((resolve) => {
        const timer = setTimeout(
          () => resolve('uncertain'),
          settings.shutdownTimeoutMs,
        );
        Promise.all([...active.keys()])
          .then(() => client?.shutdown())
          .then(
            () => {
              clearTimeout(timer);
              resolve('closed');
            },
            () => {
              clearTimeout(timer);
              resolve('uncertain');
            },
          );
      });
      return shutdown;
    },
  };
}

function validateConfig(config: LangfuseV3Config): void {
  if (config.serverVersion !== '3.163.0')
    throw new Error('This adapter targets Langfuse OSS 3.163.0 only');
  for (const value of [
    config.destinationId,
    config.publicKey,
    config.secretKey,
  ])
    if (typeof value !== 'string' || !value.trim())
      throw new Error('Explicit destination and credentials are required');
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error('Explicit Langfuse base URL required');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid Langfuse base URL');
  for (const value of [
    config.timeoutMs,
    config.shutdownTimeoutMs,
    config.maxInFlight,
    config.maxBatchBytes,
  ])
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new Error('Positive bounded limits required');
  if (config.maxBatchBytes > 3_500_000)
    throw new Error('Langfuse ingestion batch limit is 3.5 MB');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mapPublication(
  publication: EvaluationPublication,
  config: LangfuseV3Config,
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

function receiptStatus(
  receipt: unknown,
  request: BatchRequest,
): PublicationStatus {
  if (!receipt || typeof receipt !== 'object') return 'uncertain';
  const { successes, errors } = receipt as Partial<BatchReceipt>;
  if (!Array.isArray(successes) || !Array.isArray(errors)) return 'uncertain';
  const expected = new Set(request.batch.map((event) => event.id));
  if (successes.length + errors.length > expected.size) return 'uncertain';
  const seen = new Set<string>();
  let accepted = 0;
  let rejected = 0;
  for (const [items, success] of [
    [successes, true],
    [errors, false],
  ] as const) {
    for (const item of items) {
      if (!item || !expected.has(item.id) || seen.has(item.id))
        return 'uncertain';
      seen.add(item.id);
      if (!Number.isInteger(item.status)) return 'uncertain';
      if (success) {
        if (item.status < 200 || item.status >= 300) return 'uncertain';
        accepted++;
      } else {
        if (item.status < 400 || item.status >= 600) return 'uncertain';
        if (item.status < 500 && item.status !== 408 && item.status !== 429)
          rejected++;
      }
    }
  }
  if (accepted === expected.size) return 'accepted';
  if (rejected === expected.size) return 'failed';
  return accepted > 0 ? 'partial' : 'uncertain';
}
