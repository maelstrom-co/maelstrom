/**
 * Voice message types for the Maelstrom wire protocol.
 *
 * These messages enable bidirectional audio streaming between client
 * and server over the same WebSocket connection used for chart
 * requests/responses.
 *
 * Event names follow `{source}.{component}.{event}` where source is
 * `client` or `engine`, component identifies the subsystem (e.g.,
 * `audio_capture`, `stt`, `tts`, `voice`, `maelstrom`), and event is
 * the specific signal.
 */

import type { ChartRequestMessage } from './engine-message.js';
import type { MaelstromResponse } from './response.js';

interface TimeEvent {
  /** Timestamp in milliseconds since epoch, set by the emitter. */
  timestamp: number;
}

// ============================================================================
// Audio Input (Client → Server)
// ============================================================================

/**
 * Audio chunk sent from client to server for transcription.
 * Sent continuously while user is speaking.
 */
export interface AudioInputMessage extends TimeEvent {
  type: 'client.audio_capture.audio_sent';
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
  data: Uint8Array;
  /** Audio format (e.g., 'opus', 'mp3') */
  format: string;
  sampleRate: number;
  /** Text that this chunk represents (for word alignment) */
  text?: string;
  sequence: number;
  isFinal: boolean;
  /** Some messages cannot be cancelled (e.g., legal disclaimers). */
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
  state: 'idle' | 'listening' | 'processing' | 'speaking';
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
 *
 * `requestId` is set when the error correlates to a specific
 * `client.maelstrom.process` request — clients use it to settle the
 * pending request promise instead of timing out.
 */
export interface VoiceErrorMessage extends TimeEvent {
  type: 'engine.error';
  sessionId: string;
  /** Correlation handle for chart_request errors. */
  requestId?: string;
  error: string;
}

/**
 * Client requests the server to speak a message and add it to conversation history.
 * Used for programmatic assistant messages (greetings, notifications, etc.)
 */
export interface SpeakMessageCommand extends TimeEvent {
  type: 'client.voice.speak';
  sessionId: string;
  /** Unique message identifier. Used for deduplication and history correlation. */
  id: string;
  /** Text to speak and add to history */
  text: string;
}

/**
 * Client requests adding an assistant message to conversation history
 * without triggering TTS. Used by non-voice connectors for programmatic
 * messages (greetings, notifications, etc.)
 */
export interface AddAssistantMessageCommand extends TimeEvent {
  type: 'client.history.add_assistant_message';
  sessionId: string;
  /** Unique message identifier. Used for deduplication and history correlation. */
  id: string;
  /** Text to add to conversation history */
  message: string;
}

/**
 * Client requests the Maelstrom engine to process a chart request.
 * Allows voice interactions to trigger chart updates.
 *
 * The `request` field carries a {@link ChartRequestMessage} envelope —
 * `id`, `sessionId`, and `timestamp` live on the envelope, with the inner
 * {@link import('./request.js').ChartRequest} payload nested under
 * `request.request`. The server uses the envelope id for response
 * correlation.
 */
export interface MaelstromProcessMessageCommand extends TimeEvent {
  type: 'client.maelstrom.process';
  request: ChartRequestMessage;
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
  timestamp: number;
}

/**
 * VAD event sent when silence is detected after speech.
 * Allows client to visualize end of speech activity.
 */
export interface VADSpeechEndMessage {
  type: 'client.vad.speech_end';
  sessionId: string;
  timestamp: number;
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All voice-related messages that can be sent over the wire.
 */
export type VoiceMessage = VoiceClientMessage | VoiceServerMessage;

/**
 * Messages sent from client to server (voice-related).
 */
export type VoiceClientMessage =
  | AudioInputMessage
  | StartListeningMessage
  | StopListeningMessage
  | SpeakMessageCommand
  | AddAssistantMessageCommand
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
