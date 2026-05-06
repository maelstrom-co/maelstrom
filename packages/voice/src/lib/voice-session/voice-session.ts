/**
 * Framework-agnostic voice session orchestrator for real-time voice conversations.
 *
 * Coordinates microphone capture, Voice Activity Detection (VAD), server
 * communication, and TTS playback into a unified state machine. This class is
 * the single source of truth for voice interaction state, designed to be
 * consumed by thin framework adapters (React hooks, Vue composables, etc.).
 *
 * ## API
 *
 * Config-only constructor — no callbacks. Subscribe to events via typed `on()`:
 *
 * ```ts
 * const session = new VoiceSession({
 *   connector,
 *   vadOptions: { activationThreshold: 0.8 },
 * });
 *
 * session.on('transcript', (text, isFinal) => console.log(text));
 * session.on('stateChange', (state) => updateUI(state));
 * session.on('event', (ev) => console.log(ev)); // catchall
 *
 * await session.prepareAudio();
 * await session.startListening();
 * ```
 */
import {
  MessageId,
  type VoiceServerMessage,
} from '@maelstrom-co/protocol';
import { VoiceError } from '@maelstrom-co/protocol-old';

import { AudioCapture } from '../audio-capture/index.js';
import { AudioPlayback } from '../audio-playback/index.js';
import type { VoiceConnector } from '../types.js';
import type { VADStreamOptions } from '../vad/vad-processor.js';
import { VADProcessor } from '../vad/vad-processor.js';
import type { VoiceEvent, VoiceEventMap } from './events.js';

/**
 * Simplified state representation for UI consumers.
 *
 * These five states cover all meaningful UI variations. Internal state
 * (isInitializing, isPreparingAudio) is hidden because UI doesn't need
 * to distinguish between "preparing" and "not yet started".
 *
 * - `idle`: session is connected but not actively listening.
 * - `listening`: actively capturing audio, no speech detected yet.
 * - `silence`: VAD has detected speech and is awaiting more input.
 *   Counterintuitive name — the user *is* speaking; the label refers to
 *   the brief pauses VAD swallows between phrases. Treat it as "user
 *   talking" in the UI, not "no audio".
 * - `speaking`: the assistant is producing audio output.
 * - `error`: session entered an unrecoverable state.
 */
export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'silence'
  | 'speaking'
  | 'error';

interface BaseVoiceSessionConfig {
  /**
   * Abstraction over the transport layer (WebSocket, HTTP, mock).
   */
  connector: VoiceConnector;

  /**
   * BCP-47 language code for speech recognition (default: 'en').
   */
  language?: string;

  /**
   * Enable interim (partial) transcription results (default: true).
   */
  interimResults?: boolean;

  /** Correlation ID for server-side session tracking. */
  sessionId?: string;

  /**
   * Configuration for the VAD stream processing.
   */
  vadOptions: VADStreamOptions;

  /**
   * When true, use VAD speech-end events to finalize lingering interim
   * transcripts after a silence timeout (default: true).
   */
  useVadToFinalizeInterims?: boolean;

  /** Enable verbose console logging for debugging. */
  debugMode?: boolean;

  /**
   * Whether local VAD speech-start may interrupt assistant playback.
   *
   * Defaults to `true` so existing conversational sessions keep barge-in.
   * Set to `false` for strict half-duplex turn-taking where assistant playback
   * must finish before a new user turn is accepted.
   */
  allowBargeIn?: boolean;
}

/**
 * Configuration for a `VoiceSession`.
 *
 * `autoAcquireMic` is a discriminated tag controlling lifecycle bootstrap on
 * server readiness:
 *
 * - `true` — the session prompts for mic permission and (if `greeting` is
 *   set) sends the greeting as soon as the server signals readiness. Suitable
 *   for contexts where a prior user gesture has already authorised the page
 *   to acquire the mic (e.g. an explicit "Start" button rendered the session).
 * - `false` — both mic acquisition and any greeting are deferred until the
 *   consumer calls `session.startListening()` / `session.prepareAudio()` from
 *   a user gesture. Browsers require a gesture for `getUserMedia()`, so this
 *   is the safe default for sessions constructed at app boot. `greeting` is
 *   disallowed in this branch because there is no defined moment to send it.
 *
 * The discriminated union enforces the `greeting` ↔ `autoAcquireMic`
 * coupling at compile time so a misconfigured session cannot reach runtime.
 */
export type VoiceSessionConfig = BaseVoiceSessionConfig &
  (
    | {
        autoAcquireMic: true;
        /** Text to speak when server connection is ready. */
        greeting?: string;
      }
    | {
        autoAcquireMic: false;
        greeting?: never;
      }
  );

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Silero VAD requires exactly 512 samples per inference call (32ms @ 16kHz).
 * AudioCapture emits 4096-sample chunks (256ms), so we slice into 8 windows.
 */
const VAD_WINDOW_SIZE = 512;

/**
 * 16 kHz — standard sample rate for speech recognition APIs.
 */
const INPUT_SAMPLE_RATE = 16000;

/**
 * 44.1 kHz — CD-quality output, universally supported across browsers.
 */
