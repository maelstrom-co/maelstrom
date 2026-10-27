import { LangfuseClient } from '@langfuse/client';
import type {
  EvaluationResultSink,
  PublicationStatus,
} from '../../packages/evals/src/core/publication.js';
import { mapLangfuseV3Publication } from './mapping.ts';

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
        request = mapLangfuseV3Publication(publication, settings);
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
