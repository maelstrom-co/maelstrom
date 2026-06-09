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

import { z } from 'zod';

import type { Mutable } from './_drift-guards.js';
import type { ChartRequestMessage } from './engine-message.js';
import { ChartRequestMessageSchema } from './engine-message.js';
import type { MessageId } from './message.js';
import { MessageIdSchema } from './message.js';
import type { MaelstromResponse } from './response.js';
import type { SessionId } from './session.js';
import { SessionIdSchema } from './session.js';

export const voiceProviderErrorKinds = [
  'auth',
  'quota',
  'transport',
  'parse',
  'server',
  'unknown',
] as const;

export type VoiceProviderErrorKind = (typeof voiceProviderErrorKinds)[number];

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
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  /**
   * When `true`, this turn came from the queued-successor path rather than a replacement turn.
   * The client should NOT interrupt playback on receipt.
   */
  queued?: boolean;
}

/**
 * Notification that speech output has started.
 */
export interface SpeechStartedMessage extends TimeEvent {
  type: 'client.audio_playback.started';
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  sessionId: SessionId;
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
  sessionId: SessionId;
  requestId?: MessageId;
  error: string;
  kind?: VoiceProviderErrorKind;
  source?: 'stt' | 'tts';
  provider?: string;
}

/**
 * Client requests the server to speak a message and add it to conversation history.
 * Used for programmatic assistant messages (greetings, notifications, etc.)
 */
export interface SpeakMessageCommand extends TimeEvent {
  type: 'client.voice.speak';
  sessionId: SessionId;
  /** Unique message identifier. Used for deduplication and history correlation. */
  id: MessageId;
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
  sessionId: SessionId;
  /** Unique message identifier. Used for deduplication and history correlation. */
  id: MessageId;
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
  sessionId: SessionId;
  requestId: MessageId;
  response: MaelstromResponse;
}

/**
 * VAD event sent from client to server when local VAD detects the start of
 * user speech. Lets the server track speech boundaries for processing.
 */
export interface VADSpeechStartMessage {
  type: 'client.vad.speech_start';
  sessionId: SessionId;
  timestamp: number;
}

/**
 * VAD event sent from client to server when local VAD detects the end of
 * user speech (silence threshold met). Lets the server finalize the turn.
 */