const OUTPUT_SAMPLE_RATE = 44100;

const DEFAULT_MAX_USER_TALKING_MS = 60000;
const DEFAULT_STT_FINALIZE_TIMEOUT_MS = 800;

// ── VoiceSession ────────────────────────────────────────────────────────────

export class VoiceSession {
  #config: VoiceSessionConfig;
  #state: VoiceSessionInnerState;

  #unsubscribeVoice: (() => void) | null = null;
  #unsubscribeBinary: (() => void) | null = null;
  #unsubscribePlaybackStart: (() => void) | null = null;
  #unsubscribePlaybackEnd: (() => void) | null = null;

  // Intentionally never reset. The server session survives client reconnects,
  // so a greeting sent once is already in the server's conversation history —
  // re-sending on `engine.stt.ready` after reconnect would duplicate it.
  #greetingSent = false;

  #listeners = new Map<keyof VoiceEventMap, Set<(...args: never[]) => void>>();

  /** Buffer for incomplete VAD windows between audio capture callbacks. */
  #pendingVadBuffer: Float32Array = new Float32Array(0);

  /** Queue of VAD windows awaiting processing (prevents concurrent ONNX inference). */
  #vadQueue: Float32Array[] = [];

  /** True while VAD inference is in progress (mutex for ONNX session). */
  #vadProcessing = false;

  #userTalkingTimeout: ReturnType<typeof setTimeout> | null = null;
  #interimFinalizeTimeout: ReturnType<typeof setTimeout> | null = null;
  #sttFinalizeTimeoutMs: number;
  #maxUserTalkingMs: number;
  #useVadToFinalizeInterims: boolean;
  #turnCounter = 0;
  #currentTurnId = 0;
  #finalizedTurn: { turnId: number; normalizedText: string } | null = null;

  // Set when `engine.stt.ready` arrives before any user activation has
  // occurred, in `autoAcquireMic: true` mode. We can't call prepareAudio()
  // yet because browsers require a gesture for getUserMedia/AudioContext.
  //
  // Intentionally sticky across failed retries: a rejected gesture-driven
  // prepareAudio() (e.g. mic permission denied) leaves both this flag and
  // `#pendingAfterPrepare` set so the consumer-rendered affordance stays
  // visible and a subsequent click can retry. Cleared only on a successful
  // prepareAudio() (success path drains the continuation in tandem) or on
  // a fresh `engine.stt.ready` that re-evaluates the gesture state.
  #needsUserGesture = false;
  // Continuation deferred from `#handleServerReady` until the first
  // successful prepareAudio(). Today this only re-triggers the greeting
  // send. Survives rejected retries by design (see #needsUserGesture above).
  #pendingAfterPrepare: (() => void) | null = null;

