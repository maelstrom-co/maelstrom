import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  '0',
  '1',
])('starts fresh visits with Live (hosted=%s)', async (hosted) => {
  vi.stubEnv('VITE_HOSTED', hosted);
  vi.stubEnv('VITE_VOICE_PROVIDER', '');
  const { voiceProviderStore, selectVoiceProvider } = await import(
    './voice-provider'
  );
  expect(voiceProviderStore.state.provider).toBe('live');
  selectVoiceProvider('realtime');
  expect(voiceProviderStore.state.provider).toBe('realtime');
});

it.each([
  ['0', 'livekit', 'livekit'],
  ['1', 'livekit', 'live'],
  ['0', 'openai', 'realtime'],
  ['1', 'realtime', 'realtime'],
] as const)('respects supported explicit configuration (%s, %s)', async (hosted, provider, expected) => {
  vi.stubEnv('VITE_HOSTED', hosted);
  vi.stubEnv('VITE_VOICE_PROVIDER', provider);
  const { voiceProviderStore } = await import('./voice-provider');
  expect(voiceProviderStore.state.provider).toBe(expected);
});

it.each([
  ['0', ['live', 'realtime', 'livekit']],
  ['1', ['live', 'realtime']],
] as const)('offers LiveKit only outside hosted mode (hosted=%s)', async (hosted, expected) => {
  vi.stubEnv('VITE_HOSTED', hosted);
  const { availableVoiceProviders } = await import('./voice-provider');
  expect(availableVoiceProviders()).toEqual(expected);
});
