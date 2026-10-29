import type { DemoVoiceProvider } from '../lib/voice-provider';

export type ShopVoiceProvider = Exclude<DemoVoiceProvider, 'livekit'>;

export const SHOP_VOICE_PROVIDERS: readonly ShopVoiceProvider[] = [
  'live',
  'realtime',
];

// The shop does not offer the LiveKit cascade, so a LiveKit choice made for
// the home page starts the shop on the default provider instead.
export function shopVoiceProvider(
  provider: DemoVoiceProvider,
): ShopVoiceProvider {
  return provider === 'livekit' ? 'live' : provider;
}
