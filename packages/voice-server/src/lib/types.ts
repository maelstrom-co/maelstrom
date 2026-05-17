import type {
  ChartRequest,
  MaelstromResponse,
  SessionId,
} from '@maelstrom-co/protocol';
import type { STTProviderConfig } from './stt/registry.js';
import type { TTSProviderConfig } from './tts/registry.js';

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
 * Public circuit-breaker state for the STT reconnect subsystem.
 *
 * WHY: Reconnect health is a transport concern, not a conversational one. Exposing it separately
 * lets adapters surface degraded STT connectivity without inventing new `VoiceSessionState`
 * variants that would leak infrastructure detail into the UI-facing state machine.
 *
 * Transition semantics:
 * - `closed`: normal operation, no reconnect cooldown is active
 * - `open`: reconnect budget was exhausted and foreground STT entry points fail fast until cooldown
 * - `half_open`: cooldown expired and the next foreground STT connect acts as a single probe
 */
export type SttCircuitStatus = 'closed' | 'open' | 'half_open';

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
 * Stable classification attached to provider-originated STT/TTS failures.
 *
 * WHY: Consumers often need one small, provider-agnostic discriminator for retry, UX, and
 * telemetry decisions while keeping provider-specific detail in `cause`. Narrow provider-classified
 * errors by checking the shared `source`, `kind`, and `provider` fields on `VoiceSessionError`.
 *
 * This union intentionally mirrors the canonical provider-error-kind contract in
 * `@maelstrom-co/protocol`'s voice messages until that package re-exports the type from its public
 * root barrel.
 */
export type VoiceProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'transport'
  | 'parse'
  | 'server'
  | 'unknown';

/**
 * Shared metadata attached to provider-classified voice errors.
 *
 * WHY: Consumers often need to branch on the failure class without depending on provider SDK error
 * shapes. The package keeps the shared metadata intentionally small so provider-specific detail can
 * stay in `cause` and the stable contract remains source, provider, and kind.
 */
export interface VoiceProviderErrorBase {
  /** Whether the failure originated from STT or TTS provider transport. */
  source: 'stt' | 'tts';
  /** Stable provider identifier that emitted the error. */
  provider: string;
  /** Coarse-grained failure class for retry, UX, and telemetry decisions. */
  kind: VoiceProviderErrorKind;
  /** Original provider/SDK error when the classified wrapper had to normalize one. */
  cause?: unknown;
}

type STTErrorVariant<K extends VoiceProviderErrorKind> = Error &
  VoiceProviderErrorBase & {
    source: 'stt';
    kind: K;
  };

type TTSErrorVariant<K extends VoiceProviderErrorKind> = Error &
  VoiceProviderErrorBase & {
    source: 'tts';
    kind: K;
  };

/**
 * Classified provider error surfaced from STT boundaries.
 *
 * WHY: Public STT events need stable discrimination so downstream callers can distinguish
 * reconnectable transport issues from authentication, quota, parse, or server failures.
 */
export type STTError = {
  [K in VoiceProviderErrorKind]: STTErrorVariant<K>;
}[VoiceProviderErrorKind];

/**
 * Classified provider error surfaced from TTS boundaries.
 *
 * WHY: TTS failures often need different caller handling than generic runtime exceptions because a
 * transport loss mid-speech is user-visible even when the session itself survives.
 */
export type TTSError = {
  [K in VoiceProviderErrorKind]: TTSErrorVariant<K>;
}[VoiceProviderErrorKind];

/**
 * Errors that can cross the public runtime callback boundary.
 *
 * WHY: Most runtime failures are still regular `Error` objects, but provider-boundary failures carry
 * stable classification metadata through {@link STTError} and {@link TTSError}. Consumers can
 * narrow those cases by checking for the shared `source`, `kind`, and `provider` fields.
 */
export type VoiceSessionError = Error | STTError | TTSError;

/**
 * Runtime error raised when queued speech turns are dropped after a failed queued dispatch.
 *
 * WHY: `onError` primarily surfaces generic `Error` objects, but queued-turn loss carries one
 * extra structured datum (`droppedQueueCount`) that adapters may want to branch on without using
 * structural casts.
 */
export interface VoiceSessionQueuedTurnsDroppedError extends Error {
  droppedQueueCount: number;
}

