/**
 * Voice provider types and interfaces for Maelstrom engine.
 *
 * This module defines the contracts for speech-to-text (STT) and
 * text-to-speech (TTS) providers that enable voice interactions.
 */

// ============================================================================
// Voice State Types
// ============================================================================

/**
 * Current state of a voice session.
 */
export type VoiceSessionState =
  | 'idle' // Waiting for user input
  | 'listening' // Recording user speech
  | 'processing' // Transcribing and processing
  | 'speaking'; // Playing AI response

/**
 * Voice mode determines how the conversation flows.
 *
 * - 'push-to-talk': User explicitly controls when to speak (hold button)
 * - 'continuous': Always listening, uses VAD to detect speech start/end
 * - 'auto': Automatically starts listening after AI finishes speaking
 */
export type VoiceMode = 'push-to-talk' | 'continuous' | 'auto';

/**
 * Voice Activity Detection (VAD) configuration.
 * Used primarily in 'continuous' mode to automatically detect speech.
 */
export interface VADConfig {
  /**
   * Silence threshold in milliseconds to trigger UtteranceEnd event.
   * Based on word timing analysis, not VAD. Requires interim_results=true.
   * When no words are detected for this duration, an UtteranceEnd message is sent.
   * @default 2500
   */
  utteranceEndMs?: number;

  /**
   * Endpointing silence threshold in milliseconds.
   * VAD-based detection that triggers speech_final=true on transcripts.
   * Set higher values (e.g., 1000-4000) to allow longer pauses.
   * Set to false to disable endpointing entirely.
   * @default 10 (Deepgram default, very aggressive)
   */
  endpointingMs?: number | false;

  /**
   * Whether to enable VAD events from the STT provider.
   * Some providers (like Deepgram) provide server-side VAD.
   * @default true
   */
  enabled?: boolean;

  /**
   * Minimum speech duration in milliseconds to consider as valid input.
   * Filters out short noises and false positives.
   * @default 250
   */
  minSpeechDurationMs?: number;
}

/**
 * Audio format configuration for voice streaming.
 */
export interface AudioFormatConfig {
  /** Input sample rate in Hz (microphone) @default 16000 */
  inputSampleRate?: number;
  /** Output sample rate in Hz (TTS playback) @default 24000 */
  outputSampleRate?: number;
  /** Input encoding format @default 'linear16' */
  inputEncoding?: 'linear16' | 'opus' | 'pcm';
  /** Output encoding format @default 'pcm_f32le' */
  outputEncoding?: 'pcm_f32le' | 'opus' | 'mp3';
  /** Buffer size for audio processing @default 4096 */
  bufferSize?: number;
}

/**
 * Configuration for voice interactions.
 */
export interface VoiceConfig {
  /** Speech-to-text provider */
  stt: STTProvider;
  /** Text-to-speech provider */
  tts: TTSProvider;
  /** Voice interaction mode (default: 'continuous') */
  mode?: VoiceMode;
  /** Language code (default: 'en') */
  language?: string;
  /** Enable interim transcription results (default: true) */
  interimResults?: boolean;
  /** Voice Activity Detection configuration (for continuous mode) */
  vad?: VADConfig;
  /** Audio format configuration */
  audio?: AudioFormatConfig;
  /** Maximum listening duration in ms before auto-stop (default: 30000) */
  maxListeningDurationMs?: number;
  /**
   * In continuous/auto mode, automatically restart listening after TTS finishes.
   * @default true
   */
  autoRestartListening?: boolean;
}

// ============================================================================
// STT (Speech-to-Text) Types
// ============================================================================

/**
 * Audio chunk for streaming STT.
 */
export interface AudioChunk {
  /** Audio data as bytes */
  data: Uint8Array;
  /** Sample rate in Hz (e.g., 16000) */
  sampleRate: number;
  /** Encoding format (e.g., 'linear16', 'opus') */
  encoding: string;
  /** Timestamp when chunk was recorded */
  timestamp: number;
  /** Sequence number for ordering (optional) */
  sequence?: number;
}

/**
 * Transcription result from STT provider.
 */
export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Whether this is the final result */
  isFinal: boolean;
  /** Confidence score (0-1) */
  confidence?: number;
  /** Language detected */
  language?: string;
  /** Duration of audio in seconds */
  durationInSeconds?: number;
}

/**
 * VAD event from STT provider.
 * Emitted when voice activity is detected or ends.
 */
export interface VADEvent {
  type: 'speech_start' | 'speech_end' | 'utterance_end';
  /** Timestamp of the event */
  timestamp: number;
  /** Duration of speech in ms (for speech_end/utterance_end) */
  durationMs?: number;
}

/**
 * Events emitted by STT provider.
 */
export type STTEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'transcript'; result: TranscriptionResult }
  | { type: 'vad'; event: VADEvent }
  | { type: 'error'; error: Error };

/**
 * Speech-to-text provider interface.
 *
 * Implement this to integrate with any STT service (Deepgram, OpenAI, etc.).
 */
export interface STTProvider {
  /** Provider name for identification */
  readonly name: string;

  /**
   * Connect to the STT service.
   * Must be called before sending audio chunks.
   */
  connect(config?: { language?: string; vad?: VADConfig }): Promise<void>;

  /**
   * Disconnect from the STT service.
   */
  disconnect(): Promise<void>;

  /**
   * Send an audio chunk for transcription.
   * @param chunk - Audio data chunk
   */
  sendAudio(chunk: AudioChunk): void;

  /**
   * Signal end of audio stream.
   * Triggers final transcription.
   */
  endStream(): void;

