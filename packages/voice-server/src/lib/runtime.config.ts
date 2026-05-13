import { createSTT } from './stt/registry.js';
import { createTTS } from './tts/registry.js';
import type {
  ResolvedVoiceSessionConfig,
  STTProvider,
  TTSProvider,
  VoiceSessionConfig,
} from './types.js';

type NumericConfigFieldName = {
  [K in keyof ResolvedVoiceSessionConfig]: ResolvedVoiceSessionConfig[K] extends number
    ? K
    : never;
}[keyof ResolvedVoiceSessionConfig];

function assertFiniteNonNegativeDuration(
  value: number,
  fieldName: NumericConfigFieldName,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Voice session ${fieldName} must be a finite number greater than or equal to 0, received ${value}`,
    );
  }

  return value;
}

function assertFinitePositiveDuration(
  value: number,
  fieldName: NumericConfigFieldName,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Voice session ${fieldName} must be a finite number greater than 0, received ${value}`,
    );
  }

  return value;
}

function assertFiniteMinimumUnitless(
  value: number,
  fieldName: string,
  minimum: number,
): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(
      `Voice session ${fieldName} must be a finite number greater than or equal to ${minimum}, received ${value}`,
    );
  }

  return value;
}

function assertNonNegativeInteger(
  value: number,
  fieldName: NumericConfigFieldName,
): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Voice session ${fieldName} must be a non-negative integer, received ${value}`,
    );
  }

  return value;
}

/**
 * Resolves a public session config into the runtime's internal, non-optional shape.
 *
 * @remarks
 * The runtime intentionally derives `interimResults` from the STT provider when the caller does not
 * override it. That keeps provider capability and runtime forwarding policy aligned by default while
 * still letting advanced adapters silence interim callbacks without changing providers.
 */
export function resolveVoiceSessionConfig(
  config: VoiceSessionConfig,
  defaults: {
    vadFinalDebounceMs: number;
    transcriptGraceMs: number;
    audioBufferMaxMs: number;
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
    maxReconnectDelayMs: number;
    reconnectBackoffMultiplier: number;
    reconnectJitterMs: number;
    circuitBreakerTimeoutMs: number;
  },
): ResolvedVoiceSessionConfig {
  const resolvedVadFinalDebounceMs =
    config.vadFinalDebounceMs ?? defaults.vadFinalDebounceMs;
  const resolvedTranscriptGraceMs =
    config.transcriptGraceMs ?? defaults.transcriptGraceMs;
  const resolvedAudioBufferMaxMs =
    config.audioBufferMaxMs ?? defaults.audioBufferMaxMs;
  const resolvedMaxReconnectAttempts =
    config.maxReconnectAttempts ?? defaults.maxReconnectAttempts;
  const resolvedReconnectDelayMs =
    config.reconnectDelayMs ?? defaults.reconnectDelayMs;
  const resolvedMaxReconnectDelayMs =
    config.maxReconnectDelayMs ?? defaults.maxReconnectDelayMs;
  const resolvedReconnectBackoffMultiplier =
    config.reconnectBackoffMultiplier ?? defaults.reconnectBackoffMultiplier;
  const resolvedReconnectJitterMs =
    config.reconnectJitterMs ?? defaults.reconnectJitterMs;
  const resolvedCircuitBreakerTimeoutMs =
    config.circuitBreakerTimeoutMs ?? defaults.circuitBreakerTimeoutMs;
  const validatedReconnectDelayMs = assertFiniteNonNegativeDuration(
    resolvedReconnectDelayMs,
    'reconnectDelayMs',
  );
  const validatedMaxReconnectDelayMs = assertFinitePositiveDuration(
    resolvedMaxReconnectDelayMs,
    'maxReconnectDelayMs',
  );

  if (validatedMaxReconnectDelayMs < validatedReconnectDelayMs) {
    throw new Error(
      `Voice session maxReconnectDelayMs must be greater than or equal to reconnectDelayMs, received maxReconnectDelayMs=${validatedMaxReconnectDelayMs} and reconnectDelayMs=${validatedReconnectDelayMs}`,
    );
  }

  let stt: STTProvider;
  try {
    stt = createSTT(config.stt);
  } catch (error) {
    throw new Error('Failed to construct STT provider for voice session', {
      cause: error,
    });
  }

  let tts: TTSProvider;
  try {
    tts = createTTS(config.tts);
  } catch (error) {
    throw new Error('Failed to construct TTS provider for voice session', {
      cause: error,
    });
  }

  return {
    stt,
    tts,
    sessionId: config.sessionId,
    language: config.language,
    interimResults:
      config.interimResults ?? stt.capabilities.interimTranscripts,
    autoRestartListening: config.autoRestartListening ?? true,
    vadFinalDebounceMs: assertFiniteNonNegativeDuration(
      resolvedVadFinalDebounceMs,
      'vadFinalDebounceMs',
    ),
    transcriptGraceMs: assertFiniteNonNegativeDuration(
      resolvedTranscriptGraceMs,
      'transcriptGraceMs',
    ),
    audioBufferMaxMs: assertFinitePositiveDuration(
      resolvedAudioBufferMaxMs,
      'audioBufferMaxMs',
    ),
    maxReconnectAttempts: assertNonNegativeInteger(
      resolvedMaxReconnectAttempts,
      'maxReconnectAttempts',
    ),
    reconnectDelayMs: validatedReconnectDelayMs,
    maxReconnectDelayMs: validatedMaxReconnectDelayMs,
    reconnectBackoffMultiplier: assertFiniteMinimumUnitless(
      resolvedReconnectBackoffMultiplier,
      'reconnectBackoffMultiplier',
      1,
    ),
    reconnectJitterMs: assertFiniteNonNegativeDuration(
      resolvedReconnectJitterMs,
      'reconnectJitterMs',
    ),
    circuitBreakerTimeoutMs: assertFinitePositiveDuration(
      resolvedCircuitBreakerTimeoutMs,
      'circuitBreakerTimeoutMs',
    ),
    trace: config.trace,
    intentBoundary:
      config.buildChartRequest && config.processIntent
        ? {
            buildChartRequest: config.buildChartRequest,
            processIntent: config.processIntent,
          }
        : null,
  };
}

/**
 * @deprecated Use `resolveVoiceSessionConfig` instead.
 *
 * This value alias exists so older imports keep compiling while consumers move to the
 * `VoiceSession*` API names.
 */
export const resolveVoiceProvisionConfig = resolveVoiceSessionConfig;
