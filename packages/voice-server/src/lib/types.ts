import type {
  ChartRequest,
  MaelstromResponse,
  SessionId,
} from '@maelstrom-co/protocol';

/**
 * Voice session states reflecting the internal loop: STT → process → TTS.
 *
 * WHY: The voice session is a state machine. Audio flows through STT (transcription),
 * then optionally to an external process (engine), then to TTS (speech output).
 * These states track where we are in that loop. The state drives UI feedback
 * (e.g., "listening" shows a microphone icon, "speaking" shows audio waves).
 *
 * - idle: No active session, ready to start
 * - listening: Receiving audio, waiting for speech
 * - processing: Final transcript sent to external handler (engine), waiting for response
 * - speaking: Playing TTS audio output
 */
export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking';

/**
 * Wire-level audio encodings accepted by the shared STT provider contract.
 *
 * WHY: `voice-server` sits between browsers, adapters, and vendor SDKs that rarely agree on naming.
 * Keeping the encoding vocabulary small makes provider validation explicit and forces adapters to
 * normalize audio before it crosses the package boundary.
 */
export type AudioEncoding = 'linear16' | 'opus' | 'pcm';

/**
 * Output audio formats emitted by TTS providers.
 *
 * WHY: Callers often need to choose the right decoder or playback path before the first chunk
 * arrives. Exposing the format in the shared contract keeps that decision independent from the
 * concrete provider implementation.
 */
export type SpeechFormat = 'pcm_f32le' | 'opus' | 'mp3';

/**
 * Audio chunk from client for STT processing.
 *
 * WHY: Audio arrives as discrete chunks over WebSocket. Each chunk carries
 * timing info so the STT provider can reconstruct the full audio stream.
 * The timestamp enables correlation with VAD events from the client.
 */
export interface AudioChunk {
  /** Raw PCM/opus audio data */
  data: Uint8Array;
  /** Sample rate of this chunk (typically 16000 from browser) */
  sampleRate: number;
  /** Encoding format */
  encoding: AudioEncoding;
  bytesPerSample?: number;
  channels?: number;
  /** Client-side timestamp when chunk was captured (performance.now()) */
  timestamp: number;
  /** Sequence number for ordering (optional, for robustness) */
  sequence?: number;
}

/**
 * Transcription result from STT provider.
 *
 * WHY: STT providers can emit two types of results:
 * - Interim: Partial recognition while user is still speaking. Used for
 *   real-time feedback (live captions), but NOT for intent processing.
 * - Final: Complete transcription after silence/VAD event. Only this triggers
 *   intent processing via the runtime intent boundary.
 *
 * This split enables UI responsiveness (user sees what they said) without
 * premature intent processing that would happen with partial results.
 */
export interface TranscriptionResult {
  /** Recognized text */
  text: string;
  /** Whether this is final (ready for intent processing) or interim (preview only) */
  isFinal: boolean;
  /** Confidence score from provider (if available) */
  confidence?: number;
  /** Detected language (if provider supports it) */
  language?: string;
  /** Audio duration in seconds (if available) */
  durationInSeconds?: number;
}

/**
 * STT provider capabilities that meaningfully affect voice-runtime config.
 *
 * WHY: The shared runtime only branches on whether a provider can emit interim
 * transcripts. Other previously exported capability flags were dead metadata:
 * providers always streamed and may still include per-result confidence in
 * `TranscriptionResult`, but the runtime never used capability booleans for
 * either concern.
 */
export interface STTProviderCapabilities {
  /** Provider emits interim (partial) results during speech. */
  interimTranscripts: boolean;
}

/**
 * Voice Activity Detection event from client.
 *
 * WHY: Client-side VAD is the source of truth. Provider-native VAD
 * events are NOT required in the shared STT interface. The client detects
 * speech start/end and sends these events to coordinate the session.
 *
 * This keeps the server-side simple — it trusts the client's VAD rather
 * than trying to reconcile two independent VAD systems (client + provider).
 *
 * It also keeps the wire protocol focused on meaningful transitions instead of raw silence,
 * which reduces unnecessary provider work and bandwidth.
 */