  /**
   * Subscribe to STT events.
   * @param callback - Event handler
   * @returns Unsubscribe function
   */
  onEvent(callback: (event: STTEvent) => void): () => void;

  /**
   * Check if provider is currently connected.
   */
  isConnected(): boolean;

  /**
   * Check if currently receiving/transcribing audio.
   */
  isListening(): boolean;
}

// ============================================================================
// TTS (Text-to-Speech) Types
// ============================================================================

/**
 * Audio output chunk from TTS provider.
 */
export interface SpeechChunk {
  /** Audio data as bytes */
  data: Uint8Array;
  /** Audio format (e.g., 'opus', 'mp3', 'pcm_f32le') */
  format: string;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Text that this chunk represents (for alignment) */
  text?: string;
  /** Whether this is the final chunk */
  isFinal: boolean;
  /** Sequence number for ordering */
  sequence?: number;
}

/**
 * Options for speech generation.
 */
export interface SpeechOptions {
  /** Voice ID or name */
  voice?: string;
  /** Speech rate (0.5 - 2.0, default: 1.0) */
  speed?: number;
  /** Language code */
  language?: string;
  /** Output sample rate (if provider supports multiple) */
  sampleRate?: number;
}

/**
 * Events emitted by TTS provider.
 */
export type TTSEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'started'; text: string }
  | { type: 'chunk'; chunk: SpeechChunk }
  | { type: 'completed' }
  | { type: 'stopped' }
  | { type: 'error'; error: Error };

/**
 * Text-to-speech provider interface.
 *
 * Implement this to integrate with any TTS service (Cartesia, ElevenLabs, etc.).
 */
export interface TTSProvider {
  /** Provider name for identification */
  readonly name: string;

  /**
   * Connect to the TTS service.
   * Must be called before sending text.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the TTS service.
   */
  disconnect(): Promise<void>;

  /**
   * Send text to be converted to speech.
   * Audio chunks will be emitted via events.
   * @param text - Text to speak
   * @param options - Speech options
   */
  speak(text: string, options?: SpeechOptions): void;

  /**
   * Stop current speech generation.
   */
  stop(): void;

  /**
   * Subscribe to TTS events.
   * @param callback - Event handler
   * @returns Unsubscribe function
   */
  onEvent(callback: (event: TTSEvent) => void): () => void;

  /**
   * Check if provider is currently connected.
   */
  isConnected(): boolean;

  /**
   * Check if currently generating speech.
   */
  isSpeaking(): boolean;
}

// ============================================================================
// Voice Engine Types
// ============================================================================

/**
 * Voice engine extends the base engine with voice capabilities.
 */
export interface VoiceEngine {
  /** Current voice session state */
  getVoiceState(): VoiceSessionState;

  /** Pre-connect STT provider to reduce latency on first startListening call */
  warmup(): Promise<void>;

  /** Start listening for user speech */
  startListening(): Promise<void>;

  /** Stop listening and process transcribed text */
  stopListening(): Promise<void>;

  /** Interrupt current AI speech */
  interrupt(): void;

  /** Subscribe to voice state changes */
  onVoiceStateChange(callback: (state: VoiceSessionState) => void): () => void;

  /** Subscribe to transcription updates */
  onTranscript(callback: (result: TranscriptionResult) => void): () => void;

  /** Subscribe to VAD events (speech start/end detection) */
  onVADEvent(callback: (event: VADEvent) => void): () => void;

  /** Subscribe to audio output chunks */
  onAudioOutput(callback: (chunk: SpeechChunk) => void): () => void;

  /**
   * In continuous/auto mode, check if engine should auto-restart listening.
   */
  shouldAutoRestart(): boolean;

  /**
   * Send audio chunk to STT provider.
   * Used by client-side audio capture to stream audio.
   */
  sendAudioChunk(chunk: AudioChunk): void;

  /**
   * Speak text using TTS provider.
   * @param text - Text to speak
   * @param voice - Optional voice ID override
   */
  speak(text: string, voice?: string): Promise<void>;

  /**
   * Process voice input and return response.
   * Waits for final transcription if still listening.
   */
  processVoiceInput(
    request: import('@maelstrom-co/protocol-old').ChartRequest,
  ): Promise<import('@maelstrom-co/protocol-old').MaelstromResponse>;

  /**
   * Handle a VAD event from the client.
   * The engine will react accordingly (barge-in, start/stop listening).
   * This centralizes VAD decision logic inside the engine rather than
   * requiring the transport layer to implement it.
   */
  handleVADEvent(event: VADEvent): void;

  /**
   * Cleanup resources and disconnect providers.
   */
  destroy(): void;
}

/**
 * Combined voice and transcript input for voice-enabled requests.
 */
export interface VoiceInput {
  /** Transcribed text from STT */
  text: string;
  /** Whether this is the final transcription */
  isFinal: boolean;
  /** Original audio data (optional, for storage) */
  audioData?: Uint8Array;
}

/**
 * Voice engine configuration with callbacks for integration.
 */
export interface VoiceEngineCallbacks {
  /** Called when voice state changes */
  onVoiceStateChange?: (state: VoiceSessionState) => void;
  /** Called when transcription updates */
  onTranscript?: (result: TranscriptionResult) => void;
  /** Called when VAD event occurs */
  onVADEvent?: (event: VADEvent) => void;
  /** Called when audio output is available */
  onAudioOutput?: (chunk: SpeechChunk) => void;
  /** Called when speech starts */
  onSpeechStarted?: (text: string) => void;
  /** Called when speech stops */
  onSpeechStopped?: (completed: boolean) => void;
  /** Called when speech is interrupted (e.g., user started talking) */
  onInterrupt?: (source: 'user' | 'system') => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}