  constructor(config: VoiceSessionConfig) {
    this.#config = config;
    this.#useVadToFinalizeInterims = config.useVadToFinalizeInterims ?? true;
    this.#maxUserTalkingMs = Math.max(
      0,
      config.vadOptions?.maxUserTalkingDurationSeconds !== undefined
        ? Math.round(config.vadOptions.maxUserTalkingDurationSeconds * 1000)
        : DEFAULT_MAX_USER_TALKING_MS,
    );
    this.#sttFinalizeTimeoutMs = Math.max(
      0,
      config.vadOptions?.minSilenceDurationSeconds !== undefined
        ? Math.round(config.vadOptions.minSilenceDurationSeconds * 1000)
        : DEFAULT_STT_FINALIZE_TIMEOUT_MS,
    );

    const capture = new AudioCapture({
      sampleRate: INPUT_SAMPLE_RATE,
      debugMode: config.debugMode ?? false,
    });

    capture.on('error', (err) => {
      // Start-time errors are classified and surfaced by prepareAudio's
      // isReady check. Skip here to avoid double-emission; handle only
      // post-start mic failures (e.g. track ended, device unplugged).
      if (this.#state.isPreparingAudio) return;
      this.#setError(
        err instanceof VoiceError
          ? err
          : new VoiceError('UNKNOWN', err.message, err),
      );
    });

    const playback = new AudioPlayback({
      sampleRate: OUTPUT_SAMPLE_RATE,
      debugMode: config.debugMode ?? false,
    });

    playback.on('error', (err) => {
      this.#setError(
        err instanceof VoiceError
          ? err
          : new VoiceError('UNKNOWN', err.message, err),
      );
    });

    const vad = new VADProcessor({
      streamOptions: config.vadOptions,
      onSpeechStart: (event, bufferedAudio) => {
        this.#handleVadSpeechStart(event, bufferedAudio);
      },
      onSpeechEnd: (event, durationMs) => {
        this.#handleVadSpeechEnd(event, durationMs);
      },
      onSpeechProbability: (prob) => {
        this.#state.userAudioLevel = prob;
        this.#emit('audioLevel', prob);
      },
      onError: (err) => {
        console.error('[VoiceSession] VAD error:', err);
        this.#setError(
          err instanceof VoiceError
            ? err
            : new VoiceError('UNKNOWN', err.message, err),
        );
      },
      onStateChange: () => {},
    });

    this.#state = {
      isListening: false,
      isSpeaking: false,
      transcript: '',
      error: null,
      isAudioPipelineReady: false,
      userAudioLevel: 0,
      currentAudioCancellable: true,
      suppressIncomingAssistantAudio: false,
      userIsTalking: false,
      isInitializing: false,
      hasUserInitiatedListening: false,
      isPreparingAudio: false,
      prepareAudioPromise: null,
      capture,
      playback,
      vad,
    };

    this.#initialize();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Subscribe to session events. Returns an unsubscribe function.
   *
   * When `event` is `'event'`, the callback receives a discriminated union
   * `VoiceEvent` containing ALL events — useful for logging and devtools.
   */
  on<K extends keyof VoiceEventMap>(
    event: K,
    cb: VoiceEventMap[K],
  ): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(cb as (...args: never[]) => void);
    return () => {
      set.delete(cb as (...args: never[]) => void);
    };
  }

  /**
   * Initialize audio pipeline (mic access + VAD model loading).
   *
   * Promise is deduplicated: multiple concurrent callers share the same
   * initialization. Safe to call from both server-ready handler and user click.
   */
  async prepareAudio(): Promise<void> {
    if (this.#state.isAudioPipelineReady && this.#state.capture.isReady) {
      return;
    }

    if (this.#state.isPreparingAudio && this.#state.prepareAudioPromise) {
      return this.#state.prepareAudioPromise;
    }

    this.#state.isPreparingAudio = true;

    const doSetup = async () => {
      try {
        this.#state.error = null;

        // Prime playback from the same gesture path that unlocks microphone
        // capture. Binary TTS arrives later from async socket callbacks, and
        // waiting until then to create/resume the AudioContext is what leaves
        // browsers with a silent playback path.
        await this.#state.playback.prepare();

        // Load the VAD model before starting capture so that audio chunks
        // emitted by the AudioWorklet immediately after capture.start() don't
        // race against an unloaded ONNX session.
        await this.#state.vad.load();

        await this.#state.capture.start();

        // AudioCapture.start() doesn't throw on error - it emits 'error' event.
        // Check isReady to detect failures like microphone permission denied.
        if (!this.#state.capture.isReady) {
          throw new DOMException('Microphone access denied', 'NotAllowedError');
        }

        this.#state.isAudioPipelineReady = true;

        // The pipeline is live, so a prior gesture must have unlocked the
        // browser audio APIs. Clear the deferred flag and run any continuation
        // (e.g. the greeting that #handleServerReady stashed for after gesture).
        this.#clearNeedsUserGesture();
        const continuation = this.#pendingAfterPrepare;
        this.#pendingAfterPrepare = null;
        continuation?.();

        if (this.#config.debugMode) {
          console.log('[VoiceSession] Audio pipeline ready');
        }
      } catch (err) {
        const voiceError =
          err instanceof VoiceError
            ? err
            : new VoiceError(
                err instanceof DOMException && err.name === 'NotAllowedError'
                  ? 'MICROPHONE_DENIED'
                  : 'UNKNOWN',
                err instanceof Error ? err.message : String(err),
                err,
              );
        this.#setError(voiceError);

        if (this.#config.debugMode) {
          console.error('[VoiceSession] Error preparing audio:', err);
        }
        // Rethrow so caller .catch()/await chains observe the failure.
        // Without this, .then() chains would run as if setup succeeded.
        throw voiceError;
      } finally {
        this.#state.isPreparingAudio = false;
        this.#state.prepareAudioPromise = null;
      }
    };

    this.#state.prepareAudioPromise = doSetup();
    return this.#state.prepareAudioPromise;
  }

  /**
   * Begin voice capture and server streaming.
   *
   * If `prepareAudio()` was not called, it is called automatically.
   */
  async startListening(): Promise<void> {
    if (this.#state.isListening) {
      return;
    }

    try {
      this.#state.error = null;
      this.#state.isInitializing = true;
      this.#state.hasUserInitiatedListening = true;

      if (!this.#state.isAudioPipelineReady || !this.#state.capture.isReady) {
        await this.prepareAudio();
      }

      if (!this.#state.capture.isReady) {
        throw new VoiceError('UNKNOWN', 'Audio pipeline not ready');
      }

      this.#state.isListening = true;
      this.#state.isInitializing = false;
      this.#emitStateChange();

      this.#config.connector.startListening(
        this.#config.language ?? 'en',
        this.#config.interimResults ?? true,
      );

      if (this.#config.debugMode) {
        console.log('[VoiceSession] Started listening');
      }
    } catch (err) {
      const voiceError =
        err instanceof VoiceError
          ? err
          : new VoiceError(
              err instanceof DOMException && err.name === 'NotAllowedError'
                ? 'MICROPHONE_DENIED'
                : 'UNKNOWN',
              err instanceof Error ? err.message : String(err),
              err,
            );
      this.#setError(voiceError);
      this.#state.isInitializing = false;

      if (this.#config.debugMode) {
        console.error('[VoiceSession] Error starting listening:', err);
      }
    }
  }

  /**
   * Stop listening for user speech and tear down the capture pipeline.
   */
  stopListening(): void {
    // Always reset the intent flag so a late playbackEnd can't revive the
    // listening state — even when called while isListening is already false
    // (e.g. during TTS playback).
    this.#state.hasUserInitiatedListening = false;

    if (!this.#state.isListening) {
      return;
    }

    this.#state.capture.stop();
    this.#config.connector.stopListening();

    this.#state.isListening = false;
    this.#state.userIsTalking = false;
    this.#clearUserTalkingTimeout();
    this.#clearInterimFinalizeTimeout();
    this.#state.transcript = '';
    this.#currentTurnId = 0;
    this.#finalizedTurn = null;
    this.#emitStateChange();

    if (this.#config.debugMode) {
      console.log('[VoiceSession] Stopped listening');
    }
  }

  /**
   * Immediately stop AI audio playback (UI-initiated barge-in).
   */
  interrupt(): void {
    this.#suppressIncomingAssistantAudio('manual interrupt');
    this.#state.playback.interrupt();
    this.#state.isSpeaking = false;
    this.#emitStateChange();

    if (this.#config.debugMode) {
      console.log('[VoiceSession] Interrupted');
    }
  }

  /**
   * Release all resources: subscriptions, audio modules, VAD, event listeners.
   */
  destroy(): void {
    this.#unsubscribeVoice?.();
    this.#unsubscribeBinary?.();
    this.#unsubscribePlaybackStart?.();
    this.#unsubscribePlaybackEnd?.();
    this.#clearUserTalkingTimeout();
    this.#clearInterimFinalizeTimeout();
    this.#currentTurnId = 0;
    this.#finalizedTurn = null;
    this.#state.hasUserInitiatedListening = false;

    this.#state.capture.destroy();
    this.#state.playback.destroy();
    this.#state.vad.dispose();

    this.#listeners.clear();

    if (this.#config.debugMode) {
      console.log('[VoiceSession] Destroyed');
    }
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  get voiceState(): VoiceSessionState {
    return this.#computeState();
  }

  get isListening(): boolean {
    return this.#state.isListening;
  }

  get isSpeaking(): boolean {
    return this.#state.isSpeaking;
  }

  get transcript(): string {
    return this.#state.transcript;
  }

  get audioLevel(): number {
    return this.#state.userAudioLevel;
  }

  get isAudioReady(): boolean {
    return this.#state.isAudioPipelineReady;
  }

  get error(): VoiceError | null {
    return this.#state.error;
  }

  /**
   * True when the session is waiting for a user gesture before it can
   * acquire the microphone or unlock playback. Consumers should render an
   * affordance (button, dialog) whose click invokes `startListening()` or
   * `prepareAudio()` to satisfy the browser activation requirement.
   */
  get needsUserGesture(): boolean {
    return this.#needsUserGesture;
  }

  // ── Initialization wiring ───────────────────────────────────────────────

  #initialize(): void {
    this.#wireConnector();
    this.#wireCapture();
    this.#wirePlayback();
  }

  #wireConnector(): void {
    this.#unsubscribeVoice = this.#config.connector.onVoiceMessage(
      (message) => {
        switch (message.type) {
          case 'engine.stt.transcript':
            this.#handleTranscript(message);
            break;
          case 'engine.stt.ready':
            this.#handleServerReady(message);
            break;
          case 'engine.voice.state':
            this.#handleVoiceState(message);
            break;
          case 'engine.tts.sent':
            this.#state.playback.interrupt();
            this.#allowIncomingAssistantAudio(
              'server announced a new TTS turn',
            );
            if (message.text) {
              this.#emit('speechStarted', message.text);
            }
            break;
          case 'engine.error':
            this.#handleVoiceError(message);
            break;
          case 'engine.maelstrom.response':
            this.#handleMaelstromResponse(message);
            break;
        }
      },
    );
  }

  /**
   * Wire audio capture to VAD and conditional server streaming.
   *
   * VAD needs continuous audio to detect speech onset; the gating only
   * affects what we *send* to the server, not what VAD *sees*.
   */
  #wireCapture(): void {
    this.#state.capture.on(
      'audio',
      (pcm16: Uint8Array, float32: Float32Array) => {
        this.#processVadChunked(float32);
        if (this.#state.userIsTalking) {
          try {
            this.#config.connector.sendAudioChunk({
              data: pcm16,
              sampleRate: INPUT_SAMPLE_RATE,
              encoding: 'linear16',
              isFinal: false,
            });
          } catch (err) {
            this.#setError(
              err instanceof VoiceError
                ? err
                : new VoiceError(
                    'UNKNOWN',
                    err instanceof Error ? err.message : String(err),
                    err,
                  ),
            );
          }
        }
      },
    );
  }

  /**
   * Wire playback events to state and VAD threshold adjustments.
   *
   * During playback, the VAD threshold is raised to avoid false speech
   * detection from the assistant's own voice (AEC mitigation).
   */
  #wirePlayback(): void {
    this.#unsubscribeBinary = this.#config.connector.onBinaryAudio(
      (data, meta) => {
        if (this.#state.suppressIncomingAssistantAudio) {
          if (this.#config.debugMode) {
            console.log(
              '[VoiceSession] Dropping stale assistant audio after interrupt',
            );
          }
          return;
        }

        this.#state.currentAudioCancellable = meta.cancellable;
        this.#state.playback.enqueue(data);
        this.#emit('audioOutput', data);
      },
    );

    this.#state.playback.on('playbackStart', () => {
      this.#state.isSpeaking = true;
      this.#state.isListening = false;
      this.#state.vad.setPlaybackMode(true);
      this.#emitStateChange();
    });

    this.#state.playback.on('playbackEnd', () => {
      this.#state.isSpeaking = false;
      this.#state.currentAudioCancellable = true;
      this.#state.vad.setPlaybackMode(false);
      // Only revive listening state if the user intended to listen AND
      // the mic is still live (defends against late playbackEnd arriving
      // after stopListening()/destroy()).
      if (
        this.#state.hasUserInitiatedListening &&
        this.#state.capture.isReady
      ) {
        this.#state.isListening = true;
      }
      this.#emitStateChange();
    });
  }

  // ── VAD processing ──────────────────────────────────────────────────────

  /**
   * Slice audio into 512-sample windows for Silero VAD.
   * AudioCapture emits 4096-sample chunks; VAD requires exactly 512 samples.
   */
  #processVadChunked(chunk: Float32Array): void {
    const combined =
      this.#pendingVadBuffer.length > 0
        ? concatFloat32Arrays(this.#pendingVadBuffer, chunk)
        : chunk;

    let offset = 0;
    while (offset + VAD_WINDOW_SIZE <= combined.length) {
      const window = combined.slice(offset, offset + VAD_WINDOW_SIZE);
      this.#vadQueue.push(window);
      offset += VAD_WINDOW_SIZE;
    }

    this.#pendingVadBuffer =
      offset < combined.length ? combined.slice(offset) : new Float32Array(0);

    this.#drainVadQueue();
  }

  /**
   * Process queued VAD windows sequentially to prevent concurrent ONNX inference.
   * ONNX Runtime sessions are NOT thread-safe; concurrent calls cause "Session mismatch".
   */
  async #drainVadQueue(): Promise<void> {
    if (this.#vadProcessing) return;
    // The model may not be loaded yet (e.g. audio arrives during prepareAudio()
    // before vad.load() resolves). Silently discard queued frames.
    if (!this.#state.vad.ready) {
      this.#vadQueue.length = 0;
      return;
    }
    this.#vadProcessing = true;

    try {
      while (this.#vadQueue.length > 0) {
        const window = this.#vadQueue.shift();
        if (window) {
          await this.#state.vad.process(window);
        }
      }
    } catch (err) {
      console.error('[VoiceSession] VAD queue error:', err);
      this.#setError(
        err instanceof VoiceError
          ? err
          : new VoiceError(
              'UNKNOWN',
              err instanceof Error ? err.message : String(err),
              err,
            ),
      );
    } finally {
      this.#vadProcessing = false;
    }
  }

  // ── VAD event handlers ──────────────────────────────────────────────────

  /**
   * Handle VAD speech start: barge-in, notify server, send buffered audio.
   *
   * Barge-in happens here (not in transcript handlers) because VAD fires
   * locally with ~10ms latency vs 200-500ms for server transcripts.
   */
  #handleVadSpeechStart(event: unknown, bufferedAudio: Uint8Array): void {
    void event;
    if (this.#config.debugMode) {
      console.log('[VoiceSession] VAD speech start');
    }

    if (this.#shouldIgnoreSpeechStartDuringPlayback()) {
      return;
    }

    this.#turnCounter += 1;
    this.#currentTurnId = this.#turnCounter;
    this.#clearInterimFinalizeTimeout();

    this.#tryBargeIn();

    // Update state before connector calls so the state machine remains
    // consistent even if the connector throws (e.g. WebSocket closed).
    this.#state.userIsTalking = true;
    this.#armUserTalkingTimeout();
    this.#emitStateChange();

    try {
      this.#config.connector.sendVoiceMessage({
        type: 'client.vad.speech_start',
        sessionId: this.#config.sessionId ?? 'unknown',
        timestamp: performance.now(),
      });

      if (bufferedAudio.length > 0) {
        this.#config.connector.sendAudioChunk({
          data: bufferedAudio,
          sampleRate: INPUT_SAMPLE_RATE,
          encoding: 'linear16',
          isFinal: false,
        });

        if (this.#config.debugMode) {
          console.log(
            `[VoiceSession] Sent buffered audio: ${bufferedAudio.length} bytes`,
          );
        }
      }
    } catch (err) {
      // Roll back the speculative state updates (userIsTalking + armed
      // timeout) so the session doesn't stay stuck in "user talking" on a
      // connector failure. Capture callback would otherwise keep streaming
      // PCM into the broken connector and re-throw on every chunk.
      this.#state.userIsTalking = false;
      this.#clearUserTalkingTimeout();
      this.#setError(
        err instanceof VoiceError
          ? err
          : new VoiceError(
              'UNKNOWN',
              err instanceof Error ? err.message : String(err),
              err,
            ),
      );
      this.#emitStateChange();
    }
  }

  #handleVadSpeechEnd(event: unknown, durationMs: number): void {
    void event;
    if (this.#config.debugMode) {
      console.log(`[VoiceSession] VAD speech end, duration: ${durationMs}ms`);
    }

    try {
      this.#config.connector.sendVoiceMessage({
        type: 'client.vad.speech_end',
        sessionId: this.#config.sessionId ?? 'unknown',
        timestamp: performance.now(),
      });
    } catch (err) {
      this.#setError(
        err instanceof VoiceError
          ? err
          : new VoiceError(
              'UNKNOWN',
              err instanceof Error ? err.message : String(err),
              err,
            ),
      );
    }

    this.#state.userIsTalking = false;
    this.#clearUserTalkingTimeout();

    if (this.#state.transcript.trim()) {
      this.#scheduleInterimFinalize();
    }

    this.#emitStateChange();
  }

  // ── Barge-in ────────────────────────────────────────────────────────────

  #shouldIgnoreSpeechStartDuringPlayback(): boolean {
    if (
      (this.#config.allowBargeIn ?? true) ||
      !this.#state.playback.isPlaying
    ) {
      return false;
    }

    if (this.#config.debugMode) {
      console.log(
        '[VoiceSession] Ignoring VAD speech start because assistant playback owns the turn',
      );
    }

    return true;
  }

  /**
   * Attempt to interrupt AI playback when user starts speaking.
   *
   * When `cancellable=false` (e.g., legal disclaimers), barge-in is blocked.
   */
  #tryBargeIn(): void {
    if (!this.#state.currentAudioCancellable) {
      if (this.#config.debugMode) {
        console.log('[VoiceSession] Barge-in blocked - audio not cancellable');
      }
      return;
    }

    if (this.#state.playback.isPlaying) {
      if (this.#config.debugMode) {
        console.log('[VoiceSession] Barge-in triggered');
      }
      this.#suppressIncomingAssistantAudio('barge-in');
      this.#state.playback.interrupt();
      this.#state.isSpeaking = false;
      this.#emitStateChange();
    }
  }

  #suppressIncomingAssistantAudio(reason: string): void {
    this.#state.suppressIncomingAssistantAudio = true;

    if (this.#config.debugMode) {
      console.log(
        `[VoiceSession] Suppressing incoming assistant audio after ${reason}`,
      );
    }
  }

  #allowIncomingAssistantAudio(reason: string): void {
    if (!this.#state.suppressIncomingAssistantAudio) {
      return;
    }

    this.#state.suppressIncomingAssistantAudio = false;

    if (this.#config.debugMode) {
      console.log(
        `[VoiceSession] Accepting assistant audio again after ${reason}`,
      );
    }
  }

  // ── Server message handlers ─────────────────────────────────────────────

  #handleTranscript(message: VoiceServerMessage): void {
    if (message.type !== 'engine.stt.transcript') return;

    if (this.#config.debugMode) {
      console.log(
        `[VoiceSession] Transcript: "${message.text}" isFinal: ${message.isFinal}`,
      );
    }

    if (message.isFinal) {
      this.#clearInterimFinalizeTimeout();

      if (this.#shouldIgnoreDuplicateFinal(message.text)) {
        if (this.#config.debugMode) {
          console.log(
            `[VoiceSession] Ignoring duplicate server final after synthetic final: "${message.text}"`,
          );
        }
        this.#state.transcript = '';
        return;
      }

      this.#state.transcript = '';
      this.#markTurnFinalized(message.text);
    } else {
      this.#ensureCurrentTurn();
      this.#state.transcript = message.text;
      if (!this.#state.userIsTalking) {
        this.#scheduleInterimFinalize();
      }
    }

    this.#emit('transcript', message.text, message.isFinal);
  }

  #handleServerReady(message: VoiceServerMessage): void {
    if (message.type !== 'engine.stt.ready') return;

    if (this.#config.debugMode) {
      console.log('[VoiceSession] Server ready');
    }

    if (!this.#config.autoAcquireMic) {
      // Opt-in mic + greeting. Consumer triggers both from a user gesture.
      return;
    }

    const sessionId = message.sessionId;
    const sendGreetingIfNeeded = () => {
      if (!this.#config.greeting || this.#greetingSent) {
        return;
      }
      this.#greetingSent = true;
      if (this.#config.debugMode) {
        console.log('[VoiceSession] Sending greeting');
      }
      this.#config.connector.sendVoiceMessage({
        type: 'client.voice.speak',
        sessionId,
        timestamp: performance.now(),
        text: this.#config.greeting,
        id: MessageId(),
      });
    };

    // Browsers require a prior user gesture for getUserMedia() and for
    // AudioContext.resume(); calling prepareAudio() before that lands the
    // session in MICROPHONE_DENIED with no obvious recovery affordance.
    // When we can detect the missing gesture, defer mic + greeting until
    // the consumer triggers prepareAudio()/startListening() from a click.
    if (!hasPriorUserActivation()) {
      this.#pendingAfterPrepare = sendGreetingIfNeeded;
      this.#setNeedsUserGesture();
      return;
    }

    this.prepareAudio()
      .then(sendGreetingIfNeeded)
      .catch((err) => {
        // prepareAudio already surfaced the error via #setError. Reset
        // greetingSent so a subsequent retry (e.g. reconnect) re-emits the
        // greeting rather than leaving the server waiting for audio that
        // never arrives.
        this.#greetingSent = false;
        this.#setError(
          err instanceof VoiceError
            ? err
            : new VoiceError(
                'UNKNOWN',
                err instanceof Error ? err.message : String(err),
                err,
              ),
        );
      });
  }

  #handleVoiceState(message: VoiceServerMessage): void {
    if (message.type !== 'engine.voice.state') return;

    if (this.#config.debugMode) {
      console.log(`[VoiceSession] Server voice state: ${message.state}`);
    }

    if (message.state === 'speaking') {
      this.#allowIncomingAssistantAudio('server entered speaking state');
    }
  }

  #handleVoiceError(message: VoiceServerMessage): void {
    if (message.type !== 'engine.error') return;

    const error = new VoiceError('UNKNOWN', message.error);
    this.#setError(error);
  }

  #handleMaelstromResponse(message: VoiceServerMessage): void {
    if (message.type !== 'engine.maelstrom.response') return;

    if (this.#config.debugMode) {
      console.log(
        `[VoiceSession] Maelstrom response: ${message.response?.userMessage}`,
      );
    }

    if (message.response) {
      this.#emit('response', {
        userMessage: message.response.userMessage,
        requestId: message.requestId,
      });
    }
  }

  // ── Transcript finalization ─────────────────────────────────────────────

  #scheduleInterimFinalize(): void {
    if (!this.#useVadToFinalizeInterims) {
      return;
    }

    this.#clearInterimFinalizeTimeout();

    if (this.#sttFinalizeTimeoutMs <= 0) {
      return;
    }

    const candidate = this.#state.transcript.trim();
    if (!candidate) {
      return;
    }

    const turnIdAtSchedule = this.#currentTurnId;

    this.#interimFinalizeTimeout = setTimeout(() => {
      if (turnIdAtSchedule !== this.#currentTurnId) {
        return;
      }

      if (this.#state.userIsTalking) {
        return;
      }

      const text = this.#state.transcript.trim();
      if (!text) {
        return;
      }

      if (this.#config.debugMode) {
        console.log(
          `[VoiceSession] Synthesizing final transcript after ${this.#sttFinalizeTimeoutMs}ms timeout: "${text}"`,
        );
      }

      this.#markTurnFinalized(text);
      this.#state.transcript = '';
      this.#emit('transcript', text, true);
    }, this.#sttFinalizeTimeoutMs);
  }

  #clearInterimFinalizeTimeout(): void {
    if (!this.#interimFinalizeTimeout) {
      return;
    }

    clearTimeout(this.#interimFinalizeTimeout);
    this.#interimFinalizeTimeout = null;
  }

  // ── Turn tracking & duplicate detection ─────────────────────────────────

  #ensureCurrentTurn(): void {
    if (this.#currentTurnId > 0) {
      return;
    }

    this.#turnCounter += 1;
    this.#currentTurnId = this.#turnCounter;
  }

  #markTurnFinalized(text: string): void {
    this.#ensureCurrentTurn();
    this.#finalizedTurn = {
      turnId: this.#currentTurnId,
      normalizedText: normalizeTranscript(text),
    };
  }

  #shouldIgnoreDuplicateFinal(serverFinalText: string): boolean {
    if (!this.#finalizedTurn) {
      return false;
    }

    if (this.#finalizedTurn.turnId !== this.#currentTurnId) {
      return false;
    }

    return (
      normalizeTranscript(serverFinalText) ===
      this.#finalizedTurn.normalizedText
    );
  }

  // ── User talking timeout ────────────────────────────────────────────────

  #armUserTalkingTimeout(): void {
    this.#clearUserTalkingTimeout();

    this.#userTalkingTimeout = setTimeout(() => {
      if (!this.#state.userIsTalking) {
        return;
      }

      if (this.#config.debugMode) {
        console.warn(
          `[VoiceSession] Forcing speech end after ${this.#maxUserTalkingMs}ms timeout`,
        );
      }

      try {
        this.#config.connector.sendVoiceMessage({
          type: 'client.vad.speech_end',
          sessionId: this.#config.sessionId ?? 'unknown',
          timestamp: performance.now(),
        });
      } catch (err) {
        this.#setError(
          err instanceof VoiceError
            ? err
            : new VoiceError(
                'UNKNOWN',
                err instanceof Error ? err.message : String(err),
                err,
              ),
        );
      }

      this.#state.userIsTalking = false;
      this.#emitStateChange();
    }, this.#maxUserTalkingMs);
  }

  #clearUserTalkingTimeout(): void {
    if (!this.#userTalkingTimeout) {
      return;
    }

    clearTimeout(this.#userTalkingTimeout);
    this.#userTalkingTimeout = null;
  }

  // ── State computation & emission ────────────────────────────────────────

  /**
   * Derive the high-level voice state from internal flags.
   *
   * Priority: error > speaking > userIsTalking > listening > idle.
   */
  #computeState(): VoiceSessionState {
    if (this.#state.error) return 'error';
    if (this.#state.isSpeaking) return 'speaking';
    if (this.#state.userIsTalking) return 'silence';
    if (this.#state.isListening) return 'listening';
    return 'idle';
  }

  #emitStateChange(): void {
    const currentState = this.#computeState();
    this.#emit('stateChange', currentState);
  }

  #setNeedsUserGesture(): void {
    if (this.#needsUserGesture) return;
    this.#needsUserGesture = true;
    this.#emit('needsUserGesture', true);
  }

  #clearNeedsUserGesture(): void {
    if (!this.#needsUserGesture) return;
    this.#needsUserGesture = false;
    this.#emit('needsUserGesture', false);
  }

  #setError(error: VoiceError): void {
    // Guard against duplicate emissions when the same error is surfaced by
    // multiple layers (e.g. prepareAudio() rethrows → startListening() catch
    // would otherwise re-report the identical instance).
    if (this.#state.error === error) return;
    this.#state.error = error;
    this.#emit('error', error);
    this.#emitStateChange();
  }

  /**
   * Fire specific event listeners, then fire catchall 'event' listeners
   * with a discriminated-union VoiceEvent object.
   */
  #emit<K extends keyof VoiceEventMap>(
    event: K,
    ...args: Parameters<VoiceEventMap[K]>
  ): void {
    // 1. Fire specific listeners
    const listeners = this.#listeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          (cb as (...a: unknown[]) => void)(...args);
        } catch (err) {
          console.error(`[VoiceSession] listener error (${event}):`, err);
        }
      }
    }

    // 2. Fire catchall listeners with discriminated union
    const catchallListeners = this.#listeners.get('event');
    if (catchallListeners && event !== 'event') {
      const voiceEvent = buildVoiceEvent(event, args);
      for (const cb of catchallListeners) {
        try {
          (cb as (ev: VoiceEvent) => void)(voiceEvent);
        } catch (err) {
          console.error('[VoiceSession] listener error (event):', err);
        }
      }
    }
  }
}