export interface VADEvent {
  /**
   * VAD transition type.
   *
   * WHY: These events mark turn boundaries, not transcription quality.
   * - speech_start: user has taken the floor; pending finalization should be cancelled
   * - speech_end: user stopped speaking; runtime can prepare to finalize after debounce
   * - utterance_end: stronger boundary signal when the client can detect a completed utterance
   */
  type: 'speech_start' | 'speech_end' | 'utterance_end';
  /** Client-side timestamp */
  timestamp: number;
  /** Duration of detected speech (if available) */
  durationMs?: number;
}

/**
 * Events emitted by the STT provider.
 *
 * WHY: The STT provider is a black box. It connects to external services
 * (Deepgram, Google STT) and emits events when something happens.
 * These events let the voice session runtime react to provider state changes without depending
 * on provider-specific SDK details.
 * - connected / disconnected: transport state for provider lifecycle and reconnect logic
 * - transcript: recognition state for interim/final utterance assembly
 * - error: failure state that should be surfaced without crashing the whole session
 */
export type STTEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'transcript'; result: TranscriptionResult }
  | { type: 'error'; error: Error };

/**
 * Speech-to-Text provider interface.
 *
 * WHY: We want swappable providers (Deepgram, Google, Whisper, etc.).
 * This interface abstracts them. Each provider implements connect/disconnect
 * and emits transcripts via events. The voice session runtime doesn't know
 * which provider is used — only that it follows this contract.
 *
 * IMPORTANT: Providers are configured statically and stay sticky per session.
 * Switching providers mid-session would lose context and confuse the user.
 */
export interface STTProvider {
  /** Provider name for logging/debugging */
  readonly name: string;
  /** What features this provider supports */
  readonly capabilities: STTProviderCapabilities;

  /** Connect to the STT service and transition provider transport into a ready state */
  connect(config?: { language?: string }): Promise<void>;
  /** Disconnect from the STT service and release any active streaming state */
  disconnect(): Promise<void>;
  /** Send audio chunk for transcription while the runtime session is actively listening */
  sendAudio(chunk: AudioChunk): void;
  /** Signal end of audio stream so the provider can flush and finalize the current turn */
  endStream(): void;
  /** Subscribe to provider events */
  onEvent(callback: (event: STTEvent) => void): () => void;
  /** Whether the transport is currently connected and ready for config/audio writes */
  isConnected(): boolean;
}

/**
 * Audio chunk from TTS provider for playback.
 *
 * WHY: TTS providers can stream audio chunks as they're generated (vs waiting
 * for full synthesis). Streaming enables lower latency — user hears speech
 * sooner. The chunk includes timing/sequence for proper playback ordering.
 */
export interface SpeechChunk {
  /** Audio data */
  data: Uint8Array;
  /** Audio format (pcm, mp3, opus) */
  format: SpeechFormat;
  /** Sample rate */
  sampleRate: number;
  /** Text being spoken (for display/debugging) */
  text?: string;
  /** Whether this is the final chunk */
  isFinal: boolean;
  /** Sequence number for ordering */
  sequence?: number;
}

/**
 * Options for TTS speech synthesis.
 *
 * WHY: Different voices/languages/speeds for different use cases.
 * These map to provider-specific parameters but abstracted here.
 */
export interface SpeechOptions {
  /** Voice ID (provider-specific) */
  voice?: string;
  /** Speech rate (0.5-2.0 typically) */
  speed?: number;
  /** Language code */
  language?: string;
  /** Output sample rate */
  sampleRate?: number;
}

/**
 * Metadata emitted when a spoken turn starts.
 *
 * WHY: Consumers usually need to react before the first audio chunk lands, for example by preparing
 * a decoder, clearing stale UI, or showing an "assistant speaking" indicator. This event carries
 * the stable turn-level metadata needed for that setup.
 */
