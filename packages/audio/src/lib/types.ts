// ============================================================================
// STT (Speech-to-Text) Types
// ============================================================================

/** Configuration for STT providers */
export interface STTConfig {
  /** Language code (e.g., 'en-US', 'es-ES') */
  language?: string;
  /** Enable continuous recognition (vs single utterance) */
  continuous?: boolean;
  /** Enable interim results during recognition */
  interimResults?: boolean;
  /** Maximum recording duration in ms (0 = unlimited) */
  maxDuration?: number;
}

/** Result from speech transcription */
export interface TranscriptionResult {
  /** The transcribed text */
  text: string;
  /** Whether this is a final result (vs interim) */
  isFinal: boolean;
  /** Confidence score (0-1), if available */
  confidence?: number;
  /** Detected language, if available */
  language?: string;
  /** Duration in seconds, if available */
  durationInSeconds?: number;
  /** Segment-level transcription, if available */
  segments?: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  text: string;
  startSecond: number;
  endSecond: number;
}

/** Events emitted during STT */
export type STTEvent =
  | { type: 'start' }
  | { type: 'result'; result: TranscriptionResult }
  | { type: 'end'; finalTranscript: string }
  | { type: 'error'; error: Error };

/** Abstract STT provider interface (real-time, event-based) */
export interface STTProvider {
  /** Start listening for speech */
  start(config?: STTConfig): void;

  /** Stop listening */
  stop(): void;

  /** Abort recognition without processing */
  abort(): void;

  /** Subscribe to STT events */
  onEvent(callback: (event: STTEvent) => void): () => void;

  /** Check if currently listening */
  isListening(): boolean;

  /** Check if this provider is available in current environment */
  isAvailable(): boolean;
}

/** Options for one-shot transcription */
export interface TranscribeOptions {
  language?: string;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

/** One-shot transcription provider (for file/buffer transcription) */
export interface TranscriptionProvider {
  /**
   * Transcribe audio data to text
   * @param audio - Audio data (Uint8Array, ArrayBuffer, or URL)
   * @param options - Transcription options
   */
  transcribe(
    audio: Uint8Array | ArrayBuffer | URL | string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult>;
}

// ============================================================================
// TTS (Text-to-Speech) Types
// ============================================================================

/** Configuration for TTS providers */
export interface TTSConfig {
  /** Voice identifier */
  voice?: string;
  /** Language code */
  language?: string;
  /** Speech rate (0.1 - 10, default 1) */
  rate?: number;
  /** Pitch (0 - 2, default 1) */
  pitch?: number;
  /** Volume (0 - 1, default 1) */
  volume?: number;
  /** Output audio format (for server-side TTS) */
  outputFormat?: 'mp3' | 'wav' | 'ogg' | 'opus';
}

/** Voice information */
export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  /** Whether this is a local (client-side) voice */
  isLocal?: boolean;
}

/** Events emitted during TTS */
export type TTSEvent =
  | { type: 'start' }
  | { type: 'word'; charIndex: number; charLength?: number }
  | { type: 'sentence'; sentenceIndex: number }
  | { type: 'end' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'error'; error: Error };

/** Abstract TTS provider interface - for streaming/direct playback */
export interface TTSProvider {
  /** Speak text aloud */
  speak(text: string, config?: TTSConfig): void;

  /** Stop speaking */
  stop(): void;

  /** Pause speaking */
  pause(): void;

  /** Resume speaking */
  resume(): void;

  /** Subscribe to TTS events */
  onEvent(callback: (event: TTSEvent) => void): () => void;

  /** Check if currently speaking */
  isSpeaking(): boolean;

  /** Get available voices */
  getVoices(): Promise<VoiceInfo[]>;

  /** Check if this provider is available in current environment */
  isAvailable(): boolean;
}

/** Options for one-shot speech generation */
export interface SpeechGenerationOptions {
  voice?: string;
  language?: string;
  outputFormat?: 'mp3' | 'wav' | 'ogg' | 'opus';
  speed?: number;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

/** Result from speech generation */
export interface SpeechGenerationResult {
  /** Raw audio data */
  audioData: Uint8Array;
  /** Audio format */
  format: string;
  /** Duration in seconds, if known */
  durationInSeconds?: number;
}

/** One-shot speech generation provider (for generating audio data) */
export interface SpeechGenerationProvider {
  /**
   * Generate speech audio from text
   * @param text - Text to convert to speech
   * @param options - Generation options
   */
  generateSpeech(
    text: string,
    options?: SpeechGenerationOptions,
  ): Promise<SpeechGenerationResult>;
}

