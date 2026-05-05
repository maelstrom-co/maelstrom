import type { STTError, TTSError, VoiceProviderErrorKind } from './types.js';

type ProviderErrorSource = 'stt' | 'tts';

interface ProviderErrorMetadata<TSource extends ProviderErrorSource> {
  provider: string;
  source: TSource;
  kind: VoiceProviderErrorKind;
  cause?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) {
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

function classifyProviderErrorKind(error: unknown): VoiceProviderErrorKind {
  const message = readMessage(error).trim().toLowerCase();
  const code = readCode(error);
  const normalizedCode =
    typeof code === 'string' ? code.trim().toLowerCase() : code;
  const status = readStatus(error);

  if (isExplicitAuthStatusOrCode(status, normalizedCode)) {
    return 'auth';
  }

  if (isExplicitQuotaStatusOrCode(status, normalizedCode)) {
    return 'quota';
  }

  if (
    normalizedCode === GRPC_STATUS_UNAVAILABLE ||
    normalizedCode === 'unavailable' ||
    includesAny(message, transportIndicators)
  ) {
    return 'transport';
  }

  if (includesAny(message, quotaMessageIndicators)) {
    return 'quota';
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

  if (includesAny(message, authMessageIndicators)) {
    return 'auth';
  }

  return 'unknown';
}

function annotateError<TSource extends ProviderErrorSource>(
  error: Error,
  metadata: ProviderErrorMetadata<TSource>,
): Error & ProviderErrorMetadata<TSource> {
  const classifiedError = error as Error & ProviderErrorMetadata<TSource>;
  classifiedError.provider = metadata.provider;
  classifiedError.source = metadata.source;
  classifiedError.kind = metadata.kind;

  if (metadata.cause !== undefined && classifiedError.cause === undefined) {
    classifiedError.cause = metadata.cause;
  }

  return classifiedError;
}

function createProviderError<TSource extends ProviderErrorSource>(
  metadata: Omit<ProviderErrorMetadata<TSource>, 'kind'> & {
    kind?: VoiceProviderErrorKind;
    message: string;
  },
): Error & ProviderErrorMetadata<TSource> {
  return annotateError(new Error(metadata.message, { cause: metadata.cause }), {
    provider: metadata.provider,
    source: metadata.source,
    kind:
      metadata.kind ??
      classifyProviderErrorKind(metadata.cause ?? metadata.message),
    cause: metadata.cause,
  });
}

export function classifySTTError(error: unknown, provider: string): STTError {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(readMessage(error), { cause: error });

  return annotateError(normalizedError, {
    provider,
    source: 'stt',
    kind: classifyProviderErrorKind(error),
    cause: normalizedError.cause,
  }) as STTError;
}

export function classifyTTSError(error: unknown, provider: string): TTSError {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(readMessage(error), { cause: error });

  return annotateError(normalizedError, {
    provider,
    source: 'tts',
    kind: classifyProviderErrorKind(error),
    cause: normalizedError.cause,
  }) as TTSError;
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
  }) as STTError;
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
  }) as TTSError;
}
