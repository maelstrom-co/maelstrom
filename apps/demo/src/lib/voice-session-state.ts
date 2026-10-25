import type { VoiceSessionState } from '@maelstrom-co/client';

const CONNECTED_STATES: ReadonlySet<VoiceSessionState> = new Set([
  'connected',
  'listening',
  'thinking',
  'speaking',
]);

export function isVoiceConnected(state: VoiceSessionState): boolean {
  return CONNECTED_STATES.has(state);
}
