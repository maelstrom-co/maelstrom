import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { TTSError, TTSEvent } from '../../types.js';

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
    expect(events).toEqual([]);
  });

  test('synthesizes and emits chunked unary audio output', async () => {
    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS({
      defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    const handle = provider.speak('Hello world', {
      language: 'en-US',
      sampleRate: 16000,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(handle.completion).resolves.toBe('completed');

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
    expect(handle.speech).toEqual({
      text: 'Hello world',
      format: 'pcm_f32le',
      sampleRate: 16000,
    });
    expect(events[0]?.type).toBe('chunk');
    if (events[0]?.type === 'chunk') {
      expect(events[0].chunk.format).toBe('pcm_f32le');
      expect(events[0].chunk.sampleRate).toBe(16000);
    }
    expect(events[1]?.type).toBe('chunk');
    expect(events).toHaveLength(2);
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
    const handle = provider.speak('Hello world');
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

    await expect(handle.completion).resolves.toBe('stopped');
    expect(events).toEqual([]);
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
    const handle = provider.speak('Hello base64 world');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(handle.completion).resolves.toBe('completed');

    const firstChunkEvent = events.find(
      (event): event is Extract<TTSEvent, { type: 'chunk' }> =>
        event.type === 'chunk',
    );

    expect(firstChunkEvent).toBeDefined();
    expect(firstChunkEvent?.chunk.data.length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe('chunk');
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

  test('overwriting an in-flight request settles the prior handle as stopped', async () => {
    let resolveFirstSynthesis: ((value: SynthResponse) => void) | undefined;
    let firstRequestPending = true;
    synthesizeSpeech.mockImplementation(() => {
      if (firstRequestPending) {
        firstRequestPending = false;

        return new Promise<SynthResponse>((resolve) => {
          resolveFirstSynthesis = resolve;
        });
      }

      return Promise.resolve([
        {
          audioContent: Uint8Array.from([
            ...new Uint8Array(44),
            ...new Uint8Array(1000).fill(1),
          ]),
        },
      ]);
    });

    const { createGoogleTTS } = await import('./index.js');
    const provider = createGoogleTTS();

    await provider.connect();

    const firstHandle = provider.speak('Hello first');
    const secondHandle = provider.speak('Hello second');

    await expect(firstHandle.completion).resolves.toBe('stopped');

    resolveFirstSynthesis?.([
      {
        audioContent: Uint8Array.from([
          ...new Uint8Array(44),
          ...new Uint8Array(1000).fill(1),
        ]),
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(secondHandle.completion).resolves.toBe('completed');
  });
});
