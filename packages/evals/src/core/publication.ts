import { createHash } from 'node:crypto';
import type { EvaluationResult } from './runtime/evaluate.js';
import {
  type OperationalTelemetry,
  unavailableOperationalTelemetry,
  validateOperationalTelemetry,
} from './runtime/operational-telemetry.ts';

/** Explicitly projected evidence, never an automatic copy of raw runtime values. */
export interface RecordingProjection {
  /** Optional reviewed replacement for the sample observation. Must be plain JSON. */
  readonly observation?: unknown;
  /** Reviewed replacements for selected source records, keyed by source sequence. */
  readonly records: readonly {
    readonly sequence: number;
    readonly value: unknown;
  }[];
}

/** Explicit non-score deferral facts; neither flag establishes correctness or runtime disposition. */
export interface EvaluationPublicationMetadata {
  /** Whether the source scenario expects a deferral. */
  readonly expectedDeferral: boolean;
  /** Optional source assertion about deferring at the expected phase. */
  readonly deferredAsExpected?: boolean;
}

/** Immutable serialized bytes reviewed for a particular destination. */
export interface EvaluationPublication {
  /** Caller-owned destination identity, not a URL resolved by this module. */
  readonly destinationId: string;
  /** Logical artifact name, stable across retries of the same sample. */
  readonly artifactId: string;
  /** Destination/sample/artifact key used to reject conflicting content. */
  readonly publicationKey: string;
  /** SHA-256 of the exact UTF-8 JSON payload. */
  readonly payloadDigest: string;
  /** Content-bound identity to forward to an adapter's deduplication mechanism. */
  readonly publicationId: string;
  /** Versioned, canonical JSON; callers cannot mutate reviewed bytes. */
  readonly json: string;
  /** UTF-8 payload size, not JavaScript string length. */
  readonly bytes: number;
}

/** Local approval policy. A synthetic label or structural validation is not privacy review. */
export interface PublicationPolicy {
  /** Maximum UTF-8 size of the entire payload, including its summary. */
  readonly maxBytes: number;
  /** Explicit synchronous approval of all bytes and destination; false rejects before send. */
  readonly review: (publication: EvaluationPublication) => boolean;
}

/** Adapter acknowledgment only; none of these statuses guarantees durable storage. */
export type PublicationStatus = 'accepted' | 'partial' | 'failed' | 'uncertain';

/** A caller-owned outbound sink; SDK setup, flush and disposal remain outside the runner. */
export interface EvaluationResultSink {
  /** Resolve only with the delivery status known at this boundary, not merely queued success. */
  publish(
    publication: EvaluationPublication,
    signal: AbortSignal,
  ): Promise<{ readonly status: PublicationStatus }>;
}

/** Publication status never changes an evaluation verdict or triggers execution. */
export interface PublicationOutcome {
  readonly publicationId: string;
  readonly payloadDigest: string;
  readonly status: PublicationStatus;
  /** Errors are codes, not unchecked SDK messages that may contain secrets. */
  readonly reason:
    | 'sink'
    | 'timeout'
    | 'sink_error'
    | 'invalid_receipt'
    | 'conflict'
    | 'capacity'
    | 'in_flight';
}

const reviewed = new WeakSet<object>();

/**
 * Prepares a summary after evaluation finalization; raw observations, record values and error
 * text are omitted unless explicitly projected. Review is mandatory even for summary identity.
 */