// ── Private helpers (below exported entities) ───────────────────────────────

/**
 * Internal mutable state, grouped for atomic reset in destroy().
 */
interface VoiceSessionInnerState {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  error: VoiceError | null;
  isAudioPipelineReady: boolean;
  userAudioLevel: number;
  /** Whether current audio stream can be interrupted by user speech */
  currentAudioCancellable: boolean;
  suppressIncomingAssistantAudio: boolean;

  userIsTalking: boolean;
  isInitializing: boolean;
  hasUserInitiatedListening: boolean;
  isPreparingAudio: boolean;
  prepareAudioPromise: Promise<void> | null;

  capture: AudioCapture;
  playback: AudioPlayback;
  vad: VADProcessor;
}

/**
 * Best-effort check that a user has interacted with the page since load.
 *
 * `navigator.userActivation.hasBeenActive` is the spec API (Chromium 72+,
 * Firefox 119+, Safari 17+). When the property is unavailable (older
 * browsers, jsdom, SSR) we optimistically return `true` so the session
 * falls back to the legacy eager-prepare path — letting the existing
 * `MICROPHONE_DENIED` recovery handle the rejection if a gesture really
 * was missing.
 */
function hasPriorUserActivation(): boolean {
  if (typeof navigator === 'undefined') return true;
  const activation = (
    navigator as { userActivation?: { hasBeenActive?: boolean } }
  ).userActivation;
  if (!activation || typeof activation.hasBeenActive !== 'boolean') {
    return true;
  }
  return activation.hasBeenActive;
}

