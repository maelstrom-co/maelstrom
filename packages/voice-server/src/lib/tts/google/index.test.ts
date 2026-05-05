import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { TTSEvent, TTSError } from '../../types.js';

const synthesizeRequests: unknown[] = [];
let lastTextToSpeechClientOptions: unknown;
type SynthAudioContent = Uint8Array<ArrayBufferLike> | string;
type SynthResponse = Array<{ audioContent: SynthAudioContent }>;

const synthesizeSpeech = mock(
  async (_request?: unknown): Promise<SynthResponse> => [
    {
      audioContent: Uint8Array.from([
        ...new Uint8Array(44),
        ...new Uint8Array(50000).fill(1),
      ]),
    },
  ],
);
const clientClose = mock(async () => {});
const TextToSpeechClient = mock(function MockTextToSpeechClient(
  options?: unknown,
) {
  lastTextToSpeechClientOptions = options;
  return {
    synthesizeSpeech: (request: unknown) => {
      synthesizeRequests.push(request);
      return synthesizeSpeech(request);
    },
    close: clientClose,
  };
});

mock.module('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient,
  protos: {
    google: {
      cloud: {
        texttospeech: {
          v1: {
            AudioEncoding: {
              LINEAR16: 'LINEAR16',
            },
          },
        },
      },
    },
  },
}));

beforeEach(() => {
  synthesizeSpeech.mockReset();
  synthesizeSpeech.mockResolvedValue([
    {
      audioContent: Uint8Array.from([
        ...new Uint8Array(44),
        ...new Uint8Array(50000).fill(1),
      ]),
    },
  ]);
  clientClose.mockReset();
  TextToSpeechClient.mockClear();
  synthesizeRequests.length = 0;
  lastTextToSpeechClientOptions = undefined;
});

afterEach(() => {
  synthesizeSpeech.mockReset();
});

describe('createGoogleTTS', () => {
  test('reports non-streaming capabilities', async () => {
    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS();

    expect(provider.capabilities).toEqual({
      streamingTts: false,
    });
  });

  test('connects with credentials JSON when provided', async () => {
    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS({
      credentialsJSON: JSON.stringify({
        client_email: 'bot@example.com',
        private_key: 'key',
      }),
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    expect(TextToSpeechClient).toHaveBeenCalledTimes(1);
    expect(lastTextToSpeechClientOptions).toEqual({
      credentials: {
        client_email: 'bot@example.com',
        private_key: 'key',
        project_id: undefined,
      },
    });
    expect(events).toContainEqual({ type: 'connected' });
  });

  test('synthesizes and emits chunked unary audio output', async () => {
    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS({
      defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello world', { language: 'en-US', sampleRate: 16000 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeRequests[0]).toMatchObject({
      input: { text: 'Hello world' },
      voice: {
        languageCode: 'en-US',
        name: 'en-US-Chirp3-HD-Achernar',
      },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 16000,
      },
    });
    expect(events[0]).toEqual({ type: 'connected' });
    expect(events[1]).toEqual({
      type: 'started',
      speech: {
        text: 'Hello world',
        format: 'pcm_f32le',
        sampleRate: 16000,
      },
    });
    expect(events[2]?.type).toBe('chunk');
    if (events[2]?.type === 'chunk') {
      expect(events[2].chunk.format).toBe('pcm_f32le');
      expect(events[2].chunk.sampleRate).toBe(16000);
    }
    expect(events[3]?.type).toBe('chunk');
    expect(events[4]).toEqual({ type: 'completed' });
  });

  test('stop suppresses stale completion after a request has started', async () => {
    let resolveSynthesis: ((value: SynthResponse) => void) | undefined;
    synthesizeSpeech.mockImplementation(
      () =>
        new Promise<SynthResponse>((resolve) => {
          resolveSynthesis = resolve;
        }),
    );

    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS();
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello world');
    provider.stop();
    resolveSynthesis?.([
      {
        audioContent: Uint8Array.from([
          ...new Uint8Array(44),
          ...new Uint8Array(1000).fill(1),
        ]),
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toContainEqual({ type: 'stopped' });
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });

  test('decodes base64 string audioContent responses before chunking', async () => {
    const wavWithAudioBytes = Uint8Array.from([
      ...new Uint8Array(44),
      ...new Uint8Array(1000).fill(1),
    ]);
    synthesizeSpeech.mockResolvedValue([
      {
        audioContent: Buffer.from(wavWithAudioBytes).toString('base64'),
      },
    ]);

    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS();
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello base64 world');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstChunkEvent = events.find(
      (event): event is Extract<TTSEvent, { type: 'chunk' }> =>
        event.type === 'chunk',
    );

    expect(firstChunkEvent).toBeDefined();
    expect(firstChunkEvent?.chunk.data.length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ type: 'completed' });
  });

  test('classifies synthesis failures instead of surfacing raw provider errors', async () => {
    synthesizeSpeech.mockRejectedValueOnce(new Error('google transport boom'));

    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS();
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello failure');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      const error: TTSError = lastEvent.error;
      expect(error.kind).toBe('transport');
      expect(error.provider).toBe('google');
      expect(error.message).toBe('google transport boom');
    }
  });
});