/**
 * Narrow an `onError` payload to a queued-turn-drop error.
 *
 * WHY: This keeps the public callback contract discoverable for adapters that want to surface or
 * aggregate queued-turn loss without assuming every runtime error carries `droppedQueueCount`.
 */
export function isVoiceSessionQueuedTurnsDroppedError(
  error: unknown,
): error is VoiceSessionQueuedTurnsDroppedError {
  return (
    error instanceof Error &&
    typeof (error as { droppedQueueCount?: unknown }).droppedQueueCount ===
      'number'
  );
}

/**
 * Stable disconnect reasons surfaced by provider transport events.
 *
 * WHY: `clean` is kept for compatibility with existing callers, but a boolean alone does not make
 * the disconnect state self-describing. `reason` is the authoritative public discriminator so the
 * event cannot express incompatible transport states while callers that already branch on `clean`
 * keep working unchanged.
 */
export type VoiceDisconnectReason =
  | 'clean_shutdown'
  | 'idle_timeout'
  | 'transport_lost';

/**
 * Shared provider disconnect payload.
 *
 * WHY: Providers need to distinguish expected clean shutdowns from clean-but-recoverable idle
 * timeouts and unclean transport loss. The discriminated union keeps that state coherent while
 * preserving the existing `clean` mirror and human-readable `message` field for compatibility.
 */
export type VoiceDisconnectedEvent =
  | {
      type: 'disconnected';
      clean: true;
      reason: 'clean_shutdown' | 'idle_timeout';
      /** Diagnostic provider text. `reason` is the authoritative state discriminator. */
      message: string;
    }
  | {
      type: 'disconnected';
      clean: false;
      reason: 'transport_lost';
      /** Diagnostic provider text. `reason` is the authoritative state discriminator. */
      message: string;
    };

/**
 * Events emitted by the STT provider.
 *
 * WHY: The STT provider is a black box. It connects to external services
 * (Deepgram, Google STT) and emits events when something happens.
 * These events let the voice session runtime react to provider state changes without depending
 * on provider-specific SDK details.
 * - disconnected: transport shutdown/loss state for provider lifecycle and reconnect logic
 * - transcript: recognition state for interim/final utterance assembly
 * - error: failure state that should be surfaced without crashing the whole session
 */
export type STTEvent =
  | VoiceDisconnectedEvent
  | { type: 'transcript'; result: TranscriptionResult }
  | { type: 'error'; error: STTError };

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
 * Parameters for a single speech turn.
 *
 * Shared by `speak()`, `enqueueSpeak()`, and the internal queued-turn path so turn payload
 * changes stay aligned across the public API and the runtime queue.
 */
export interface SpeakParams {
  text: string;
  voice?: string;
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
  /** `true` when this turn was dequeued from `speakQueue` rather than replacing active speech. */
  queued?: boolean;
}

/**
 * Terminal outcome for a single TTS synthesis request.
 *
 * WHY: Providers may stop speaking either because synthesis completed normally or because the turn
 * was interrupted. The runtime needs an explicit distinction so it can keep owning
 * `onSpeechStopped(true | false)` without depending on provider-specific event names.
 */
export type SpeechStopReason = 'completed' | 'stopped';

/**
 * Deterministic handle returned when a provider begins speech synthesis.
 *
 * WHY: The runtime needs stable turn metadata immediately, plus a terminal promise it can await or
 * ignore when a newer speak generation supersedes the old one. Keeping both pieces together makes
 * the provider contract explicit without reintroducing positive lifecycle events.
 */
export interface SpeechSynthesisHandle {
  speech: SpeechStart;
  /**
   * Terminal outcome for this synthesis request.
   *
   * WHY: The public contract is intentionally non-rejecting. Callers should observe `'completed'`
   * or `'stopped'` here, while provider/runtime failures continue to surface through the normal TTS
   * event and callback error channels instead of widening this promise into a second error path.
   */
  completion: Promise<SpeechStopReason>;
}

/**
 * Reasons the runtime may drop buffered client audio instead of replaying it.
 *
 * WHY: Audio can arrive while the STT side is still connecting or reconnecting. The public contract
 * needs to distinguish whether the buffer filled before the first provider connection or during a
 * later reconnect so adapters can trace startup pressure separately from recovery pressure.
 */
