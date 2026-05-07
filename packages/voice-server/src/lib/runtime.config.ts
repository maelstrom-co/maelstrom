import { createSTT } from './stt/registry.js';
import { createTTS } from './tts/registry.js';
import type {
  ResolvedVoiceSessionConfig,
  STTProvider,
  TTSProvider,
  VoiceSessionConfig,
} from './types.js';

function assertFiniteNonNegativeDuration(
  value: number,
  fieldName: 'vadFinalDebounceMs' | 'audioBufferMaxMs' | 'reconnectDelayMs',
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
  fieldName: string,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Voice session ${fieldName} must be a finite number greater than 0, received ${value}`,
    );
  }

  return value;
}

function assertNonNegativeInteger(value: number, fieldName: string): number {
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
    audioBufferMaxMs: number;
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
  },
): ResolvedVoiceSessionConfig {
  const resolvedVadFinalDebounceMs =
    config.vadFinalDebounceMs ?? defaults.vadFinalDebounceMs;
  const resolvedAudioBufferMaxMs =
    config.audioBufferMaxMs ?? defaults.audioBufferMaxMs;
  const resolvedMaxReconnectAttempts =
    config.maxReconnectAttempts ?? defaults.maxReconnectAttempts;
  const resolvedReconnectDelayMs =
    config.reconnectDelayMs ?? defaults.reconnectDelayMs;

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
    audioBufferMaxMs: assertFinitePositiveDuration(
      resolvedAudioBufferMaxMs,
      'audioBufferMaxMs',
    ),
    maxReconnectAttempts: assertNonNegativeInteger(
      resolvedMaxReconnectAttempts,
      'maxReconnectAttempts',
    ),
    reconnectDelayMs: assertFiniteNonNegativeDuration(
      resolvedReconnectDelayMs,
      'reconnectDelayMs',
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
