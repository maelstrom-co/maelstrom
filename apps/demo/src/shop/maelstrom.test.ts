import { SessionId } from '@maelstrom-co/protocol';
import { describe, expect, it, vi } from 'vitest';
import { registerDemoVoice } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { selectVoiceProvider, voiceProviderStore } from '../lib/voice-provider';
import { SHOP_VOICE_PROVIDERS } from './voice-providers';

const state = vi.hoisted(() => ({
  vesselIds: [] as string[],
  installedExtensions: [] as unknown[],
  realtimeExtension: { name: 'realtime' },
  realtimeOptions: [] as Record<string, unknown>[],
  telemetryOwner: {
    extension: { name: 'telemetry' },
    telemetry: { name: 'telemetry-reader' },
    dispose: () => Promise.resolve(),
  },
  telemetryOwners: 0,
  devtoolsExtension: { name: 'devtools' },
  devtoolsOptions: [] as Record<string, unknown>[],
  adapter: { name: 'adapter' },
  adapterCalls: [] as unknown[][],
}));

vi.mock('@maelstrom-co/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/react')>()),
  createMaelstrom: (options: {
    vessels: readonly { vessel: { id: string } }[];
  }) => {
    state.vesselIds = options.vessels.map((entry) => entry.vessel.id);
    const maelstrom = {
      with: (extension: unknown) => {
        state.installedExtensions.push(extension);
        return maelstrom;
      },
    };
    return maelstrom;
  },
}));
vi.mock('@maelstrom-co/react-realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/react-realtime')>()),
  maelstromRealtime: (options: Record<string, unknown>) => {
    state.realtimeOptions.push(options);
    return state.realtimeExtension;
  },
}));
vi.mock('../lib/demo-telemetry', () => ({
  createDemoTelemetry: () => {
    state.telemetryOwners += 1;
    return state.telemetryOwner;
  },
}));
vi.mock('@maelstrom-co/react-devtools/production', () => ({
  devtools: (options: Record<string, unknown>) => {
    state.devtoolsOptions.push(options);
    return state.devtoolsExtension;
  },
}));
vi.mock('../lib/voice-adapter', () => ({
  createAdapter: (...args: unknown[]) => {
    state.adapterCalls.push(args);
    return state.adapter;
  },
}));
vi.mock('../lib/maelstrom', () => {
  throw new Error('the shop instance must not load the home instance');
});

await import('./maelstrom');

describe('shop instance', () => {
  it('registers exactly the four pet-shop vessels', () => {
    expect([...state.vesselIds].sort()).toEqual([
      'cart',
      'catalog',
      'checkout',
      'orders',
    ]);
  });

  it('installs realtime, then its own demo telemetry, then devtools', () => {
    expect(state.installedExtensions).toEqual([
      state.realtimeExtension,
      state.telemetryOwner.extension,
      state.devtoolsExtension,
    ]);
    expect(state.realtimeOptions).toHaveLength(1);
    expect(state.telemetryOwners).toBe(1);
  });

  it('offers GPT-Live and OpenAI Realtime with no spoken opening', () => {
    const [options] = state.realtimeOptions;
    expect(options?.providers).toBe(SHOP_VOICE_PROVIDERS);
    expect(SHOP_VOICE_PROVIDERS).toEqual(['live', 'realtime']);
    expect(options?.onSession).toBe(registerDemoVoice);
    expect(options).not.toHaveProperty('opening');
    expect(options).not.toHaveProperty('greeting');
    expect(options).not.toHaveProperty('generatedOpening');
  });

  it('starts voice on the selected provider', () => {
    const initialProvider = state.realtimeOptions[0]?.initialProvider as
      | (() => string)
      | undefined;
    selectVoiceProvider('realtime');
    expect(initialProvider?.()).toBe('realtime');
    selectVoiceProvider('live');
    expect(initialProvider?.()).toBe('live');
  });

  it('starts on GPT-Live when the stored choice is LiveKit', () => {
    const initialProvider = state.realtimeOptions[0]?.initialProvider as
      | (() => string)
      | undefined;
    voiceProviderStore.setState(() => ({ provider: 'livekit' }));
    expect(initialProvider?.()).toBe('live');
    selectVoiceProvider('live');
  });

  it('builds adapters through the shared voice adapter factory', () => {
    const createAdapter = state.realtimeOptions[0]?.createAdapter as
      | ((context: { provider: string; sessionId: SessionId }) => unknown)
      | undefined;
    const sessionId = SessionId('shop-session');

    expect(createAdapter?.({ provider: 'realtime', sessionId })).toBe(
      state.adapter,
    );
    expect(state.adapterCalls).toEqual([['realtime', sessionId]]);
  });

  it('records devtools diagnostics into the shared demo capture', () => {
    expect(state.devtoolsOptions).toHaveLength(1);
    expect(state.devtoolsOptions[0]?.capture).toBe(diagnosticCapture);
  });

  it('gives devtools the telemetry reader of the shop telemetry owner', () => {
    expect(state.devtoolsOptions[0]?.telemetry).toBe(
      state.telemetryOwner.telemetry,
    );
  });
});
