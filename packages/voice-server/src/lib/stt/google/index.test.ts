import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { AudioChunk, STTEvent } from '../../types.js';

const writtenRequests: unknown[] = [];
let lastSpeechClientOptions: unknown;

const streamWrite = mock((request: unknown) => request);
const streamEnd = mock(() => {
  streamHandlers.get('end')?.();
  streamHandlers.get('close')?.();
});
const streamHandlers = new Map<string, (...args: unknown[]) => void>();
const mockStream = {
  write: (request: unknown) => {
    writtenRequests.push(request);
    return streamWrite(request);
  },
  end: streamEnd,
  on: mock((event: string, handler: (...args: unknown[]) => void) => {
    streamHandlers.set(event, handler);
    return mockStream;
  }),
};
const clientClose = mock(async () => {});
const streamingRecognize = mock(() => mockStream);

const SpeechClient = mock(function MockSpeechClient(options?: unknown) {
  lastSpeechClientOptions = options;
  return {
    streamingRecognize,
    close: clientClose,
  };
});

mock.module('@google-cloud/speech', () => ({
  protos: {
    google: {
      cloud: {
        speech: {
          v2: {},
        },
      },
    },
  },
  v2: {
    SpeechClient,
  },
}));

beforeEach(() => {
  streamHandlers.clear();
  writtenRequests.length = 0;
  lastSpeechClientOptions = undefined;
  streamWrite.mockReset();
  streamEnd.mockReset();
  (mockStream.on as ReturnType<typeof mock>).mockReset();
  (mockStream.on as ReturnType<typeof mock>).mockImplementation(
    (event: string, handler: (...args: unknown[]) => void) => {
      streamHandlers.set(event, handler);
      return mockStream;
    },
  );
  clientClose.mockReset();
  streamingRecognize.mockReset();
  streamingRecognize.mockImplementation(() => mockStream);
  SpeechClient.mockClear();
});

afterEach(() => {
  streamHandlers.clear();
});

describe('createGoogleSTT', () => {
  test('requires projectId', async () => {
    const { createGoogleSTT } = await import('./index.js');

    expect(() =>
      createGoogleSTT({
        projectId: '',
      }),
    ).toThrow('Google STT projectId is required');
  });

  test('reports expected capabilities and connects with credentials JSON', async () => {
    const { createGoogleSTT } = await import('./index.js');
    const provider = createGoogleSTT({
      projectId: 'proj-1',
      credentialsJSON: JSON.stringify({
        client_email: 'bot@example.com',
        private_key: 'key',
      }),
      interimResults: false,
    });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect({ language: 'es-ES' });

    expect(provider.capabilities).toEqual({
      interimTranscripts: false,
    });
    expect(SpeechClient).toHaveBeenCalledTimes(1);
    expect(lastSpeechClientOptions).toEqual({
      credentials: {
        client_email: 'bot@example.com',
        private_key: 'key',
        project_id: undefined,
      },
    });
    expect(events).toContainEqual({ type: 'connected' });
    expect(streamWrite).toHaveBeenCalledTimes(1);
    expect(writtenRequests[0]).toMatchObject({
      recognizer: 'projects/proj-1/locations/global/recognizers/_',
      streamingConfig: {
        config: {
          languageCodes: ['es-ES'],
        },
        streamingFeatures: {
          interimResults: false,
        },
      },
    });
  });

  test('emits transcript results from streaming responses', async () => {
    const { createGoogleSTT } = await import('./index.js');
    const provider = createGoogleSTT({
      projectId: 'proj-1',
    });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    const dataHandler = streamHandlers.get('data');
    dataHandler?.({
      results: [
        {
          isFinal: true,
          languageCode: 'en-US',
          alternatives: [
            {
              transcript: 'hello world',
              confidence: 0.94,
            },
          ],
        },
      ],
    });

    expect(events).toContainEqual({
      type: 'transcript',
      result: {
        text: 'hello world',
        isFinal: true,
        confidence: 0.94,
        language: 'en-US',
      },
    });
  });

  test('splits oversized audio chunks to stay under stream limits', async () => {
    const { createGoogleSTT } = await import('./index.js');
    const provider = createGoogleSTT({
      projectId: 'proj-1',
    });
    await provider.connect();

    const chunk: AudioChunk = {
      data: new Uint8Array(60000),
      sampleRate: 16000,
      encoding: 'linear16',
      timestamp: Date.now(),
    };
    provider.sendAudio(chunk);

    expect(streamWrite).toHaveBeenCalledTimes(4);
    expect((writtenRequests[1] as { audio: Uint8Array }).audio.length).toBe(
      25600,
    );
    expect((writtenRequests[2] as { audio: Uint8Array }).audio.length).toBe(
      25600,
    );
    expect((writtenRequests[3] as { audio: Uint8Array }).audio.length).toBe(
      8800,
    );
  });

  test('disconnect ends the stream, closes the client, and emits disconnected', async () => {
    const { createGoogleSTT } = await import('./index.js');
    const provider = createGoogleSTT({
      projectId: 'proj-1',
    });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    await provider.disconnect();

    expect(streamEnd).toHaveBeenCalledTimes(1);
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'disconnected' });
  });

  test('emits error events from the streaming response', async () => {
    const { createGoogleSTT } = await import('./index.js');
    const provider = createGoogleSTT({
      projectId: 'proj-1',
    });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    streamHandlers.get('error')?.(new Error('stream boom'));

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('unknown');
      expect(lastEvent.error.provider).toBe('google');
      expect(lastEvent.error.message).toBe('stream boom');
    }
  });

  test('awaits and merges phraseHintsProvider values on connect', async () => {
    const { createGoogleSTT } = await import('./index.js');
    const provider = createGoogleSTT({
      projectId: 'proj-1',
      phraseHints: ['glucose'],
      phraseHintsProvider: async () => ['hemoglobin'],
      phraseHintBoost: 12,
    });

    await provider.connect({ language: 'en-US' });

    expect(writtenRequests[0]).toMatchObject({
      streamingConfig: {
        config: {
          adaptation: {
            phraseSets: [
              {
                inlinePhraseSet: {
                  phrases: [
                    { value: 'glucose', boost: 12 },
                    { value: 'hemoglobin', boost: 12 },
                  ],
                },
              },
            ],
          },
        },
      },
    });
  });
});