export interface SpeechStart {
  /** The text this spoken turn is attempting to synthesize. */
  text: string;
  /** Audio format that subsequent chunks for this turn will use. */
  format: SpeechChunk['format'];
  /** Sample rate that downstream playback should expect for the turn. */
  sampleRate: number;
}

/**
 * TTS provider capabilities.
 *
 * WHY: Same rationale as STT — providers differ. Cartesia supports streaming,
 * some others may only do batch. This capability model lets the runtime
 * adapt: stream chunks if supported, otherwise wait for full audio.
 */
export interface TTSProviderCapabilities {
  /** Provider can stream audio chunks during synthesis instead of waiting for a full buffer */
  streamingTts: boolean;
}

/**
 * Events emitted by the TTS provider.
 *
 * WHY: Similar to STT events — TTS is async and external. Events let the
 * runtime know how speech generation is progressing.
 * - connected / disconnected: transport state for provider lifecycle
 * - started: a new spoken turn has begun and the runtime should enter speaking state
 * - chunk: audio payload for playback, optionally streamed incrementally
 * - completed / stopped: terminal states for a spoken turn, either natural or interrupted
 * - error: failure state that should surface to the caller and end the turn safely
 */
export type TTSEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'started'; speech: SpeechStart }
  | { type: 'chunk'; chunk: SpeechChunk }
  | { type: 'completed' }
  | { type: 'stopped' }
  | { type: 'error'; error: Error };

/**
 * Text-to-Speech provider interface.
 *
 * WHY: Swappable TTS providers (Cartesia, Google, Amazon Polly, etc.).
 * Each implements speak/stop and emits events. The runtime coordinates
 * playback but doesn't know provider details.
 */
export interface TTSProvider {
  readonly name: string;
  readonly capabilities: TTSProviderCapabilities;

  /** Connect to the TTS service and prepare the provider for synthesis requests */
  connect(): Promise<void>;
  /** Disconnect from the TTS service and clear any active synthesis transport state */
  disconnect(): Promise<void>;
  /** Start synthesizing a spoken turn with the current provider-specific voice settings */
  speak(text: string, options?: SpeechOptions): void;
  /** Stop the active spoken turn immediately for interruption or replacement */
  stop(): void;
  onEvent(callback: (event: TTSEvent) => void): () => void;
  /** Whether the provider transport is ready to accept synthesis requests */
  isConnected(): boolean;
}

/**
 * Callbacks for voice session events.
 *
 * WHY: The voice session runtime needs to communicate with the outside
 * world (UI updates, error handling). These callbacks let the caller
 * (typically a server adapter like ws-server) react:
 * - Update UI with transcript/state
 * - Play audio on the client
 * - Handle errors gracefully
 * - Signal interruptions (barge-in)
 *
 * These are OPTIONAL — the runtime works without them for headless use.
 */
export interface VoiceSessionCallbacks {
  /**
   * Called after the runtime commits a state transition.
   *
   * WHY: This is the cleanest hook for adapters that want to mirror the runtime state machine into
   * transport messages or UI indicators without subscribing through the listener API.
   */
  onVoiceStateChange?: (state: VoiceSessionState) => void;
  /**
   * Called when the runtime forwards an interim preview or a finalized transcript.
   *
   * WHY: The callback sees the same turn assembly decisions as runtime listeners, including the rule
   * that only client-VAD boundaries are allowed to surface `isFinal: true`.
   */
  onTranscript?: (result: TranscriptionResult) => void;
  /** Called when a client-owned VAD boundary event reaches the runtime. */
  onVADEvent?: (event: VADEvent) => void;
  /** Called for each TTS chunk that should be shipped to the playback side. */
  onAudioOutput?: (chunk: SpeechChunk) => void;
  /** Called when a new spoken turn starts and playback setup can begin. */
  onSpeechStarted?: (speech: SpeechStart) => void;
  /**
   * Called when the active spoken turn stops.
   *
   * @param completed - `true` for a natural completion, `false` when the turn was interrupted or the
   * transport stopped unexpectedly.
   */
  onSpeechStopped?: (completed: boolean) => void;
  /** Called when the runtime aborts an in-flight listen, process, or speak phase. */
  onInterrupt?: (source: 'user' | 'system') => void;
  /**
   * Called for provider, runtime, and callback-safety failures.
   *
   * WHY: The runtime catches and reports errors instead of crashing the process because voice flows
   * often run inside long-lived server transports.
   */
  onError?: (error: Error) => void;
}

