import { describe, expect, it, vi } from 'vitest';

import { TASKLANE_GREETING } from '../lib/demo-greeting-tts';
import { registerDemoVoice } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { selectVoiceProvider, voiceProviderStore } from '../lib/voice-provider';
import { TASKLANE_VOICE_PROVIDERS } from './voice-providers';

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
  devtoolsExtension: { name: 'devtools' },
  devtoolsOptions: [] as Record<string, unknown>[],
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
  createDemoTelemetry: () => state.telemetryOwner,
}));
vi.mock('@maelstrom-co/react-devtools/production', () => ({
  devtools: (options: Record<string, unknown>) => {
    state.devtoolsOptions.push(options);
    return state.devtoolsExtension;
  },
}));
vi.mock('../lib/maelstrom', () => {
  throw new Error('the Tasklane instance must not load the home instance');
});
vi.mock('../shop/maelstrom', () => {
  throw new Error('the Tasklane instance must not load the shop instance');
});

const { TASKLANE_OPENING_INSTRUCTIONS } = await import('./maelstrom');
const { tasklaneRequestReferences } = await import('./request-references');
const { tasklaneSettleSignal } = await import('./settle-signal');
const { tasklaneInstanceLifetime } = await import('./instance-lifetime');

type Opening = (context: { provider: string }) => unknown;

describe('Tasklane instance', () => {
  it('registers exactly the Tasklane Vessels', () => {
    expect(state.vesselIds).toEqual([
      'source-feedback',
      'project-tasks',
      'my-priorities',
      'task-detail',
      'team-load',
      'triage-inbox',
      'project-pulse',
      'flexible-table',
    ]);
  });

  it('installs realtime, request references, the settle signal, Instance lifetime, its own telemetry, then devtools', () => {
    expect(state.installedExtensions).toEqual([
      state.realtimeExtension,
      tasklaneRequestReferences,
      tasklaneSettleSignal,
      tasklaneInstanceLifetime,
      state.telemetryOwner.extension,
      state.devtoolsExtension,
    ]);
    expect(state.devtoolsOptions[0]?.capture).toBe(diagnosticCapture);
    expect(state.devtoolsOptions[0]?.telemetry).toBe(
      state.telemetryOwner.telemetry,
    );
  });

  it('offers GPT-Live and OpenAI Realtime through the shared demo voice wiring', () => {
    const [options] = state.realtimeOptions;
    expect(options?.providers).toBe(TASKLANE_VOICE_PROVIDERS);
    expect(TASKLANE_VOICE_PROVIDERS).toEqual(['live', 'realtime']);
    expect(options?.onSession).toBe(registerDemoVoice);
    expect(options).not.toHaveProperty('greeting');
    expect(options).not.toHaveProperty('generatedOpening');
  });

  it('generates a Tasklane opening for live and the fixed greeting for realtime', () => {
    const opening = state.realtimeOptions[0]?.opening as Opening;
    expect(opening({ provider: 'live' })).toEqual({
      generatedOpening: { instructions: TASKLANE_OPENING_INSTRUCTIONS },
    });
    expect(opening({ provider: 'realtime' })).toEqual({
      greeting: { text: TASKLANE_GREETING },
    });
    expect(TASKLANE_OPENING_INSTRUCTIONS).toContain('Tasklane');
    expect(TASKLANE_OPENING_INSTRUCTIONS).toContain('Maelstrom');
    expect(TASKLANE_OPENING_INSTRUCTIONS).toMatch(/^Greet in English,/);
    expect(TASKLANE_OPENING_INSTRUCTIONS).toContain(
      "After that, follow the user's language.",
    );
    expect(TASKLANE_OPENING_INSTRUCTIONS).not.toMatch(/^In English/);
  });

  it('keeps the Live opening within the 500-byte limit including the fixed prefix', () => {
    const livePrefix =
      "Greet immediately without waiting for the caller, then pause and listen. Follow the application's language and introduction instructions: ";
    expect(
      new TextEncoder().encode(livePrefix + TASKLANE_OPENING_INSTRUCTIONS)
        .length,
    ).toBeLessThanOrEqual(500);
  });

  it('offers both data actions and screen changes in the opening and the greeting', () => {
    expect(TASKLANE_OPENING_INSTRUCTIONS).toBe(
      "Greet in English, briefly introducing yourself as Tasklane, powered by Maelstrom, and offer to turn the feedback into tasks. Mention that the user can also change the screen, for example by asking to show team load. After that, follow the user's language.",
    );
    for (const text of [TASKLANE_OPENING_INSTRUCTIONS, TASKLANE_GREETING]) {
      expect(text).toContain('feedback into tasks');
      expect(text).toContain('change the screen');
      expect(text).toContain('team load');
    }
  });

  it('keeps the Live opening, with its fixed prefix, under the 500 byte limit', () => {
    const liveContent = `Greet immediately without waiting for the caller, then pause and listen. Follow the application's language and introduction instructions: ${TASKLANE_OPENING_INSTRUCTIONS}`;
    expect(new TextEncoder().encode(liveContent).length).toBeLessThan(500);
  });

  it('starts on GPT-Live when the stored choice is LiveKit', () => {
    const initialProvider = state.realtimeOptions[0]?.initialProvider as
      | (() => string)
      | undefined;
    voiceProviderStore.setState(() => ({ provider: 'livekit' }));
    expect(initialProvider?.()).toBe('live');
    selectVoiceProvider('realtime');
    expect(initialProvider?.()).toBe('realtime');
    selectVoiceProvider('live');
  });
});