export function prepareEvaluationPublication(
  result: EvaluationResult<unknown>,
  options: {
    readonly destinationId: string;
    readonly artifactId: string;
    readonly policy: PublicationPolicy;
    readonly recording?: RecordingProjection;
    /** Explicit allowlisted non-score facts, included in the exact-byte review. */
    readonly metadata?: EvaluationPublicationMetadata;
    /** UTC preparation time (ISO date-time with Z); defaults to now, persisted for retries. */
    readonly preparedAt?: string;
  },
): EvaluationPublication {
  const { policy } = options;
  positiveInteger(policy.maxBytes);
  const preparedAt = preparationTime(options.preparedAt);
  const metadata =
    options.metadata === undefined
      ? undefined
      : JSON.parse(boundedJson(options.metadata, policy.maxBytes));
  if (
    metadata !== undefined &&
    (!metadata ||
      Array.isArray(metadata) ||
      typeof metadata.expectedDeferral !== 'boolean' ||
      (Object.hasOwn(metadata, 'deferredAsExpected') &&
        typeof metadata.deferredAsExpected !== 'boolean') ||
      Object.keys(metadata).some(
        (key) => !['expectedDeferral', 'deferredAsExpected'].includes(key),
      ))
  )
    throw new Error('Invalid publication metadata');
  const recording =
    options.recording === undefined
      ? undefined
      : (JSON.parse(
          boundedJson(options.recording, policy.maxBytes),
        ) as RecordingProjection);
  if (
    recording !== undefined &&
    (!recording ||
      !Array.isArray(recording.records) ||
      Object.keys(recording).some(
        (key) => !['observation', 'records'].includes(key),
      ))
  )
    throw new Error('Invalid recording projection');
  for (const value of [
    options.destinationId,
    options.artifactId,
    result.identity.runId,
    result.identity.caseId,
    result.identity.runtimeId,
    result.surface,
    result.provenance,
  ]) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      Buffer.byteLength(value) > policy.maxBytes
    )
      throw new Error('Invalid or oversized publication identity');
  }
  positiveInteger(result.identity.sample);
  if (result.schemaVersion !== 1)
    throw new Error('Unsupported evaluation schema');
  const identity = {
    runId: result.identity.runId,
    caseId: result.identity.caseId,
    runtimeId: result.identity.runtimeId,
    sample: result.identity.sample,
  };
  const sampleKey = JSON.stringify([
    identity.runId,
    identity.caseId,
    identity.runtimeId,
    identity.sample,
  ]);
  if (sampleKey !== result.sampleKey)
    throw new Error('Inconsistent sample identity');
  member(result.execution, ['completed', 'error', 'invalid']);
  member(result.evaluation, ['pass', 'fail', 'unscored', 'not_applicable']);
  member(result.completeness, ['complete', 'partial', 'absent']);
  if (result.disposition !== undefined)
    member(result.disposition, [
      'planned',
      'deferred',
      'handed_off',
      'not_applicable',
    ]);
  if (result.error)
    member(result.error.phase, ['preflight', 'execution', 'scoring']);
  if (!Array.isArray(result.records) || !Array.isArray(result.failures))
    throw new Error('Invalid evaluation evidence');
  const hasObservation = Object.hasOwn(result, 'observation');
  const projectsObservation =
    recording !== undefined && Object.hasOwn(recording, 'observation');
  if (projectsObservation && !hasObservation)
    throw new Error('Cannot project absent observation');
  const selected = new Set<number>();
  const records = (recording?.records ?? [])
    .map(({ sequence, value }) => {
      const source = result.records[sequence];
      if (
        !Number.isSafeInteger(sequence) ||
        sequence < 0 ||
        !source ||
        source.sequence !== sequence ||
        source.sampleKey !== sampleKey ||
        selected.has(sequence)
      )
        throw new Error('Invalid or duplicate projected record sequence');
      member(source.kind, ['turn', 'stage', 'diagnostic']);
      selected.add(sequence);
      return { sequence, kind: source.kind, value };
    })
    .sort((a, b) => a.sequence - b.sequence);
  const operational =
    result.operational === undefined
      ? unavailableOperationalTelemetry()
      : validateOperationalTelemetry(
          JSON.parse(boundedJson(result.operational, policy.maxBytes)),
        );
  if (operational.scope !== 'sample')
    throw new Error('Sample publication requires sample telemetry');
  const json = boundedJson(
    {
      schemaVersion: 1,
      kind: recording ? 'recording' : 'summary',
      preparedAt,
      identity,
      operational,
      surface: result.surface,
      provenance: result.provenance,
      execution: result.execution,
      evaluation: result.evaluation,
      completeness: result.completeness,
      disposition: result.disposition ?? null,
      failureCount: result.failures.length,
      errorPhase: result.error?.phase ?? null,
      cleanupFailed: result.cleanupError !== undefined,
      ...(metadata !== undefined && { metadata }),
      evidence: {
        sourceRecordCount: result.records.length,
        omittedRecordCount: result.records.length - records.length,
        observation: !hasObservation
          ? 'absent'
          : projectsObservation
            ? 'projected'
            : 'omitted',
        omittedFields: [
          'failureMessages',
          'errorMessages',
          'producerIds',
          'requestIds',
        ],
      },
      ...(recording && {
        recording: {
          records,
          ...(projectsObservation && { observation: recording.observation }),
        },
      }),
    },
    policy.maxBytes,
  );
  return sealPublication(json, 1, sampleKey, options);
}

