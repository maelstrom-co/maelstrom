/**
 * Framework-agnostic voice session orchestrator for real-time voice conversations.
 *
 * Coordinates microphone capture, Voice Activity Detection (VAD), server
 * communication, and TTS playback into a unified state machine. This class is
 * the single source of truth for voice interaction state, designed to be
 * consumed by thin framework adapters (React hooks, Vue composables, etc.).
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           VoiceSession                                  │
 * │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                │
 * │  │ AudioCapture │──▶│ VADProcessor │──▶│  Connector   │──▶ Server      │
 * │  │   (16kHz)    │   │  (Silero)    │   │ (WebSocket)  │                │
 * │  └──────────────┘   └──────────────┘   └──────────────┘                │
 * │         ▲                                     │                         │
 * │         │                                     ▼                         │
 * │         │              ┌──────────────────────────────────┐             │
 * │         │              │        AudioPlayback             │             │
 * │         │              │   (44.1kHz, gapless scheduling)  │             │
 * │         │              └──────────────────────────────────┘             │
 * │         │                             │                                 │
 * │         └─────────────────────────────┘                                 │
 * │                  (barge-in: playback interrupted                        │
 * │                   when user starts speaking)                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## State machine
 *
 * | State       | isListening | isSpeaking | userIsTalking | Description              |
 * |-------------|-------------|------------|---------------|--------------------------|
 * | `idle`      | false       | false      | false         | No active voice session  |
 * | `listening` | true        | false      | false         | Mic active, user silent  |
 * | `silence`   | true        | false      | true          | User is speaking         |
 * | `speaking`  | false       | true       | false         | TTS playing              |
 *
 * ## Protocol event naming
 *
 * Events follow the `{source}.{component}.{event}` convention:
 * - Client → Server: `client.vad.speech_start`, `client.audio_capture.audio_sent`
 * - Server → Client: `engine.stt.transcript`, `engine.tts.sent`
 *
 * ## Barge-in strategy
 *
 * Barge-in (interrupting TTS when user speaks) happens in VAD handlers, NOT in
 * transcript handlers. Why:
 * - VAD fires locally with zero network latency (~10ms detection)
 * - Transcripts arrive after speech is processed by server (~200-500ms)
 * - Waiting for transcript means user hears 200-500ms of stale TTS
 *
 * ## Binary audio frame format
 *
 * Audio frames from the server are prefixed with a 1-byte flags header:
 * ```
 * [flags: 1 byte][audio data: N bytes]
 *
 * Flags byte:
 *   Bit 0: cancellable (1 = can be interrupted, 0 = must play fully)
 *   Bits 1-7: reserved
 * ```
 *
 * When `cancellable=0`, barge-in is blocked (e.g., legal disclaimers that must
 * play completely). See `AUDIO_FRAME_FLAGS` in types.ts for the bit layout.
 *
 * @example
 * ```ts
 * const session = new VoiceSession({
 *   connector: websocketVoiceConnector,
 *   vadOptions: { positiveSpeechThreshold: 0.8 },
 *   onTranscript: (text, isFinal) => console.log(text),
 *   onVoiceStateChange: (state) => updateUI(state),
 * });
 *
 * await session.prepareAudio();  // Request mic permission
 * await session.startListening(); // Begin voice session
 *
 * // Later...
 * session.stopListening();
 * session.destroy();
 * ```
 */
import type { VoiceServerMessage } from '@maelstrom-co/protocol';
import { VoiceError } from '@maelstrom-co/protocol';

import { AudioCapture } from '../audio-capture/index.js';
import { AudioPlayback } from '../audio-playback/index.js';
import type { VoiceConnector } from '../types.js';
import type { VADStreamOptions } from '../vad/vad-processor.js';
import { VADProcessor } from '../vad/vad-processor.js';

/**
 * Silero VAD requires exactly 512 samples per inference call (32ms @ 16kHz).
 * AudioCapture emits 4096-sample chunks (256ms), so we slice into 8 windows.
 */
const VAD_WINDOW_SIZE = 512;

