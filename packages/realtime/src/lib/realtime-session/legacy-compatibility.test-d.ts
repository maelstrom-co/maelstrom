import type {
  TranscriptEntry,
  VoiceSession,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
} from './provider-adapter.types.js';
import type { RealtimeSession } from './realtime-session.js';

function legacyState(state: VoiceSessionState): string {
  switch (state) {
    case 'idle':
    case 'connecting':
    case 'connected':
    case 'listening':
    case 'thinking':
    case 'speaking':
    case 'error':
      return state;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function legacyEvent(event: RealtimeAdapterEvent): void {
  switch (event.type) {
    case 'tool_call':
    case 'transcript':
    case 'speech_started':
    case 'state':
    case 'turn_mode':
    case 'error':
      return;
    default: {
      const exhaustive: never = event;
      void exhaustive;
    }
  }
}

const adapter: RealtimeProviderAdapter = {
  connect: async () => {},
  disconnect: async () => {},
  getAudioStreams: () => ({}),
  sendToolResult: async () => {},
  injectGrounding: () => {},
  on: () => () => {},
};
const transcript: TranscriptEntry = {
  role: 'user',
  text: 'unchanged',
  final: true,
};
declare const realtime: RealtimeSession;
const session: VoiceSession = realtime;
void [legacyState, legacyEvent, adapter, transcript, session];