/**
 * Callback invoked when a final transcript is ready for intent processing.
 *
 * WHY: This is the ENGINEERING BOUNDARY between voice-server and
 * whatever handles intent. It could be:
 * - A local engine (engine-old, engine)
 * - A remote cloud API
 * - A mock for testing
 *
 * The voice-server connects to the engine via the ProcessIntent contract.
 * This keeps the voice-server engine-agnostic while providing typed
 * access to the core engine pipeline.
 */
export interface ProcessIntent {
  /**
   * Process a chart request and return a MaelstromResponse.
   *
   * @param request - The chart request to process
   * @param signal - Optional cooperative abort signal for interruption/barge-in. Implementations
   * must treat this as a cooperative cancellation contract: check `signal.aborted` before doing
   * expensive work, stop as soon as practical after it flips, and avoid emitting side effects once
   * the signal has been aborted.
   * @returns Promise resolving to MaelstromResponse
   */
  process(
    request: ChartRequest,
    signal?: AbortSignal,
  ): Promise<MaelstromResponse>;
}

/**
 * Options for explicit intent requests submitted through {@link VoiceSession.processRequest}.
 *
 * WHY: The runtime can process text turns that did not originate from STT, but adapters still need a
 * way to control whether the resulting assistant reply should be spoken or handled silently.
 */
export interface VoiceSessionIntentRequestOptions {
  /** When false, skip TTS playback even if intent processing returns a user-facing reply. */
  speakResponse?: boolean;
}

/**
 * Builder contract for converting a finalized voice turn into an intent request.
 *
 * WHY: `voice-server` owns the turn-taking/runtime boundary, but each app owns how a finalized
 * transcript becomes a `ChartRequest`. Exporting a single builder contract keeps that seam
 * importable for adapters without forcing them into positional arguments or sync-only behavior.
 */
export type VoiceSessionIntentRequestBuilder = (input: {
  /** Finalized user transcript for the completed turn. */
  transcript: string;
  /** Session identifier to preserve app-level request affinity. */
  sessionId: SessionId;
}) => ChartRequest | Promise<ChartRequest>;

interface VoiceSessionBaseConfig {
  /** STT provider instance */
  stt: STTProvider;
  /** TTS provider instance */
  tts: TTSProvider;
  /** Session identifier */
  sessionId: SessionId;
  /** Language code for STT/TTS */
  language?: string;
  /** Override whether interim transcripts are forwarded, instead of using the STT provider default. */
  interimResults?: boolean;
  /** Restart listening automatically after a spoken reply finishes. */
  autoRestartListening?: boolean;
  /** Delay, in milliseconds, before a VAD end signal is treated as the final turn boundary. */
  vadFinalDebounceMs?: number;
  /** Maximum audio chunks to buffer while the STT transport is reconnecting. */
  maxPendingAudioChunks?: number;
  /** Maximum consecutive STT reconnect attempts before surfacing failure. */
  maxReconnectAttempts?: number;
  /** Delay, in milliseconds, between STT reconnect attempts. */
  reconnectDelayMs?: number;
  /** Optional trace sink for runtime lifecycle and provider events. */
  trace?: (event: string, details?: Record<string, unknown>) => void;
}

interface VoiceSessionIntentBoundaryConfig {
  /** Build the chart request that should be sent to the intent processor for a finalized transcript. */
  buildChartRequest: VoiceSessionIntentRequestBuilder;
  /** Execute the built chart request and return the response that may be spoken back to the user. */
  processIntent: ProcessIntent;
}

interface VoiceSessionNoIntentBoundaryConfig {
  buildChartRequest?: undefined;
  processIntent?: undefined;
}

