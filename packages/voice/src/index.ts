// The session — the only runtime export
export { VoiceSession } from './lib/voice-session/voice-session.js';
export type { VoiceSessionConfig, VoiceSessionState } from './lib/voice-session/voice-session.js';

// Events
export type { VoiceEvent, VoiceEventMap } from './lib/voice-session/events.js';

// VAD config (users need to tune thresholds per environment)
export type { VADConfig } from './lib/vad/types.js';