/** Saved run-owned telemetry, never a fabricated sample or a correctness result. */
export interface RunTelemetryResult {
  /** Version of the saved run-level envelope. */
  readonly schemaVersion: 1;
  /** Run ownership, without an invented case or sample. */
  readonly identity: {
    /** Caller-assigned run identity, retained across publication retries. */
    readonly runId: string;
    /** Runtime whose producers belonged exclusively to this collection. */
    readonly runtimeId: string;
  };
  /** Finalized run-scoped aggregates and their collection evidence. */
  readonly operational: OperationalTelemetry;
}

/** Prepares a separate run artifact; callers must own the run's collection boundary. */
export function prepareRunTelemetryPublication(
  result: RunTelemetryResult,
  options: {
    readonly destinationId: string;
    readonly artifactId: string;
    readonly policy: PublicationPolicy;
    readonly preparedAt?: string;
  },
): EvaluationPublication {
  positiveInteger(options.policy.maxBytes);
  const source = JSON.parse(boundedJson(result, options.policy.maxBytes));
  if (
    !source ||
    source.schemaVersion !== 1 ||
    Object.keys(source).some(
      (key) => !['schemaVersion', 'identity', 'operational'].includes(key),
    ) ||
    !source.identity ||
    Object.keys(source.identity).some(
      (key) => !['runId', 'runtimeId'].includes(key),
    )
  )
    throw new Error('Invalid run telemetry');
  for (const value of [
    source.identity.runId,
    source.identity.runtimeId,
    options.destinationId,
    options.artifactId,
  ]) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      Buffer.byteLength(value) > options.policy.maxBytes
    )
      throw new Error('Invalid run identity');
  }
  const operational = validateOperationalTelemetry(source.operational);
  if (operational.scope !== 'run')
    throw new Error('Run publication requires run-owned telemetry');
  const identity = {
    runId: source.identity.runId,
    runtimeId: source.identity.runtimeId,
  };
  const json = boundedJson(
    {
      schemaVersion: 2,
      scope: 'run',
      kind: 'operational-summary',
      identity,
      preparedAt: preparationTime(options.preparedAt),
      operational,
    },
    options.policy.maxBytes,
  );
  return sealPublication(
    json,
    2,
    JSON.stringify(['run', identity.runId, identity.runtimeId]),
    options,
  );
}

function sealPublication(
  json: string,
  version: number,
  identityKey: string,
  options: {
    readonly destinationId: string;
    readonly artifactId: string;
    readonly policy: PublicationPolicy;
  },
): EvaluationPublication {
  const payloadDigest = digest(json);
  const publicationKey = digest(
    JSON.stringify([
      version,
      options.destinationId,
      identityKey,
      options.artifactId,
    ]),
  );
  const publication = Object.freeze({
    destinationId: options.destinationId,
    artifactId: options.artifactId,
    publicationKey,
    payloadDigest,
    publicationId: digest(JSON.stringify([publicationKey, payloadDigest])),
    json,
    bytes: Buffer.byteLength(json),
  });
  if (options.policy.review(publication) !== true)
    throw new Error('Publication review rejected');
  reviewed.add(publication);
  return publication;
}

/**
 * Creates a bounded in-memory publication ledger for one caller-owned sink/destination.
 * Repeated calls explicitly retry partial/failed/uncertain delivery, never evaluation. Accepted
 * content and concurrent calls are reused. This is not cross-process or backend deduplication.
 */