/**
 * Public configuration for the shared voice runtime.
 *
 * WHY: This config describes only the mechanics owned by `voice-server`: provider lifecycle,
 * buffering, reconnect policy, transcript forwarding, and the optional runtime→engine boundary.
 * If an app wants the runtime to process finalized transcripts (and explicit text turns), it must
 * provide both halves of the boundary: `buildChartRequest` to create a request and `processIntent`
 * to execute it. A config where only one half is present is intentionally unrepresentable.
 */
export type VoiceSessionConfig = VoiceSessionBaseConfig &
  (VoiceSessionIntentBoundaryConfig | VoiceSessionNoIntentBoundaryConfig);

/**
 * Fully resolved runtime configuration after defaults and provider-derived values are applied.
 *
 * WHY: The runtime wants a single internal config shape with no optional mechanics. Resolving once at
 * construction time keeps the hot path focused on turn handling rather than repeatedly merging
 * defaults or re-checking whether the intent boundary exists.
 */
export interface ResolvedVoiceSessionConfig {
  /** Connected STT provider instance used for the whole session. */
  stt: STTProvider;
  /** Connected TTS provider instance used for the whole session. */
  tts: TTSProvider;
  /** Stable session id that ties voice turns back to the host app. */
  sessionId: SessionId;
  /** Preferred language passed into providers when they support it. */
  language?: string;
  /** Whether interim transcript previews should be forwarded beyond internal state assembly. */
  interimResults: boolean;
  /** Whether the runtime should return to listening after a spoken reply finishes. */
  autoRestartListening: boolean;
  /** Debounce window used before a VAD end signal becomes a hard finalization boundary. */
  vadFinalDebounceMs: number;
  /** Maximum number of audio chunks that may queue while STT is not ready. */
  maxPendingAudioChunks: number;
  /** Maximum consecutive STT reconnect attempts before the runtime gives up. */
  maxReconnectAttempts: number;
  /** Delay between reconnect attempts after an STT disconnect. */
  reconnectDelayMs: number;
  /** Optional trace sink for observability hooks. */
  trace?: (event: string, details?: Record<string, unknown>) => void;
  /** Intent-processing boundary, or `null` when the runtime should stay transport-only. */
  intentBoundary: VoiceSessionIntentBoundaryConfig | null;
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
    maxPendingAudioChunks: number;
    maxReconnectAttempts: number;
    reconnectDelayMs: number;
  },
): ResolvedVoiceSessionConfig {
  return {
    stt: config.stt,
    tts: config.tts,
    sessionId: config.sessionId,
    language: config.language,
    interimResults:
      config.interimResults ?? config.stt.capabilities.interimTranscripts,
    autoRestartListening: config.autoRestartListening ?? true,
    vadFinalDebounceMs:
      config.vadFinalDebounceMs ?? defaults.vadFinalDebounceMs,
    maxPendingAudioChunks:
      config.maxPendingAudioChunks ?? defaults.maxPendingAudioChunks,
    maxReconnectAttempts:
      config.maxReconnectAttempts ?? defaults.maxReconnectAttempts,
    reconnectDelayMs: config.reconnectDelayMs ?? defaults.reconnectDelayMs,
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
 * The voice session runtime interface.
 *
 * WHY: This is what the caller (server adapter) interacts with.
 * It provides methods to control the session (start/stop/interrupt)
 * and subscriptions for events. The implementation hides all the
 * complexity: provider management, reconnection, buffering, state machine.
 */
export interface VoiceSession {
  /** Read the current state of the runtime state machine. */
  getVoiceState(): VoiceSessionState;
  /**
   * Pre-connect STT and TTS providers.
   *
   * WHY: Warmup lets an adapter pay provider connection cost before the first audible turn, which is
   * often the difference between a responsive and a sluggish first interaction.
   */
  warmup(): Promise<void>;
  /**
   * Enter listening mode and make the STT side ready for audio.
   *
   * This may reconnect STT, reset turn tracking, and replay buffered audio that arrived while the
   * runtime was still initializing.
   */
  startListening(): Promise<void>;
  /**
   * End the current listening turn.
   *
   * WHY: Stopping listening is more than a transport action. The runtime also tries to flush and
   * finalize the current utterance exactly once, even if provider and VAD finalization race.
   */
  stopListening(): Promise<void>;
  /**
   * Interrupt the active turn.
   *
   * WHY: This is the barge-in control. It stops speaking, aborts in-flight intent work, or ends the
   * current listen phase so a newer user turn can take over.
   */
  interrupt(): void;
  /**
   * Submit an explicit chart request through the configured intent boundary.
   *
   * @returns The response from the intent processor, or `undefined` when no intent boundary is
   * configured or the request was superseded by a newer turn.
   */
  processRequest(
    request: ChartRequest,
    options?: VoiceSessionIntentRequestOptions,
  ): Promise<MaelstromResponse | undefined>;
  /** Subscribe to runtime state transitions. */
  onVoiceStateChange(callback: (state: VoiceSessionState) => void): () => void;
  /** Subscribe to transcript forwarding events. */
  onTranscript(callback: (result: TranscriptionResult) => void): () => void;
  /** Subscribe to client-owned VAD events after they reach the runtime. */
  onVADEvent(callback: (event: VADEvent) => void): () => void;
  /** Subscribe to TTS chunks that should be forwarded to playback. */
  onAudioOutput(callback: (chunk: SpeechChunk) => void): () => void;
  /**
   * Reports whether the runtime is currently eligible to auto-restart listening.
   *
   * WHY: Adapters sometimes need to decide whether to keep microphone capture alive after a spoken
   * reply, and that decision depends on both config and the current state.
   */
  shouldAutoRestart(): boolean;
  /**
   * Push a client audio chunk into the current STT turn.
   *
   * Chunks may be sent immediately, buffered for replay, or dropped when the runtime is in a state
   * that must not accept new user audio.
   */
  sendAudioChunk(chunk: AudioChunk): void;
  /**
   * Synthesize and speak a text reply immediately.
   *
   * WHY: This bypasses intent processing and is useful for adapters that need transport-level voice
   * prompts such as greetings, errors, or explicit confirmations.
   */
  speak(text: string, voice?: string): Promise<void>;
  /** Feed a client-owned VAD event into the runtime turn-boundary logic. */
  handleVADEvent(event: VADEvent): void;
  /** Permanently tear down the session, disconnect providers, and drop listeners. */
  destroy(): void;
}

/**
 * @deprecated Use `VoiceSessionState` instead.
 *
 * This alias remains only for package migration compatibility. New code should adopt the
 * `VoiceSession*` naming so the public API uses one consistent session vocabulary.
 */
export type VoiceProvisionState = VoiceSessionState;

/**
 * @deprecated Use `VoiceSessionCallbacks` instead.
 *
 * The package now treats "session" as the public concept. `VoiceProvisionCallbacks` will remain as
 * a source-compatible alias until downstream callers migrate.
 */
export type VoiceProvisionCallbacks = VoiceSessionCallbacks;

/** @deprecated Use `VoiceSessionIntentRequestOptions` instead. */
export type VoiceProvisionIntentRequestOptions =
  VoiceSessionIntentRequestOptions;

/** @deprecated Use `VoiceSessionIntentRequestBuilder` instead. */
export type VoiceProvisionIntentRequestBuilder =
  VoiceSessionIntentRequestBuilder;

/** @deprecated Use `VoiceSessionConfig` instead. */
export type VoiceProvisionConfig = VoiceSessionConfig;

/** @deprecated Use `ResolvedVoiceSessionConfig` instead. */
export type ResolvedVoiceProvisionConfig = ResolvedVoiceSessionConfig;

/** @deprecated Use `VoiceSession` instead. */
export type VoiceProvision = VoiceSession;

/**
 * @deprecated Use `resolveVoiceSessionConfig` instead.
 *
 * This value alias exists so older imports keep compiling while consumers move to the
 * `VoiceSession*` API names.
 */
export const resolveVoiceProvisionConfig = resolveVoiceSessionConfig;
