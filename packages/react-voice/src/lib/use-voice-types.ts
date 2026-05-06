import type { VADConfig, VoiceSessionState } from '@maelstrom-co/voice';

/**
 * High-level voice session state, re-exported from `@maelstrom-co/voice`
 * so consumers don't have to know which package owns the union. The
 * upstream JSDoc covers the meaning of each variant — in particular the
 * counterintuitive `'silence'` label, which means the user is speaking.
 */
export type { VoiceSessionState };

interface BaseUseVoiceOptions {
  /** BCP-47 language tag forwarded to `VoiceSessionConfig.language` (default: `'en'`). */
  language?: string;

  /**
   * Voice Activity Detection tuning, forwarded to
   * `VoiceSessionConfig.vadOptions`. Merged on top of the react-voice
   * default of `{ activationThreshold: 0.5 }` — passing partial overrides
   * here only changes the fields you specify.
   *
   * See `@maelstrom-co/voice`'s `VADConfig` for the full field list.
   */
  vadOptions?: Partial<VADConfig>;

  /**
   * When `true` (the default) interim transcripts are committed once VAD
   * detects end-of-speech. When `false` interims remain in flight until
   * the STT layer marks the chunk final.
   */
  useVadToFinalizeInterims?: boolean;

  /**
   * Fired for each transcript chunk. `isFinal` is `true` for committed
   * chunks and `false` for interim updates that may still change.
   */
  onTranscript?: (text: string, isFinal: boolean) => void;

  /** Fired with normalized microphone amplitude in `[0, 1]` for visualisations. */
  onAudioLevel?: (level: number) => void;

  /**
   * Invoked for any unhandled session error. Defaults to `console.error`
   * if not provided — supply a handler to surface errors in the UI.
   */
  onError?: (error: unknown) => void;

  /** Fired whenever the high-level voice state transitions. */
  onStateChange?: (state: VoiceSessionState) => void;

  /** Fired when the assistant returns a response for the most recent intent. */
  onResponse?: (response: { userMessage?: string; requestId: string }) => void;

  /**
   * Fired the moment VAD decides the user has started talking. Receives the
   * earliest interim transcript captured so far (may be empty).
   */
  onSpeechStarted?: (text: string) => void;

  /**
   * When `true` (the default) the user can interrupt the assistant by
   * speaking. When `false` user audio is ignored while the assistant is
   * speaking.
   */
  allowBargeIn?: boolean;
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

/**
 * Return shape of `useVoice()`. The state fields reflect the shared session
 * (so observers and the owner read the same values), and the action methods
 * are no-ops when there is no live session — never throwing.
 */
export interface UseVoiceReturn {
  /** Current high-level state. See `VoiceSessionState` for variant meanings. */
  state: VoiceSessionState;

  /** `true` after the underlying session has finished bootstrapping. */
  isReady: boolean;

  /**
   * `true` when the active connector advertises the `voice` capability and
   * `@maelstrom-co/voice` loaded successfully. Flips to `false` when the
   * voice package is missing or fails to expose `VoiceSession`.
   */
  isVoiceSupported: boolean;

  /**
   * `true` when the underlying session is waiting for a user gesture before
   * it can acquire the microphone or unlock playback. Apps using
   * `autoAcquireMic: true` should render an explicit affordance (button,
   * dialog) so the user's click can satisfy the browser activation rule —
   * `start()` invoked from that handler will resolve the gate.
   */
  needsUserGesture: boolean;

  /**
   * Begin (or resume) capturing user audio. Triggers mic acquisition if
   * `autoAcquireMic: false` was used and the gesture-deferred bootstrap
   * has not yet run.
   *
   * Returns a `Promise<void>` that resolves once the audio pipeline is live
   * and the connector is in `listening`. Rejections are forwarded to the
   * `onError` option (or `console.error`); the returned promise itself
   * never rejects, so call sites can stay one-liner safe (`void start()`)
   * while still being able to `.then()` for UI feedback.
   */
  start: () => Promise<void>;

  /** Stop capturing user audio. Safe to call when not listening. */
  stop: () => void;

  /**
   * Cut off the assistant mid-utterance. Useful when the user starts
   * speaking and `allowBargeIn` is disabled, or to clear a stuck response.
   */
  interrupt: () => void;

  /**
   * Eagerly request microphone permission and warm the audio pipeline
   * without starting a transcript stream. Useful inside a user gesture
   * to avoid the permission prompt firing later under poor conditions.
   */
  prepareAudio: () => void;
}