export type VoiceSessionAudioDropReason =
  /** Buffer overflowed before STT was first connected for this session. */
  | 'pre_connection_buffer_full'
  /** Buffer overflowed while STT was reconnecting after a mid-session disconnect. */
  | 'reconnect_buffer_full'
  /** Audio arrived while the runtime was in a state that must not accept new STT input. */
  | 'state_not_listening'
  /** Audio was buffered after a live STT send failed while the transport still appeared connected. */
  | 'stt_send_failed';

/**
 * Metadata emitted when buffered client audio is dropped.
 *
 * WHY: Downstream transports and observability hooks care about how much user audio was discarded,
 * but this task intentionally keeps the contract at the duration level rather than exposing any
 * runtime-internal queue representation.
 */
export interface VoiceSessionAudioDroppedEvent {
  /** Stable event discriminator for callback/listener consumers. */
  type: 'audio_dropped';
  /** Why the runtime could not accept or retain this client audio. */
  reason: VoiceSessionAudioDropReason;
  /**
   * Total measurable dropped client-audio duration represented by this emitted debounce bucket, in milliseconds.
   *
   * Repeated measurable drops with the same reason are accumulated into one emitted bucket until the
   * bucket is delivered, after which the accumulated value resets. A reason change flushes the
   * previous bucket immediately and starts a new bucket for the new reason. The runtime only emits
   * this event when the accumulated value is strictly greater than zero, so loss paths that cannot
   * measure duration precisely are reported through `onError` and trace hooks instead of
   * synthesizing a best-effort duration here.
   */
  droppedDurationMs: number;
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
 * - disconnected: transport shutdown/loss state for provider lifecycle
 * - chunk: audio payload for playback, optionally streamed incrementally
 * - error: failure state that should surface to the caller and end the turn safely
 */
export type TTSEvent =
  | VoiceDisconnectedEvent
  | { type: 'chunk'; chunk: SpeechChunk }
  | { type: 'error'; error: TTSError };

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
  speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle;
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
  /**
   * Called when buffered client audio is discarded instead of being replayed into STT.
   *
   * WHY: This is the structured telemetry hook for user-audio loss. It stays optional so existing
   * adapters do not need to adopt drop accounting immediately, but when present it is the most
   * precise signal for measurable overflow-, state-, and replay-related loss. This callback is
   * intentionally more selective than `onError`: only measurable dropped-duration buckets are
   * delivered here, and they may be debounced/coalesced before emission.
   */
  onAudioDropped?: (event: VoiceSessionAudioDroppedEvent) => void;
  /** Called when a new spoken turn starts and playback setup can begin. */
  onSpeechStarted?: (speech: SpeechStart) => void;
  /**
   * Called when the active spoken turn stops.
   *
   * Fires once per spoken turn, including turns reached through the queued successor chain. Use
   * `getVoiceState() === 'idle'` as the reliable signal that the full speech chain has ended.
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
   * often run inside long-lived server transports. This channel is not debounced: repeated overflow
   * or transport failures may surface here more frequently than `onAudioDropped`, and some loss
   * paths that cannot measure dropped duration precisely are only reported through this callback.
   * During STT reconnect loops, retryable reconnect failures are intentionally surfaced only once:
   * callers receive the first retryable failure before exhaustion rather than every failed retry
   * attempt.
   */
  onError?: (error: VoiceSessionError) => void;
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
  stt: STTProviderConfig;
  tts: TTSProviderConfig;
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
  /**
   * Delay, in milliseconds, to wait for a transcript after VAD ends with no text before returning the runtime to idle.
   *
   * Defaults to `1500` and must be a finite non-negative number. `0` still uses the grace-expiry
   * path on the next tick, so late STT text can win that race without turning the VAD-end path into
   * a synchronous bypass.
   */
  transcriptGraceMs?: number;
  /**
   * Maximum client-audio duration, in milliseconds, to buffer while the STT transport is not ready.
   *
   * WHY: The runtime keeps a FIFO reconnect/startup buffer so short STT outages do not immediately
   * erase user speech. Once the total buffered duration would exceed this cap, the oldest retained
   * audio is dropped first. If a single chunk is itself larger than the cap, the runtime rejects the
   * entire chunk after draining the queue.
   *
   * This applies both before the first provider connection and during mid-session reconnects.
   * Defaults to `1000` and must be a finite number strictly greater than zero.
   */
  audioBufferMaxMs?: number;
  /**
   * Maximum consecutive STT reconnect attempts for retryable reconnect classes.
   *
   * WHY: This cap applies to retryable classes such as `transport`, `parse`, and `unknown`.
   * Certain error classes intentionally override it: `auth` and `quota` remain terminal with no
   * reconnect attempts, while `server` stays capped to a single retry even if this configured value
   * is larger.
   */
  maxReconnectAttempts?: number;
  /** Delay, in milliseconds, between STT reconnect attempts. */
  reconnectDelayMs?: number;
  /**
   * Upper bound, in milliseconds, for reconnect backoff delays after exponential growth.
   *
   * WHY: Backoff starts from `reconnectDelayMs`, but this cap keeps retry latency bounded during
   * sustained outages and also limits the jitter headroom available on each attempt.
   */
  maxReconnectDelayMs?: number;
  /**
   * Unitless multiplier applied to each reconnect attempt before max-delay clamping.
   *
   * WHY: This controls the exponential growth curve without changing the base delay. Values below
   * `1` are invalid because the reconnect delay must stay flat or increase across attempts.
   */
  reconnectBackoffMultiplier?: number;
  /**
   * Maximum jitter window, in milliseconds, added within the remaining headroom under
   * `maxReconnectDelayMs`.
   *
   * WHY: Randomized jitter reduces synchronized reconnect spikes across many sessions while keeping
   * the retry envelope inside the same bounded backoff limit.
   */
  reconnectJitterMs?: number;
  /**
   * Cooldown window, in milliseconds, before an open STT circuit becomes half-open again.
   *
   * WHY: The circuit breaker prevents rapid reconnect churn after sustained failures, then allows a
   * probe reconnect after this timeout to test whether the provider has recovered.
   */
  circuitBreakerTimeoutMs?: number;
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
  /** Grace window used to wait for a transcript after VAD ends with no text before the runtime returns to idle, including `0` as a next-tick fallback rather than a synchronous bypass. */
  transcriptGraceMs: number;
  /** Maximum client-audio duration, in milliseconds, that may queue while STT is not ready. */
  audioBufferMaxMs: number;
  /** Maximum consecutive STT reconnect attempts before the runtime gives up. */
  maxReconnectAttempts: number;
  /** Delay between reconnect attempts after an STT disconnect. */
  reconnectDelayMs: number;
  /** Maximum reconnect delay after exponential growth and max-delay clamping are applied. */
  maxReconnectDelayMs: number;
  /** Unitless multiplier used to grow successive reconnect delays. */
  reconnectBackoffMultiplier: number;
  /** Maximum reconnect jitter window applied within the bounded backoff headroom. */
  reconnectJitterMs: number;
  /** Circuit-breaker cooldown before an open STT circuit is allowed to probe again. */
  circuitBreakerTimeoutMs: number;
  /** Optional trace sink for observability hooks. */
  trace?: (event: string, details?: Record<string, unknown>) => void;
  /** Intent-processing boundary, or `null` when the runtime should stay transport-only. */
  intentBoundary: VoiceSessionIntentBoundaryConfig | null;
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
   * Read the current STT reconnect circuit-breaker status.
   *
   * WHY: Reconnect health is exposed separately from `VoiceSessionState` so adapters can inspect
   * transport recovery state without inventing extra conversation-state variants.
   *
   * Status semantics:
   * - `closed`: STT can connect normally
   * - `open`: the reconnect budget was exhausted, and `warmup()` / `startListening()` reject until
   *   the cooldown advances the circuit
   * - `half_open`: the cooldown elapsed, and the next foreground connect is treated as a probe that
   *   closes the circuit on success or re-opens it on failure
   */
  getSttCircuitStatus(): SttCircuitStatus;
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
  /**
   * Subscribe to STT circuit-breaker status changes.
   *
   * WHY: Subscription synchronously replays the current circuit status, then remains registered for
   * future real transitions. That gives adapters immediate state on subscribe without waiting for
   * the next reconnect event.
   *
   * Replay and dedupe semantics:
   * - subscribing immediately calls `callback` once with the current status, even if nothing just
   *   changed
   * - after that replay, callbacks run only for real status transitions because duplicate writes are
   *   suppressed inside the runtime
   *
   * Example:
   * ```ts
   * const seen: SttCircuitStatus[] = [];
   * const unsubscribe = session.onSttCircuitStatusChange((status) => {
   *   seen.push(status);
   * });
   *
   * // If the circuit is currently closed, `seen` is already ['closed'] here.
   * // Later transitions append values like 'open', 'half_open', and 'closed'.
   * ```
   */
  onSttCircuitStatusChange(
    callback: (status: SttCircuitStatus) => void,
  ): () => void;
  /** Subscribe to transcript forwarding events. */
  onTranscript(callback: (result: TranscriptionResult) => void): () => void;
  /** Subscribe to client-owned VAD events after they reach the runtime. */
  onVADEvent(callback: (event: VADEvent) => void): () => void;
  /** Subscribe to TTS chunks that should be forwarded to playback. */
  onAudioOutput(callback: (chunk: SpeechChunk) => void): () => void;
  /**
   * Subscribe to buffered-client-audio drop notifications.
   *
   * WHY: This is the precise loss-accounting hook for adapters that need telemetry, alerts, or UX
   * around discarded user audio. Events are coalesced for roughly 100 ms, `droppedDurationMs`
   * aggregates the total measurable loss inside that bucket, and a new drop `reason` flushes the
   * previous bucket immediately before a new one begins. Listener and callback throws are isolated
   * and routed through `onError`, pending debounced events are dropped when the session is
   * destroyed, and loss paths without a trustworthy duration measurement are reported through
   * `onError`/trace only rather than emitting a synthetic `audio_dropped` event.
   *
   * @example
   * const unsubscribe = voiceSession.onAudioDropped((event) => {
   *   metrics.count('voice.audio_dropped', 1, { reason: event.reason });
   *   metrics.histogram('voice.audio_dropped_ms', event.droppedDurationMs);
   * });
   */
  onAudioDropped(
    callback: (event: VoiceSessionAudioDroppedEvent) => void,
  ): () => void;
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
   * Synthesize and speak `text`, queuing it behind any currently active speech turn.
   *
   * - If the runtime is currently `speaking`, or a queued successor is still waiting on the async
   *   TTS-connect gap before it can start, appends to the internal FIFO queue.
   * - Otherwise dispatches immediately (equivalent to calling `speak()`), including while the
   *   runtime is `idle`, `listening`, or `processing`.
   * - Unlike `speak()`, does **not** interrupt active speech or clear pending queued turns.
   * - Silent no-op when the session is destroyed or `text` is blank after trimming.
   *   Blank/whitespace-only input does not clear active speech or pending queued turns.
   * - Unlike `speak()`, calling `enqueueSpeak()` after `destroy()` does not throw.
   * - When called while the runtime is `processing`, dispatch is immediate rather than waiting for
   *   the intent-processing pipeline to finish.
   * - Queued turns are still cancelled by replacement `speak()`, `interrupt()`, `destroy()`, and
   *   intent-processing preemption.
   *
   * WHY: Prefer this over `speak()` when the caller wants to chain successive turns without
   * interrupting the current one — for example, multi-sentence responses from a streaming source.
   * Callers that need a strict "only after the current intent-processing pipeline finishes"
   * contract should gate on `getVoiceState()` rather than assuming `enqueueSpeak()` waits for the
   * `processing` state to complete.
   */
  enqueueSpeak(text: string, voice?: string): void;

  /**
   * Synthesize and speak a text reply immediately, replacing any active or queued speech.
   *
   * - Stops any currently active speech turn.
   * - Clears all pending queued turns added via `enqueueSpeak()`.
   * - Dispatches the new turn immediately.
   * - Silent no-op when `text` is blank after trimming (active speech and queued turns are
   *   *not* cleared in that case, including blank/whitespace-only input).
   * - Throws `Error('Cannot speak after destroy()')` if called after `destroy()`.
   *   Use `enqueueSpeak()` instead if the caller needs destroyed-session calls to be ignored.
   *
   * WHY: This bypasses intent processing and is useful for adapters that need transport-level voice
   * prompts such as greetings, errors, or explicit confirmations where replacement semantics are
   * correct (the new turn supersedes whatever was in progress).
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
