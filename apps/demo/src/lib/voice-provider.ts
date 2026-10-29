import { Store } from '@tanstack/store';
import { isHosted } from './hosted-mode';

export type DemoVoiceProvider = 'realtime' | 'live' | 'livekit';

export const DEMO_VOICE_PROVIDERS: readonly DemoVoiceProvider[] = [
  'live',
  'realtime',
  'livekit',
];

const configuredProvider = import.meta.env.VITE_VOICE_PROVIDER;

export const voiceProviderStore = new Store<{ provider: DemoVoiceProvider }>({
  provider:
    !isHosted() && configuredProvider === 'livekit'
      ? 'livekit'
      : configuredProvider === 'openai' || configuredProvider === 'realtime'
        ? 'realtime'
        : 'live',
});

export const LIVE_MODEL = 'gpt-live-1';
export const LIVE_BACKEND_MODEL = 'gpt-6-luna';

export function availableVoiceProviders(): readonly DemoVoiceProvider[] {
  return isHosted()
    ? DEMO_VOICE_PROVIDERS.filter((provider) => provider !== 'livekit')
    : DEMO_VOICE_PROVIDERS;
}

export function selectVoiceProvider(provider: DemoVoiceProvider) {
  if (isHosted() && provider === 'livekit') return;
  voiceProviderStore.setState(() => ({ provider }));
}
