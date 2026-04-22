export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'silence'
  | 'speaking'
  | 'error';

interface BaseUseVoiceOptions {
  language?: string;
  /**
   * VAD (Voice Activity Detection) configuration. Common fields:
   * - activationThreshold?: number (0-1, default 0.7)
   * - minSpeechDurationSeconds?: number (default 0.05)
   * - minSilenceDurationSeconds?: number (default 0.8)
   */
  vadOptions?: Record<string, unknown>;
  useVadToFinalizeInterims?: boolean;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: unknown) => void;
  onStateChange?: (state: VoiceSessionState) => void;
  onResponse?: (response: { userMessage?: string; requestId: string }) => void;
  onSpeechStarted?: (text: string) => void;
}

/**
 * Options for creating a voice session. Passing options to `useVoice()` makes
 * the caller the session owner — responsible for configuration and lifecycle.
 * Calling `useVoice()` without options creates an observer that shares the
 * owner's session state. An empty object `{}` is treated as no options (observer).
 *
 * `autoAcquireMic` is required so callers consciously choose between
 * eager bootstrap (`true` — only safe when the hook itself renders inside a
 * user gesture) and gesture-deferred bootstrap (`false` — the safe default
 * for sessions constructed at app boot). The discriminated union forbids
 * `greeting` when `autoAcquireMic: false` because there is no defined moment
 * to send it.
 *
 * Forwarded to `VoiceSessionConfig.autoAcquireMic` / `greeting` — see there
 * for full semantics.
 */
export type UseVoiceOptions = BaseUseVoiceOptions &
  (
    | { autoAcquireMic: true; greeting?: string }
    | { autoAcquireMic: false; greeting?: never }
  );

export interface UseVoiceReturn {
  state: VoiceSessionState;
  isReady: boolean;
  isVoiceSupported: boolean;
  start: () => void;
  stop: () => void;
  interrupt: () => void;
  prepareAudio: () => void;
}
