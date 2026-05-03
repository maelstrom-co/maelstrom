import { describe, expect, test } from 'bun:test';

import { createTTS, ttsProviderFactories } from './registry.js';
import type {
  BaseTTSOptions,
  TTSProviderConfig,
  TTSProviderType,
} from './registry.js';

describe('createTTS', () => {
  test('derives provider types from registry keys', () => {
    const providerType: TTSProviderType = 'cartesia';
    const baseOptions: BaseTTSOptions = {
      language: 'en-US',
      sampleRate: 24000,
    };

    void providerType;
    void baseOptions;
    expect(Object.keys(ttsProviderFactories)).toEqual(
      expect.arrayContaining(['cartesia', 'google']),
    );
  });

  test('constructs a Cartesia provider from discriminated config', () => {
    const config: TTSProviderConfig = {
      type: 'cartesia',
      options: {
        apiKey: 'cartesia-key',
        defaultVoiceId: 'voice-1',
        language: 'en',
        sampleRate: 44100,
      },
    };

    const provider = createTTS(config);

    expect(provider.name).toBe('cartesia');
    expect(provider.capabilities).toEqual({ streamingTts: true });
  });

  test('constructs a Google provider from discriminated config', () => {
    const config: TTSProviderConfig = {
      type: 'google',
      options: {
        credentialsJSON: '{"client_email":"bot@example.com"}',
        defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
        language: 'en-US',
        sampleRate: 16000,
      },
    };

    const provider = createTTS(config);

    expect(provider.name).toBe('google');
    expect(provider.capabilities).toEqual({ streamingTts: false });
  });

  test('forwards the exact Cartesia options object to the registry factory', () => {
    const originalFactory = ttsProviderFactories.cartesia;
    const capturedOptions: unknown[] = [];

    ttsProviderFactories.cartesia = ((options) => {
      capturedOptions.push(options);
      return originalFactory(options);
    }) as typeof ttsProviderFactories.cartesia;

    try {
      createTTS({
        type: 'cartesia',
        options: {
          apiKey: 'cartesia-key',
          defaultVoiceId: 'voice-1',
          language: 'en',
          sampleRate: 44100,
        },
      });

      expect(capturedOptions).toEqual([
        {
          apiKey: 'cartesia-key',
          defaultVoiceId: 'voice-1',
          language: 'en',
          sampleRate: 44100,
        },
      ]);
    } finally {
      ttsProviderFactories.cartesia = originalFactory;
    }
  });

  test('forwards the exact Google options object to the registry factory', () => {
    const originalFactory = ttsProviderFactories.google;
    const capturedOptions: unknown[] = [];

    ttsProviderFactories.google = ((options) => {
      capturedOptions.push(options);
      return originalFactory(options);
    }) as typeof ttsProviderFactories.google;

    try {
      createTTS({
        type: 'google',
        options: {
          credentialsJSON: '{"client_email":"bot@example.com"}',
          defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
          language: 'en-US',
          sampleRate: 16000,
        },
      });

      expect(capturedOptions).toEqual([
        {
          credentialsJSON: '{"client_email":"bot@example.com"}',
          defaultVoiceName: 'en-US-Chirp3-HD-Achernar',
          language: 'en-US',
          sampleRate: 16000,
        },
      ]);
    } finally {
      ttsProviderFactories.google = originalFactory;
    }
  });

  test('throws for an unsupported provider type at runtime', () => {
    expect(() =>
      createTTS({
        type: 'not-real' as never,
        options: {},
      } as TTSProviderConfig),
    ).toThrow(
      'Unsupported TTS provider type: not-real. Supported: cartesia, google',
    );
  });
});
