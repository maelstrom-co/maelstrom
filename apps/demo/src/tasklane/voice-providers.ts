import type { DemoVoiceProvider } from '../lib/voice-provider';

export type TasklaneVoiceProvider = Exclude<DemoVoiceProvider, 'livekit'>;

export const TASKLANE_VOICE_PROVIDERS: readonly TasklaneVoiceProvider[] = [
  'live',
  'realtime',
];

// Tasklane does not offer the LiveKit cascade, so a LiveKit choice made on
// another page starts Tasklane on the default provider instead.
export function tasklaneVoiceProvider(
  provider: DemoVoiceProvider,
): TasklaneVoiceProvider {
  return provider === 'livekit' ? 'live' : provider;
}
