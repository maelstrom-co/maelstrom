import type { STTError, TTSError, VoiceProviderErrorKind } from './types.js';

type ProviderErrorSource = 'stt' | 'tts';

type ProviderErrorForSource<TSource extends ProviderErrorSource> =
  TSource extends 'stt' ? STTError : TTSError;

type ProviderErrorFor<
  TSource extends ProviderErrorSource,
  TKind extends VoiceProviderErrorKind,
> = Extract<ProviderErrorForSource<TSource>, { source: TSource; kind: TKind }>;

interface ProviderErrorMetadata<
  TSource extends ProviderErrorSource,
  TKind extends VoiceProviderErrorKind,
> {
  provider: string;
  source: TSource;
  kind: TKind;
  cause?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return String(error);
}

function readCode(error: unknown): string | number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const code = error.code;

  if (typeof code === 'string' || typeof code === 'number') {
    return code;
  }

  return undefined;
}

function readStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.status;
  if (typeof status === 'number') {
    return status;
  }

  const statusCode = error.statusCode;
  if (typeof statusCode === 'number') {
    return statusCode;
  }

  return undefined;
}

function includesAny(message: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => message.includes(phrase));
}

interface ProviderErrorClassificationSignals {
  message: string;
  normalizedCode: string | number | undefined;
  status: number | undefined;
}

const GRPC_STATUS_PERMISSION_DENIED = 7;
const GRPC_STATUS_RESOURCE_EXHAUSTED = 8;
const GRPC_STATUS_INTERNAL = 13;
const GRPC_STATUS_UNAVAILABLE = 14;
const GRPC_STATUS_UNAUTHENTICATED = 16;

function isExplicitAuthStatusOrCode(
  status: number | undefined,
  normalizedCode: string | number | undefined,
): boolean {
  return (
    status === 401 ||
    status === 403 ||
    normalizedCode === GRPC_STATUS_PERMISSION_DENIED ||
    normalizedCode === GRPC_STATUS_UNAUTHENTICATED ||
    normalizedCode === 'permission_denied' ||
    normalizedCode === 'unauthenticated'
  );
}

function isExplicitQuotaStatusOrCode(
  status: number | undefined,
  normalizedCode: string | number | undefined,
): boolean {
  return (
    status === 429 ||
    normalizedCode === GRPC_STATUS_RESOURCE_EXHAUSTED ||
    normalizedCode === 'resource_exhausted'
  );
}

const transportIndicators = [
  'websocket',
  'socket',
  'not connected',
  'connection timeout',
  'timeout',
  'network',
  'closed unexpectedly',
  'disconnected',
  'connection lost',
  'transport',
] as const;

const serverIndicators = [
  'internal',
  'upstream failure',
  'provider error',
  'server error',
] as const;

const parseIndicators = [
  'json',
  'must be',
  'unsupported',
  'bad request',
  'expected sample',
  'only supports',
] as const;

const authMessageIndicators = [
  'unauthorized',
  'forbidden',
  'invalid api key',
  'missing api key',
  'api key is invalid',
  'invalid credential',
  'missing credential',
  'invalid token',
  'token expired',
  'authentication failed',
  'authentication error',
  'auth failed',
  'auth error',
] as const;

const quotaMessageIndicators = [
  'quota',
  'rate limit',
  'too many requests',
  'resource exhausted',
  'limit exceeded',
] as const;

function readClassificationSignals(
  error: unknown,
): ProviderErrorClassificationSignals {
  const message = readMessage(error).trim().toLowerCase();
  const code = readCode(error);

  return {
    message,
    normalizedCode: typeof code === 'string' ? code.trim().toLowerCase() : code,
    status: readStatus(error),
  };
}

function classifyProviderErrorKind(error: unknown): VoiceProviderErrorKind {
  const { message, normalizedCode, status } = readClassificationSignals(error);

  if (isExplicitAuthStatusOrCode(status, normalizedCode)) {
    return 'auth';
  }

  if (isExplicitQuotaStatusOrCode(status, normalizedCode)) {
    return 'quota';
  }

  if (includesAny(message, quotaMessageIndicators)) {
    return 'quota';
  }

  if (
    normalizedCode === GRPC_STATUS_UNAVAILABLE ||
    normalizedCode === 'unavailable' ||
    includesAny(message, transportIndicators)
  ) {
    return 'transport';
  }

  if (includesAny(message, authMessageIndicators)) {
    return 'auth';
  }

  if (status !== undefined && status >= 500) {
    return 'server';
  }

  if (
    normalizedCode === GRPC_STATUS_INTERNAL ||
    normalizedCode === 'internal' ||
    includesAny(message, serverIndicators)
  ) {
    return 'server';
  }

  if (status === 400 || includesAny(message, parseIndicators)) {
    return 'parse';
  }

  return 'unknown';
}

function traceUnknownProviderErrorClassification(
  error: unknown,
  provider: string,
  source: ProviderErrorSource,
): void {
  const { message, normalizedCode, status } = readClassificationSignals(error);

  console.warn('Unclassified voice provider error', {
    provider,
    source,
    status,
    code: normalizedCode,
    message,
    error,
  });
}

function annotateError<
  TSource extends ProviderErrorSource,
  TKind extends VoiceProviderErrorKind,
>(
  error: Error,
  metadata: ProviderErrorMetadata<TSource, TKind>,
): ProviderErrorFor<TSource, TKind> {
  // Intentionally mutate and return the original error instance so upstream code keeps
  // reference identity, stack, and provider SDK details while gaining shared metadata.
  const classifiedError = error as ProviderErrorFor<TSource, TKind>;
  classifiedError.provider = metadata.provider;
  classifiedError.source = metadata.source;
  classifiedError.kind = metadata.kind;

  if (metadata.cause !== undefined && classifiedError.cause === undefined) {
    classifiedError.cause = metadata.cause;
  }

  return classifiedError;
}

function createProviderError<
  TSource extends ProviderErrorSource,
  TKind extends VoiceProviderErrorKind,
>(
  metadata: ProviderErrorMetadata<TSource, TKind> & {
    message: string;
  },
): ProviderErrorFor<TSource, TKind> {
  return annotateError(new Error(metadata.message, { cause: metadata.cause }), {
    provider: metadata.provider,
    source: metadata.source,
    kind: metadata.kind,
    cause: metadata.cause,
  });
}

function classifyProviderError<TSource extends ProviderErrorSource>(
  error: unknown,
  provider: string,
  source: TSource,
): ProviderErrorFor<TSource, VoiceProviderErrorKind> {
  const kind = classifyProviderErrorKind(error);

  if (kind === 'unknown') {
    traceUnknownProviderErrorClassification(error, provider, source);
  }

  const normalizedError =
    error instanceof Error
      ? error
      : new Error(readMessage(error), { cause: error });

  return annotateError(normalizedError, {
    provider,
    source,
    kind,
    cause: normalizedError.cause,
  });
}

export function classifySTTError(error: unknown, provider: string): STTError {
  return classifyProviderError(error, provider, 'stt');
}

export function classifyTTSError(error: unknown, provider: string): TTSError {
  return classifyProviderError(error, provider, 'tts');
}

export function createSTTError(
  provider: string,
  kind: VoiceProviderErrorKind,
  message: string,
  cause?: unknown,
): STTError {
  return createProviderError({
    provider,
    source: 'stt',
    kind,
    message,
    cause,
  });
}

export function createTTSError(
  provider: string,
  kind: VoiceProviderErrorKind,
  message: string,
  cause?: unknown,
): TTSError {
  return createProviderError({
    provider,
    source: 'tts',
    kind,
    message,
    cause,
  });
}