export function createEvaluationPublisher(options: {
  readonly destinationId: string;
  readonly sink: EvaluationResultSink;
  readonly timeoutMs: number;
  readonly maxEntries: number;
}): {
  publish(publication: EvaluationPublication): Promise<PublicationOutcome>;
} {
  positiveInteger(options.timeoutMs);
  positiveInteger(options.maxEntries);
  if (options.timeoutMs > 2_147_483_647 || !options.destinationId.trim())
    throw new Error('Invalid publication configuration');
  const { destinationId, sink, timeoutMs, maxEntries } = options;
  type Entry = {
    digest: string;
    active: boolean;
    pending?: Promise<PublicationOutcome>;
    accepted?: PublicationOutcome;
  };
  const entries = new Map<string, Entry>();
  return {
    async publish(publication) {
      if (
        !reviewed.has(publication) ||
        publication.destinationId !== destinationId
      )
        throw new Error('Expected reviewed publication for this destination');
      const outcome = (
        status: PublicationStatus,
        reason: PublicationOutcome['reason'],
      ): PublicationOutcome =>
        Object.freeze({
          publicationId: publication.publicationId,
          payloadDigest: publication.payloadDigest,
          status,
          reason,
        });
      let entry = entries.get(publication.publicationKey);
      if (entry && entry.digest !== publication.payloadDigest)
        return outcome('failed', 'conflict');
      if (entry?.accepted) return entry.accepted;
      if (entry?.pending) return entry.pending;
      if (entry?.active) return outcome('uncertain', 'in_flight');
      if (!entry) {
        if (entries.size >= maxEntries) return outcome('failed', 'capacity');
        entry = { digest: publication.payloadDigest, active: false };
        entries.set(publication.publicationKey, entry);
      }
      const current = entry;
      current.active = true;
      const controller = new AbortController();
      // Deadline bounds waiting, not an uncooperative SDK's lifetime or delivery.
      current.pending = new Promise<PublicationOutcome>((resolve) => {
        const timer = setTimeout(() => {
          resolve(outcome('uncertain', 'timeout'));
          controller.abort();
        }, timeoutMs);
        const settle = (result: PublicationOutcome) => {
          current.active = false;
          clearTimeout(timer);
          resolve(result);
        };
        Promise.resolve()
          .then(() => sink.publish(publication, controller.signal))
          .then(
            (receipt) => {
              let result: PublicationOutcome;
              try {
                const status = receipt.status;
                member(status, ['accepted', 'partial', 'failed', 'uncertain']);
                result = outcome(status, 'sink');
              } catch {
                result = outcome('uncertain', 'invalid_receipt');
              }
              settle(result);
            },
            () => settle(outcome('uncertain', 'sink_error')),
          );
      });
      const result = await current.pending;
      current.pending = undefined;
      if (result.status === 'accepted') current.accepted = result;
      return result;
    },
  };
}

function preparationTime(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const match =
    typeof value === 'string'
      ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value)
      : null;
  if (!match) throw new Error('Invalid publication preparation time');
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const date = new Date(canonical);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical)
    throw new Error('Invalid publication preparation time');
  return canonical;
}

function positiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Expected positive safe integer limit');
}

function member(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value))
    throw new Error('Invalid publication enum');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function boundedJson(root: unknown, maxBytes: number): string {
  const parts: string[] = [];
  const ancestors = new Set<object>();
  let bytes = 0;
  function append(value: string) {
    bytes += Buffer.byteLength(value);
    if (bytes > maxBytes) throw new Error('Publication exceeds byte limit');
    parts.push(value);
  }
  function visit(value: unknown, depth: number) {
    if (depth > 32) throw new Error('Publication exceeds JSON depth limit');
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      if (typeof value === 'string' && value.length > maxBytes)
        throw new Error('Publication exceeds byte limit');
      append(JSON.stringify(value));
      return;
    }
    if (typeof value !== 'object' || value === null)
      throw new Error('Publication requires plain JSON values');
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error('Publication requires plain JSON objects');
    if (ancestors.has(value))
      throw new Error('Publication contains circular JSON');
    ancestors.add(value);
    const remainingBytes = maxBytes - bytes;
    const arrayLength = array ? value.length : 0;
    // Even one-byte elements need separators and brackets; reject before reflection.
    if (
      array &&
      (remainingBytes < 2 || arrayLength > Math.floor((remainingBytes - 1) / 2))
    )
      throw new Error('Publication exceeds byte limit');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > remainingBytes + (array ? 1 : 0))
      throw new Error('Publication exceeds byte limit');
    const keys = ownKeys.filter((key) => !(array && key === 'length'));
    if (array && keys.length !== arrayLength)
      throw new Error('Sparse arrays are not JSON evidence');
    const descriptors: Record<string, PropertyDescriptor> = Object.create(null);
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
      )
        throw new Error('Unsafe JSON property');
      if (key.length > maxBytes)
        throw new Error('Publication exceeds byte limit');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new Error('JSON accessors and hidden properties are not allowed');
      descriptors[key] = descriptor;
    }
    append(array ? '[' : '{');
    const ordered = array ? keys : keys.sort();
    ordered.forEach((key, index) => {
      if (array && key !== String(index))
        throw new Error('Non-index array property');
      if (index) append(',');
      if (!array) {
        append(JSON.stringify(key));
        append(':');
      }
      visit(descriptors[key as string].value, depth + 1);
    });
    append(array ? ']' : '}');
    ancestors.delete(value);
  }
  visit(root, 0);
  return parts.join('');
}
