// Browser voice extension.
export { liveKitVoice, createSpeakTransport } from './livekit-voice.js';
export type {
  GetLiveKitToken,
  LiveKitVoiceOptions,
  VoiceConfig,
  VoiceStatus,
  VoiceAPI,
} from './livekit-voice.js';

// Seams — the Maelstrom↔LiveKit abstraction edge (override via options).
export {
  defaultSeams,
  speakBackOnResponse,
  defaultShouldSpeak,
} from './seams.js';
export type { VoiceSeams, SpeakTransport, ShouldSpeak } from './seams.js';

// Wire constants shared with the agent worker (also on the `./protocol` subpath).
export * from './protocol.js';
