/**
 * Voice message types for Maelstrom protocol.
 *
 * These messages enable bidirectional audio streaming between
 * client and server over the same WebSocket connection used for
 * chart requests/responses.
 */

import type { ChartRequest, MaelstromResponse } from './protocol.js';

interface TimeEvent {
  /**
   * Timestamp in milliseconds since epoch
   * Should be sent by the emisor
   * */
  timestamp: number;
}

// ============================================================================
// The (non-bidirectional) event name of the events follows the pattern: {source}.{component}.{event} where:
// - source: 'client' or 'engine' (server)
// - component: 'audio_capture', 'stt', 'tts', 'voice', 'maelstrom', etc.
// - event: specific event name (e.g., 'audio_sent', 'transcript', 'ready')
// This naming convention allows for easy filtering and handling of events on both client and server sides.
// ============================================================================

// ============================================================================
// Audio Input (Client → Server)
// ============================================================================

/**
 * Audio chunk sent from client to server for transcription.
 * Sent continuously while user is speaking.
 */
export interface AudioInputMessage extends TimeEvent {
  type: 'client.audio_capture.audio_sent';
  /** Session identifier */
  sessionId: string;
  /** Audio data as bytes (opus-encoded recommended) */
  data: Uint8Array;
  /** Sample rate in Hz (e.g., 16000) */
  sampleRate: number;
  /** Encoding format (e.g., 'opus', 'pcm') */
  encoding: string;
  /** Sequence number for ordering chunks */
  sequence: number;
  /** Whether this is the final chunk of an utterance */
  isFinal: boolean;
}

/**
 * Request to start listening for voice input.
 * Client sends this to signal it will start sending audio chunks.
 */
export interface StartListeningMessage extends TimeEvent {
  type: 'client.audio_capture.ready';
  sessionId: string;
  /** Language hint for STT (e.g., 'en', 'es') */
  language?: string;
  /** Enable interim results (default: true) */
  interimResults?: boolean;
}

/**
 * Request to stop listening.
 * Client sends this to signal end of user speech.
 */
export interface StopListeningMessage extends TimeEvent {
  type: 'client.audio_capture.closed';
  sessionId: string;
}

// ============================================================================
// Transcription (Server → Client)
// ============================================================================

/**
 * Transcription result from STT.
 * Server sends this as audio is transcribed.
 */
export interface TranscriptMessage extends TimeEvent {
  type: 'engine.stt.transcript';
  sessionId: string;
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

// ============================================================================
// Audio Output (Server → Client)
// ============================================================================

/**
 * Audio chunk sent from server to client for playback.
 * Server sends this as TTS generates audio.
 */
export interface AudioOutputMessage extends TimeEvent {
  type: 'engine.tts.sent';
  sessionId: string;
  /** Audio data as bytes */
  data: Uint8Array;
  /** Audio format (e.g., 'opus', 'mp3') */
  format: string;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Text that this chunk represents (for word alignment) */
  text?: string;
  /** Sequence number for ordering chunks */
  sequence: number;
  /** Whether this is the final chunk */
  isFinal: boolean;
  /** We might consider some messages that cannot be cancelled. For example, legal disclaimers */
  cancellable?: boolean;
}

/**
 * Notification that speech output has started.
 */
export interface SpeechStartedMessage extends TimeEvent {
  type: 'client.audio_playback.started';
  sessionId: string;
  /** Full text being spoken */
  text: string;
  /** Voice ID used */
  voice?: string;
}

/**
 * Notification that speech output has stopped.
 */
export interface SpeechStoppedMessage extends TimeEvent {
  type: 'client.audio_playback.stopped';
  sessionId: string;
  /** Whether speech completed naturally or was interrupted */
  completed: boolean;
  /** Total duration of speech in seconds before it was interrupted */
  interruptedAfterSeconds?: number;
}

// ============================================================================
// Voice Control (Bidirectional)
// ============================================================================

/**
 * Voice state update.
 * Server sends this when voice state changes.
 */
export interface VoiceStateMessage extends TimeEvent {
  type: 'engine.voice.state';
  sessionId: string;
  /** Current voice session state */
  state: 'idle' | 'listening' | 'processing' | 'speaking';
  /** Previous state */
  previousState?: 'idle' | 'listening' | 'processing' | 'speaking';
}

// ============================================================================
// Maelstrom Integration (Bidirectional)
// ============================================================================

/**
 * Server signals that the WebSocket voice connection is ready.
 * Sent immediately after connection establishment.
 */
export interface VoiceReadyMessage extends TimeEvent {
  type: 'engine.stt.ready';
  sessionId: string;
}

/**
 * Server notifies client of an error in the voice pipeline.
 */
export interface VoiceErrorMessage extends TimeEvent {
  type: 'engine.error';
  sessionId: string;
  error: string;
}

/**
 * Client requests the server to speak a message and add it to conversation history.
 * Used for programmatic assistant messages (greetings, notifications, etc.)
 */
export interface SpeakMessageCommand extends TimeEvent {
  type: 'client.voice.speak';
  sessionId: string;
  /** Text to speak and add to history */
  text: string;
  /** Optional identifier to prevent duplicate messages (e.g., 'greeting') */
  dedupeKey?: string;
}

/**
 * Client requests the Maelstrom engine to process a chart request.
 * Allows voice interactions to trigger chart updates.
 */
export interface MaelstromProcessMessageCommand extends TimeEvent {
  type: 'client.maelstrom.process';
  request: ChartRequest;
}

/**
 * Server sends Maelstrom engine response to the client.
 * Contains the result of a chart processing request.
 */
export interface MaelstromResponseMessage {
  type: 'engine.maelstrom.response';
  sessionId: string;
  requestId: string;
  response: MaelstromResponse;
}

/**
 * VAD events sent from server to client when speech boundaries are detected.
 * Allows client to visualize speech activity in real-time.
 */
export interface VADSpeechStartMessage {
  type: 'client.vad.speech_start';
  sessionId: string;
  /** Timestamp when speech was detected */
  timestamp: number;
}

/**
 * VAD event sent when silence is detected after speech.
 * Allows client to visualize end of speech activity.
 */
export interface VADSpeechEndMessage {
  type: 'client.vad.speech_end';
  sessionId: string;
  /** Timestamp when silence was detected */
  timestamp: number;
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All voice-related messages that can be sent over the wire.
 */
export type VoiceMessage =
  | AudioInputMessage
  | StartListeningMessage
  | StopListeningMessage
  | TranscriptMessage
  | AudioOutputMessage
  | VADSpeechEndMessage
  | VADSpeechStartMessage
  | VoiceStateMessage
  | VoiceReadyMessage
  | VoiceErrorMessage
  | MaelstromProcessMessageCommand
  | MaelstromResponseMessage;

/**
 * Messages sent from client to server (voice-related).
 */
export type VoiceClientMessage =
  | AudioInputMessage
  | StartListeningMessage
  | StopListeningMessage
  | SpeakMessageCommand
  | VADSpeechStartMessage
  | VADSpeechEndMessage
  | MaelstromProcessMessageCommand;

/**
 * Messages sent from server to client (voice-related).
 */
export type VoiceServerMessage =
  | TranscriptMessage
  | AudioOutputMessage
  | VoiceStateMessage
  | VoiceReadyMessage
  | VoiceErrorMessage
  | SpeechStartedMessage
  | SpeechStoppedMessage
  | MaelstromResponseMessage;