/** Concatenate two Float32Arrays into a new array. */
function concatFloat32Arrays(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/** Normalize transcript text for duplicate detection. */
function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a discriminated union VoiceEvent from an event name and its args. */
function buildVoiceEvent(
  event: Exclude<keyof VoiceEventMap, 'event'>,
  args: unknown[],
): VoiceEvent {
  switch (event) {
    case 'stateChange':
      return { type: 'stateChange', state: args[0] as VoiceSessionState };
    case 'transcript':
      return {
        type: 'transcript',
        text: args[0] as string,
        isFinal: args[1] as boolean,
      };
    case 'error':
      return { type: 'error', error: args[0] as VoiceError };
    case 'audioLevel':
      return { type: 'audioLevel', level: args[0] as number };
    case 'response':
      return {
        type: 'response',
        ...(args[0] as { userMessage?: string; requestId: string }),
      };
    case 'speechStarted':
      return { type: 'speechStarted', text: args[0] as string };
    case 'audioOutput':
      return { type: 'audioOutput', audioData: args[0] as Uint8Array };
    case 'needsUserGesture':
      return { type: 'needsUserGesture', needsGesture: args[0] as boolean };
    default: {
      const _exhaustive: never = event;
      throw new Error(
        `buildVoiceEvent: unhandled event ${String(_exhaustive)}`,
      );
    }
  }
}
