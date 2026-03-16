// @maelstrom-co/client-old — Voice-only APIs
// All non-voice functionality has moved to @maelstrom-co/client

// Re-export voice message types for convenience (still in protocol)
export type {
  AudioInputMessage,
  AudioOutputMessage,
  SpeechStartedMessage,
  SpeechStoppedMessage,
  StartListeningMessage,
  StopListeningMessage,
  TranscriptMessage,
  VADSpeechEndMessage,
  VADSpeechStartMessage,
  VoiceClientMessage,
  VoiceErrorMessage,
  VoiceMessage,
  VoiceReadyMessage,
  VoiceServerMessage,
  VoiceStateMessage,
} from '@maelstrom-co/protocol-old';

// Audio capture
export type { AudioCaptureOptions } from './lib/audio-capture/index.js';
export { AudioCapture } from './lib/audio-capture/index.js';
// Audio playback
export type { AudioPlaybackOptions } from './lib/audio-playback/index.js';
export { AudioPlayback } from './lib/audio-playback/index.js';
// Voice types
export type { VoiceConnector, VoiceSessionState } from './lib/types.js';
export { isVoiceConnector } from './lib/types.js';
// VAD
export { SileroVAD } from './lib/vad/silero-vad.js';
export type {
  VADConfig,
  VADEvent,
  VADEvents,
  VADState,
} from './lib/vad/types.js';
export type { VADStreamOptions } from './lib/vad/vad-processor.js';
export { VADProcessor } from './lib/vad/vad-processor.js';
// Voice Session
export type {
  VoiceSessionEvent,
  VoiceSessionOptions,
} from './lib/voice-session/index.js';
export { VoiceSession } from './lib/voice-session/index.js';