/** Concatenate two Float32Arrays into a new array. */
function concatFloat32Arrays(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * Simplified state representation for UI consumers.
 *
 * These four states cover all meaningful UI variations. Internal state
 * (isInitializing, isPreparingAudio) is hidden because UI doesn't need
 * to distinguish between "preparing" and "not yet started".
 */
export type VoiceSessionState = 'idle' | 'listening' | 'silence' | 'speaking';

export interface VoiceSessionOptions {
  /**
   * Abstraction over the transport layer (WebSocket, HTTP, mock).
   *
   * **Why an interface:** Decouples VoiceSession from WebSocket specifics,
   * enabling unit tests with mock connectors and alternative transports.
   */
  connector: VoiceConnector;

  /**
   * BCP-47 language code for speech recognition (default: 'en').
   *
   * **Why configurable:** STT providers need explicit language hints for
   * optimal accuracy. English 'en' is a safe default.
   */
  language?: string;

  /**
   * Enable interim (partial) transcription results (default: true).
   *
   * **Why default true:** Interim results provide real-time feedback which
   * improves perceived responsiveness. Disable to reduce visual noise.
   */
  interimResults?: boolean;

  /**
   * Text to speak when server connection is ready.
   *
   * **Why a greeting:** Voice UIs feel more natural when the assistant
   * acknowledges readiness. Omit for silent startup.
   */
  greeting?: string;

  /** Correlation ID for server-side session tracking. */
  sessionId?: string;

  /**
   * Configuration for the Silero VAD model.
   *
   * **Why required:** VAD thresholds are environment-specific. A noisy call
   * center needs higher thresholds than a quiet office.
   */
  vadOptions: VADStreamOptions;

  useVadToFinalizeInterims?: boolean;

  onTranscript?: (text: string, isFinal: boolean) => void;
  onAudioOutput?: (audioData: Uint8Array) => void;
  onVoiceStateChange?: (state: VoiceSessionState) => void;
  onResponse?: (response: { userMessage?: string; requestId: string }) => void;
  onSpeechStarted?: (text: string) => void;
  onError?: (error: VoiceError) => void;
  debugMode?: boolean;
}

/**
 * Internal mutable state, grouped for atomic reset in destroy().
 *
 * These fields are internal source-of-truth values used by the public getters.
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

  userIsTalking: boolean;
  isInitializing: boolean;
  hasUserInitiatedListening: boolean;
  isPreparingAudio: boolean;
  prepareAudioPromise: Promise<void> | null;

  capture: AudioCapture;
  playback: AudioPlayback;
  vad: VADProcessor;
}

export type VoiceSessionEvent =
  | 'stateChange'
  | 'transcript'
  | 'error'
  | 'audioLevel'
  | 'response';

type VoiceSessionEventMap = {
  stateChange: (state: VoiceSessionState) => void;
  transcript: (text: string, isFinal: boolean) => void;
  error: (error: VoiceError) => void;
  audioLevel: (level: number) => void;
  response: (response: { userMessage?: string; requestId: string }) => void;
};

/**
 * 16 kHz is the standard sample rate for speech recognition APIs (Google,
 * Deepgram, OpenAI Whisper). Higher rates waste bandwidth without improving
 * transcription quality for human speech (voice fundamentals are 80-250 Hz).
 */
const INPUT_SAMPLE_RATE = 16000;

/**
 * 44.1 kHz is standard CD-quality audio and the most universally supported
 * output rate across browsers and hardware. The browser's audio graph handles
 * resampling from server TTS rates (typically 24 kHz) transparently.
 */
const OUTPUT_SAMPLE_RATE = 44100;

const DEFAULT_MAX_USER_TALKING_MS = 60000;
const DEFAULT_STT_FINALIZE_TIMEOUT_MS = 800;

export class VoiceSession {
  #opts: VoiceSessionOptions;
  #state: VoiceSessionInnerState;

  #unsubscribeVoice: (() => void) | null = null;
  #unsubscribeBinary: (() => void) | null = null;
  #unsubscribePlaybackStart: (() => void) | null = null;
  #unsubscribePlaybackEnd: (() => void) | null = null;

  #listeners = new Map<
    VoiceSessionEvent,
    Set<VoiceSessionEventMap[VoiceSessionEvent]>
  >();

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

  constructor(options: VoiceSessionOptions) {
    this.#opts = options;
    this.#useVadToFinalizeInterims = options.useVadToFinalizeInterims ?? true;
    this.#maxUserTalkingMs = Math.max(
      0,
      options.vadOptions?.maxUserTalkingDurationSeconds !== undefined
        ? Math.round(options.vadOptions.maxUserTalkingDurationSeconds * 1000)
        : DEFAULT_MAX_USER_TALKING_MS,
    );
    this.#sttFinalizeTimeoutMs = Math.max(
      0,
      options.vadOptions?.minSilenceDurationSeconds !== undefined
        ? Math.round(options.vadOptions.minSilenceDurationSeconds * 1000)
        : DEFAULT_STT_FINALIZE_TIMEOUT_MS,
    );

    const capture = new AudioCapture({
      sampleRate: INPUT_SAMPLE_RATE,
      debugMode: options.debugMode ?? false,
    });

    const playback = new AudioPlayback({
      sampleRate: OUTPUT_SAMPLE_RATE,
      debugMode: options.debugMode ?? false,
    });

    const vad = new VADProcessor({
      streamOptions: options.vadOptions,
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
        if (this.#opts.debugMode) {
          console.error('[VoiceSession] VAD error:', err);
        }
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

  #initialize(): void {
    this.#wireConnector();
    this.#wireCapture();
    this.#wirePlayback();
  }

  #wireConnector(): void {
    this.#unsubscribeVoice = this.#opts.connector.onVoiceMessage((message) => {
      switch (message.type) {
        case 'engine.stt.transcript':
          this.#handleTranscript(message);
          break;
        case 'engine.stt.ready':
          this.#handleServerReady(message);
          break;
        case 'engine.tts.sent':
          if (message.text) {
            this.#opts.onSpeechStarted?.(message.text);
          }
          break;
        case 'engine.error':
          this.#handleVoiceError(message);
          break;
        case 'engine.maelstrom.response':
          this.#handleMaelstromResponse(message);
          break;
      }
    });
  }

  /**
   * Wire audio capture to VAD and conditional server streaming.
   *
   * **Why gate on userIsTalking:** Without gating, we'd stream every audio
   * frame to the server regardless of whether the user is speaking. This
   * wastes bandwidth and server processing. VAD determines when speech
   * starts, then we stream until speech ends.
   *
   * **Why process VAD on every frame:** VAD needs continuous audio to detect
   * speech onset. The gating only affects what we *send*, not what VAD *sees*.
   */
  #wireCapture(): void {
    this.#state.capture.on(
      'audio',
      (pcm16: Uint8Array, float32: Float32Array) => {
        this.#processVadChunked(float32);
        if (this.#state.userIsTalking) {
          this.#opts.connector.sendAudioChunk({
            data: pcm16,
            sampleRate: INPUT_SAMPLE_RATE,
            encoding: 'linear16',
            isFinal: false,
          });
        }
      },
    );
  }

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
    this.#vadProcessing = true;

    try {
      while (this.#vadQueue.length > 0) {
        const window = this.#vadQueue.shift();
        if (window) {
          await this.#state.vad.process(window);
        }
      }
    } catch (err) {
      if (this.#opts.debugMode) {
        console.error('VAD error:', err);
      }
    } finally {
      this.#vadProcessing = false;
    }
  }

  /**
   * Wire playback events to state and VAD threshold adjustments.
   *
   * **Why raise VAD threshold during playback (AEC mitigation):**
   * When TTS plays through speakers, the microphone picks up that audio.
   * Without adjustment, VAD would falsely detect "user speech" from the
   * assistant's own voice. By raising the speech detection threshold during
   * playback, we require stronger evidence of real user speech to trigger
   * barge-in, reducing false positives while still allowing intentional
   * interruptions.
   */
  #wirePlayback(): void {
    this.#unsubscribeBinary = this.#opts.connector.onBinaryAudio(
      (data, meta) => {
        this.#state.currentAudioCancellable = meta.cancellable;
        this.#state.playback.enqueue(data);
        this.#opts.onAudioOutput?.(data);
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
      this.#emitStateChange();
    });
  }

  /**
   * Attempt to interrupt AI playback when user starts speaking.
   *
   * **Why check cancellable:** Some audio (e.g., legal disclaimers) must play
   * fully and cannot be interrupted. The server signals this via a flags byte
   * prefix on binary audio frames (bit 0 = cancellable). When cancellable=false,
   * we ignore the barge-in attempt and let the audio finish.
   */
  #tryBargeIn(): void {
    if (!this.#state.currentAudioCancellable) {
      if (this.#opts.debugMode) {
        console.log('[VoiceSession] Barge-in blocked - audio not cancellable');
      }
      return;
    }

    if (this.#state.playback.isPlaying) {
      if (this.#opts.debugMode) {
        console.log('[VoiceSession] Barge-in triggered');
      }
      this.#state.playback.interrupt();
      this.#state.isSpeaking = false;
      this.#emitStateChange();
    }
  }

  /**
   * Handle incoming transcript from STT.
   *
   * **Why clear on isFinal:** Interim transcripts accumulate as the user speaks.
   * When the server finalizes, it means the utterance is complete and will be
   * processed. Clearing prevents stale interim text from lingering in the UI
   * after the user stops speaking.
   */
  #handleTranscript(message: VoiceServerMessage): void {
    if (message.type !== 'engine.stt.transcript') return;

    if (this.#opts.debugMode) {
      console.log(
        `[VoiceSession] Transcript: "${message.text}" isFinal: ${message.isFinal}`,
      );
    }

    if (message.isFinal) {
      this.#clearInterimFinalizeTimeout();

      if (this.#shouldIgnoreDuplicateFinal(message.text)) {
        if (this.#opts.debugMode) {
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

    this.#opts.onTranscript?.(message.text, message.isFinal);
    this.#emit('transcript', message.text, message.isFinal);
  }

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

      if (this.#opts.debugMode) {
        console.log(
          `[VoiceSession] Synthesizing final transcript after ${this.#sttFinalizeTimeoutMs}ms timeout: "${text}"`,
        );
      }

      this.#markTurnFinalized(text);
      this.#state.transcript = '';
      this.#opts.onTranscript?.(text, true);
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

  #normalizeTranscript(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

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
      normalizedText: this.#normalizeTranscript(text),
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
      this.#normalizeTranscript(serverFinalText) ===
      this.#finalizedTurn.normalizedText
    );
  }

  #handleServerReady(message: VoiceServerMessage): void {
    if (message.type !== 'engine.stt.ready') return;

    if (this.#opts.debugMode) {
      console.log('[VoiceSession] Server ready');
    }

    if (this.#opts.greeting) {
      if (this.#opts.debugMode) {
        console.log('[VoiceSession] Sending greeting');
      }
      this.#opts.connector.sendVoiceMessage({
        type: 'client.voice.speak',
        sessionId: message.sessionId,
        timestamp: performance.now(),
        text: this.#opts.greeting,
        dedupeKey: 'greeting',
      });
    }

    this.prepareAudio().catch(() => {});
  }

  #handleVoiceError(message: VoiceServerMessage): void {
    if (message.type !== 'engine.error') return;

    const error = new VoiceError('UNKNOWN', message.error);
    this.#setError(error);
  }

  #handleMaelstromResponse(message: VoiceServerMessage): void {
    if (message.type !== 'engine.maelstrom.response') return;

    if (this.#opts.debugMode) {
      console.log(
        `[VoiceSession] Maelstrom response: ${message.response?.userMessage}`,
      );
    }

    if (message.response) {
      this.#opts.onResponse?.({
        userMessage: message.response.userMessage,
        requestId: message.requestId,
      });
      this.#emit('response', {
        userMessage: message.response.userMessage,
        requestId: message.requestId,
      });
    }
  }

  /**
   * Handle VAD speech start: barge-in, notify server, send buffered audio.
   *
   * **Why send bufferedAudio:** VAD has inherent detection latency (~100-300ms).
   * By the time we know speech started, the user has already said something.
   * VADProcessor buffers recent audio so we can send the speech onset that
   * triggered detection, ensuring the server receives the complete utterance.
   *
   * **Why barge-in here (not in handleTranscript):** VAD fires locally with
   * ~10ms latency. Transcripts arrive 200-500ms later after server processing.
   * Waiting for transcript means the user hears stale TTS while speaking.
   */
  #handleVadSpeechStart(event: unknown, bufferedAudio: Uint8Array): void {
    void event;
    if (this.#opts.debugMode) {
      console.log('[VoiceSession] VAD speech start');
    }

    this.#turnCounter += 1;
    this.#currentTurnId = this.#turnCounter;
    this.#clearInterimFinalizeTimeout();

    this.#tryBargeIn();

    this.#opts.connector.sendVoiceMessage({
      type: 'client.vad.speech_start',
      sessionId: this.#opts.sessionId ?? 'unknown',
      timestamp: performance.now(),
    });

    if (bufferedAudio.length > 0) {
      this.#opts.connector.sendAudioChunk({
        data: bufferedAudio,
        sampleRate: INPUT_SAMPLE_RATE,
        encoding: 'linear16',
        isFinal: false,
      });

      if (this.#opts.debugMode) {
        console.log(
          `[VoiceSession] Sent buffered audio: ${bufferedAudio.length} bytes`,
        );
      }
    }

    this.#state.userIsTalking = true;
    this.#armUserTalkingTimeout();
    this.#emitStateChange();
  }

  #handleVadSpeechEnd(event: unknown, durationMs: number): void {
    void event;
    if (this.#opts.debugMode) {
      console.log(`[VoiceSession] VAD speech end, duration: ${durationMs}ms`);
    }

    this.#opts.connector.sendVoiceMessage({
      type: 'client.vad.speech_end',
      sessionId: this.#opts.sessionId ?? 'unknown',
      timestamp: performance.now(),
    });

    this.#state.userIsTalking = false;
    this.#clearUserTalkingTimeout();

    if (this.#state.transcript.trim()) {
      this.#scheduleInterimFinalize();
    }

    this.#emitStateChange();
  }

  #armUserTalkingTimeout(): void {
    this.#clearUserTalkingTimeout();

    this.#userTalkingTimeout = setTimeout(() => {
      if (!this.#state.userIsTalking) {
        return;
      }

      if (this.#opts.debugMode) {
        console.warn(
          `[VoiceSession] Forcing speech end after ${this.#maxUserTalkingMs}ms timeout`,
        );
      }

      this.#opts.connector.sendVoiceMessage({
        type: 'client.vad.speech_end',
        sessionId: this.#opts.sessionId ?? 'unknown',
        timestamp: performance.now(),
      });

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

  /**
   * Initialize audio pipeline (mic access + VAD model loading).
   *
   * **Why promise deduplication:** Multiple callers might invoke prepareAudio()
   * simultaneously (e.g., server ready event + user click). Without deduplication,
   * we'd request mic permission twice, confusing the user. By storing and
   * returning the in-flight promise, all callers share the same initialization.
   *
   * **Why separate from startListening:** Mic permission prompts block UI.
   * By separating preparation from listening, the app can request permission
   * on a "warm up" button before the user is ready to speak, reducing
   * perceived latency when they actually start.
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

        await this.#state.capture.start();

        // AudioCapture.start() doesn't throw on error - it emits 'error' event.
        // Check isReady to detect failures like microphone permission denied.
        if (!this.#state.capture.isReady) {
          throw new DOMException('Microphone access denied', 'NotAllowedError');
        }

        await this.#state.vad.load();

        this.#state.isAudioPipelineReady = true;

        if (this.#opts.debugMode) {
          console.log('[VoiceSession] Audio pipeline ready');
        }
      } catch (err) {
        const voiceError = new VoiceError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'MICROPHONE_DENIED'
            : 'UNKNOWN',
          err instanceof Error ? err.message : String(err),
          err,
        );
        this.#setError(voiceError);

        if (this.#opts.debugMode) {
          console.error('[VoiceSession] Error preparing audio:', err);
        }
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
   * **Why auto-prepare:** If prepareAudio() wasn't called explicitly, we call
   * it here. This provides a simpler API for basic use cases while still
   * allowing advanced users to pre-warm the audio pipeline for lower latency.
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

      this.#opts.connector.startListening(
        this.#opts.language ?? 'en',
        this.#opts.interimResults ?? true,
      );

      if (this.#opts.debugMode) {
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

      if (this.#opts.debugMode) {
        console.error('[VoiceSession] Error starting listening:', err);
      }
    }
  }

  /**
   * Stop listening for user speech and tear down the capture pipeline.
   *
   * **Why stop capture before connector:** The capture pipeline feeds raw PCM
   * into the connector. Stopping the connector first would leave the capture
   * sending data to a closed channel, causing "write to closed pipe" errors
   * in some WebSocket implementations. Capture-first ensures clean shutdown.
   *
   * **Why reset userIsTalking:** If the user was mid-utterance when we stop,
   * we must clear the talking flag to avoid a stale "user is speaking" state
   * that would never clear (since VAD events stop arriving after capture stops).
   */
  stopListening(): void {
    if (!this.#state.isListening) {
      return;
    }

    this.#state.capture.stop();
    this.#opts.connector.stopListening();

    this.#state.isListening = false;
    this.#state.userIsTalking = false;
    this.#clearUserTalkingTimeout();
    this.#clearInterimFinalizeTimeout();
    this.#state.transcript = '';
    this.#currentTurnId = 0;
    this.#finalizedTurn = null;
    this.#emitStateChange();

    if (this.#opts.debugMode) {
      console.log('[VoiceSession] Stopped listening');
    }
  }

  /**
   * Immediately stop AI audio playback (barge-in from UI).
   *
   * **Why only playback, not capture:** This is the UI-initiated barge-in path
   * (e.g., user clicks a "stop" button). Unlike VAD-triggered barge-in in
   * `handleVadSpeechStart()`, we don't need to flush buffered audio or notify
   * the server—we just silence the output. Capture continues so the user can
   * keep speaking if they want.
   *
   * **Why clear isSpeaking immediately:** The playback module will emit its
   * own 'end' event, but we pre-emptively clear the flag to give instant UI
   * feedback. The redundant 'end' event handler is a no-op when already false.
   */
  interrupt(): void {
    this.#state.playback.interrupt();
    this.#state.isSpeaking = false;
    this.#emitStateChange();

    if (this.#opts.debugMode) {
      console.log('[VoiceSession] Interrupted');
    }
  }

  /**
   * Release all resources: subscriptions, audio modules, VAD, event listeners.
   *
   * **Why unsubscribe before destroy:** Connector subscriptions fire callbacks
   * that reference capture/playback. If we destroy modules first, late-arriving
   * messages would call methods on destroyed objects. Unsubscribe-first ensures
   * no callbacks fire during teardown.
   *
   * **Why explicit order (capture → playback → vad):** Each module may hold
   * references to browser APIs (MediaStream, AudioContext, WASM). Destroying
   * in creation order ensures predictable garbage collection and avoids
   * "context closed" errors from AudioWorklet operations mid-flight.
   *
   * **Why clear listeners last:** Consumers may have `on('error')` handlers
   * that need to fire if destruction itself fails. Clearing listeners too
   * early would swallow errors during the teardown cascade.
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

    this.#state.capture.destroy();
    this.#state.playback.destroy();
    this.#state.vad.dispose();

    this.#listeners.clear();

    if (this.#opts.debugMode) {
      console.log('[VoiceSession] Destroyed');
    }
  }

  /**
   * Derive the high-level voice state from internal flags.
   *
   * **Why priority order matters:** The checks are ordered by "who has the
   * floor" in conversation. Speaking (AI output) takes precedence because
   * the user should see "AI is talking" even if they're also speaking (which
   * triggers barge-in). UserIsTalking ('silence' state) means we're capturing
   * their utterance. Listening means mic is hot but user is silent. Idle is
   * the fallback when nothing is active.
   *
   * **Why 'silence' for userIsTalking:** Counter-intuitive naming inherited
   * from the protocol. "silence" means "AI is silent, waiting for user to
   * finish speaking"—not that there's no sound. This maps to the VAD "speech
   * detected" window.
   */
  #computeState(): VoiceSessionState {
    if (this.#state.isSpeaking) return 'speaking';
    if (this.#state.userIsTalking) return 'silence';
    if (this.#state.isListening) return 'listening';
    return 'idle';
  }

  #emitStateChange(): void {
    const currentState = this.#computeState();
    this.#opts.onVoiceStateChange?.(currentState);
    this.#emit('stateChange', currentState);
  }

  #setError(error: VoiceError): void {
    this.#state.error = error;
    this.#opts.onError?.(error);
    this.#emit('error', error);
  }

  /**
   * Subscribe to session events. Returns an unsubscribe function.
   *
   * **Why return unsubscribe function:** Enables idiomatic cleanup in React
   * useEffect (return the unsubscribe) and vanilla JS (store and call later).
   * This pattern avoids the need for `off()` methods and prevents the common
   * bug of forgetting to remove listeners.
   */
  on<K extends VoiceSessionEvent>(
    event: K,
    cb: VoiceSessionEventMap[K],
  ): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(cb as VoiceSessionEventMap[VoiceSessionEvent]);
    return () => {
      set.delete(cb as VoiceSessionEventMap[VoiceSessionEvent]);
    };
  }

  #emit(event: VoiceSessionEvent, ...args: unknown[]): void {
    this.#listeners.get(event)?.forEach((cb) => {
      (cb as (...cbArgs: unknown[]) => void)(...args);
    });
  }

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
}