export interface VADSpeechEndMessage {
  type: 'client.vad.speech_end';
  sessionId: SessionId;
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

// ============================================================================
// Wire-format Zod parsers
//
// These validate JSON-deserialized voice frames at the wire boundary. Like
// `EngineMessageSchema` / `SessionHistoryEntrySchema`, the schema's job is to
// enforce the *envelope* contract — the discriminator, a finite timestamp,
// and (critically) the branded `sessionId` / `id` / `requestId` fields, which
// `JSON.parse` would otherwise hand to consumers as forged brands. Payload
// bodies are validated only as deep as that contract requires:
//
//  - `engine.maelstrom.response`'s `response` is accepted as an opaque
//    `MaelstromResponse` object (non-null object, shape unchecked). No client
//    connector validates the response body today — `HttpConnector` casts it,
//    the WS connectors resolve the correlator with the raw frame — because the
//    engine validates its own LLM output before assembling the response. The
//    branded `requestId` redundancy with the inner `response.requestId` is
//    intentionally left alone (out of scope).
//  - The audio frames' `data` fields (`client.audio_capture.audio_sent`,
//    `engine.tts.sent`) are opaque: a `Uint8Array` can't round-trip JSON and
//    no consumer reads it — the audio bytes arrive as separate binary frames,
//    and the JSON frame carries only the surrounding metadata.
// ============================================================================

const finiteTimestamp = z
  .number()
  .refine(Number.isFinite, { message: 'timestamp must be a finite number' });

// Binary payloads (`AudioInputMessage.data` / `AudioOutputMessage.data`) are
// modeled as opaque: a `Uint8Array` does not survive `JSON.stringify`/`parse`
// (it serializes to an index-keyed object), and no consumer reads the field —
// the actual audio bytes travel as separate binary `ArrayBuffer` frames. The
// `engine.tts.sent` / `client.audio_capture.audio_sent` JSON frames carry only
// the surrounding metadata. `z.custom` types the field as `Uint8Array` for the
// drift guard while accepting whatever the wire delivers.
const opaqueBinary = z.custom<Uint8Array>();

const voiceStateValues = [
  'idle',
  'listening',
  'processing',
  'speaking',
] as const;

// --- Client → server --------------------------------------------------------

const AudioInputMessageSchema = z.object({
  type: z.literal('client.audio_capture.audio_sent'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  data: opaqueBinary,
  sampleRate: z.number(),
  encoding: z.string(),
  sequence: z.number(),
  isFinal: z.boolean(),
});

const StartListeningMessageSchema = z.object({
  type: z.literal('client.audio_capture.ready'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  language: z.string().optional(),
  interimResults: z.boolean().optional(),
});

const StopListeningMessageSchema = z.object({
  type: z.literal('client.audio_capture.closed'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
});

const SpeakMessageCommandSchema = z.object({
  type: z.literal('client.voice.speak'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  id: MessageIdSchema,
  text: z.string(),
});

const AddAssistantMessageCommandSchema = z.object({
  type: z.literal('client.history.add_assistant_message'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  id: MessageIdSchema,
  message: z.string(),
});

const VADSpeechStartMessageSchema = z.object({
  type: z.literal('client.vad.speech_start'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
});

const VADSpeechEndMessageSchema = z.object({
  type: z.literal('client.vad.speech_end'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
});

const MaelstromProcessMessageCommandSchema = z.object({
  type: z.literal('client.maelstrom.process'),
  timestamp: finiteTimestamp,
  request: ChartRequestMessageSchema,
});

/**
 * Wire-format Zod parser for the {@link VoiceClientMessage} discriminated
 * union. Dispatches on `type` and validates each variant's envelope —
 * branded `sessionId` / `id`, finite `timestamp`, and the inner
 * `ChartRequestMessage` for `client.maelstrom.process`. The `data` field of
 * `client.audio_capture.audio_sent` is opaque (see `opaqueBinary`).
 */
export const VoiceClientMessageSchema = z.discriminatedUnion('type', [
  AudioInputMessageSchema,
  StartListeningMessageSchema,
  StopListeningMessageSchema,
  SpeakMessageCommandSchema,
  AddAssistantMessageCommandSchema,
  VADSpeechStartMessageSchema,
  VADSpeechEndMessageSchema,
  MaelstromProcessMessageCommandSchema,
]);

// --- Server → client --------------------------------------------------------

const AudioOutputMessageSchema = z.object({
  type: z.literal('engine.tts.sent'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  data: opaqueBinary,
  format: z.string(),
  sampleRate: z.number(),
  text: z.string().optional(),
  sequence: z.number(),
  isFinal: z.boolean(),
  cancellable: z.boolean().optional(),
  queued: z.boolean().optional(),
});

const TranscriptMessageSchema = z.object({
  type: z.literal('engine.stt.transcript'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  text: z.string(),
  isFinal: z.boolean(),
  confidence: z.number().optional(),
  language: z.string().optional(),
  durationInSeconds: z.number().optional(),
});

const VoiceStateMessageSchema = z.object({
  type: z.literal('engine.voice.state'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  state: z.enum(voiceStateValues),
  previousState: z.enum(voiceStateValues).optional(),
});

const VoiceReadyMessageSchema = z.object({
  type: z.literal('engine.stt.ready'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
});

const VoiceErrorMessageSchema = z.object({
  type: z.literal('engine.error'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  requestId: MessageIdSchema.optional(),
  error: z.string(),
  kind: z.enum(voiceProviderErrorKinds).optional(),
  source: z.enum(['stt', 'tts']).optional(),
  provider: z.string().optional(),
});

const SpeechStartedMessageSchema = z.object({
  type: z.literal('client.audio_playback.started'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  text: z.string(),
  voice: z.string().optional(),
});

const SpeechStoppedMessageSchema = z.object({
  type: z.literal('client.audio_playback.stopped'),
  sessionId: SessionIdSchema,
  timestamp: finiteTimestamp,
  completed: z.boolean(),
  interruptedAfterSeconds: z.number().optional(),
});

const MaelstromResponseMessageSchema = z.object({
  type: z.literal('engine.maelstrom.response'),
  sessionId: SessionIdSchema,
  requestId: MessageIdSchema,
  response: z.custom<MaelstromResponse>(
    (value) => typeof value === 'object' && value !== null,
    { message: 'response must be a MaelstromResponse object' },
  ),
});

/**
 * Wire-format Zod parser for the {@link VoiceServerMessage} discriminated
 * union. Dispatches on `type` and validates each variant's envelope — branded
 * `sessionId`, and where the variant carries them, branded `requestId` and a
 * finite `timestamp` (`engine.maelstrom.response` has no timestamp; `requestId`
 * is optional on `engine.error`). The `engine.maelstrom.response` `response`
 * payload is validated only as a non-null object, and `engine.tts.sent`'s
 * `data` is opaque; their inner shapes are the engine's contract (see the
 * section comment above).
 */
export const VoiceServerMessageSchema = z.discriminatedUnion('type', [
  TranscriptMessageSchema,
  AudioOutputMessageSchema,
  VoiceStateMessageSchema,
  VoiceReadyMessageSchema,
  VoiceErrorMessageSchema,
  SpeechStartedMessageSchema,
  SpeechStoppedMessageSchema,
  MaelstromResponseMessageSchema,
]);

// ---------------------------------------------------------------------------
// Drift guards. `Mutable<T>` (from `./_drift-guards.js`) strips `readonly`
// because `z.infer` does not synthesize it. `_Comparable<M>` distributes over
// each union arm and drops the fields the schema models more loosely than the
// hand-written type, by design:
//
//  - audio `data` (`client.audio_capture.audio_sent`, `engine.tts.sent`) — an
//    opaque `Uint8Array` (see `opaqueBinary`); `Mutable<Uint8Array>` would
//    explode into a string/typed-array mapped type. Not a brand.
//  - `MaelstromProcessMessageCommand.request` — validated by
//    `ChartRequestMessageSchema`, which owns the inner `request.layout`
//    branding asymmetry and is drift-guarded where that schema is defined.
//    Re-checking it here would just duplicate that guard.
//  - `MaelstromResponseMessage.response` — an opaque `MaelstromResponse` whose
//    `readonly` arrays don't survive `Mutable`'s round-trip; its shape is the
//    engine's contract, not this schema's.
//
// What remains — every branded envelope field plus the finite `timestamp` — is
// checked in both directions.
// ---------------------------------------------------------------------------

type _Comparable<M> = M extends {
  type: 'client.audio_capture.audio_sent' | 'engine.tts.sent';
}
  ? Omit<M, 'data'>
  : M extends { type: 'client.maelstrom.process' }
    ? Omit<M, 'request'>
    : M extends { type: 'engine.maelstrom.response' }
      ? Omit<M, 'response'>
      : M;

type _WireVoiceClientMessage = _Comparable<VoiceClientMessage>;
type _InferredVoiceClientMessage = _Comparable<
  z.infer<typeof VoiceClientMessageSchema>
>;
const _vcmFwd: _InferredVoiceClientMessage extends Mutable<_WireVoiceClientMessage>
  ? true
  : false = true;
const _vcmBwd: Mutable<_WireVoiceClientMessage> extends _InferredVoiceClientMessage
  ? true
  : false = true;

type _WireVoiceServerMessage = _Comparable<VoiceServerMessage>;
type _InferredVoiceServerMessage = _Comparable<
  z.infer<typeof VoiceServerMessageSchema>
>;
const _vsmFwd: _InferredVoiceServerMessage extends Mutable<_WireVoiceServerMessage>
  ? true
  : false = true;
const _vsmBwd: Mutable<_WireVoiceServerMessage> extends _InferredVoiceServerMessage
  ? true
  : false = true;

void [_vcmFwd, _vcmBwd, _vsmFwd, _vsmBwd];
