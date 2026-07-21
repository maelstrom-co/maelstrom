import { describe, expect, it, vi } from 'vitest';
import type { MaelstromRealtimeBuilder } from '@maelstrom-co/react-realtime';

vi.doMock('@maelstrom-co/react', () => ({
  createMaelstrom: () => {
    const maelstrom = { with: () => maelstrom };
    return maelstrom;
  },
}));
vi.doMock('@maelstrom-co/react-realtime', () => ({
  maelstromRealtime: () => ({ withVAD: () => ({}) }),
}));
vi.doMock('@maelstrom-co/realtime/openai', () => ({
  OpenAIAdapter: class {},
}));
vi.doMock('@maelstrom-co/realtime-livekit', () => ({
  LiveKitAdapter: class {},
}));
vi.doMock('../vessels/calendar.vessel', () => ({ calendarEntry: {} }));
vi.doMock('../vessels/journal.vessel', () => ({ journalEntry: {} }));
vi.doMock('../vessels/map.vessel', () => ({ mapEntry: {} }));
vi.doMock('../vessels/tasks.vessel', () => ({ tasksEntry: {} }));
vi.doMock('../vessels/weather.vessel', () => ({ weatherEntry: {} }));
vi.doMock('./mint-token', () => ({
  mintOpenAIToken: () => Promise.resolve(),
}));
vi.doMock('./voice/get-livekit-token', () => ({
  getLivekitToken: () => Promise.resolve(),
}));

const providerTestSpecifier = './maelstrom.ts' + '?provider-test';
const { selectVoiceExtension } = (await import(
  providerTestSpecifier
)) as typeof import('./maelstrom');

function makeBuilder() {
  const withVAD = vi.fn(
    (config: {
      assetBaseUrl: string;
      providerOptions?: { model?: 'legacy' | 'v5' };
      onError?: (error: unknown) => void;
    }) => {
      void config;
      return {} as never;
    },
  );
  return {
    builder: { withVAD } as unknown as MaelstromRealtimeBuilder,
    withVAD,
  };
}

describe('demo voice provider wiring', () => {
  it('does not configure VAD for the OpenAI provider', () => {
    const { builder, withVAD } = makeBuilder();

    expect(selectVoiceExtension(builder, 'openai')).toBe(builder);
    expect(withVAD).not.toHaveBeenCalled();
  });

  it('configures VAD only for the LiveKit provider', () => {
    const { builder, withVAD } = makeBuilder();

    selectVoiceExtension(builder, 'livekit');

    expect(withVAD).toHaveBeenCalledTimes(1);
    expect(withVAD.mock.calls[0]?.[0]).toMatchObject({
      assetBaseUrl: '/vad-web/',
      onError: expect.any(Function),
    });
  });
});
