import { describe, expect, test } from 'bun:test';

import { createSTT, sttProviderFactories } from './registry.js';

describe('createSTT', () => {
  test('creates a Deepgram provider from discriminated config', () => {
    const provider = createSTT({
      type: 'deepgram',
      options: {
        apiKey: 'deepgram-key',
        interimResults: false,
      },
    });

    expect(provider.name).toBe('deepgram');
    expect(provider.capabilities).toEqual({
      interimTranscripts: false,
    });
  });

  test('creates a Google provider and preserves required projectId', () => {
    const provider = createSTT({
      type: 'google',
      options: {
        projectId: 'project-123',
        language: 'en-US',
        interimResults: true,
      },
    });

    expect(provider.name).toBe('google');
    expect(provider.capabilities).toEqual({
      interimTranscripts: true,
    });
  });

  test('forwards the exact Deepgram options object to the registry factory', () => {
    const originalFactory = sttProviderFactories.deepgram;
    const capturedOptions: unknown[] = [];

    sttProviderFactories.deepgram = ((options) => {
      capturedOptions.push(options);
      return originalFactory(options);
    }) as typeof sttProviderFactories.deepgram;

    try {
      createSTT({
        type: 'deepgram',
        options: {
          apiKey: 'deepgram-key',
          interimResults: false,
          vadEvents: true,
          keyterms: ['maelstrom'],
        },
      });

      expect(capturedOptions).toEqual([
        {
          apiKey: 'deepgram-key',
          interimResults: false,
          vadEvents: true,
          keyterms: ['maelstrom'],
        },
      ]);
    } finally {
      sttProviderFactories.deepgram = originalFactory;
    }
  });

  test('forwards the exact Google options object to the registry factory', () => {
    const originalFactory = sttProviderFactories.google;
    const capturedOptions: unknown[] = [];

    sttProviderFactories.google = ((options) => {
      capturedOptions.push(options);
      return originalFactory(options);
    }) as typeof sttProviderFactories.google;

    try {
      createSTT({
        type: 'google',
        options: {
          projectId: 'project-123',
          credentialsJSON: '{"client_email":"bot@example.com"}',
          language: 'en-US',
          interimResults: true,
        },
      });

      expect(capturedOptions).toEqual([
        {
          projectId: 'project-123',
          credentialsJSON: '{"client_email":"bot@example.com"}',
          language: 'en-US',
          interimResults: true,
        },
      ]);
    } finally {
      sttProviderFactories.google = originalFactory;
    }
  });

  test('throws for runtime-invalid provider types instead of silently falling back', () => {
    expect(() =>
      createSTT({
        type: 'whisper',
        options: {},
      } as never),
    ).toThrow(
      'Unsupported STT provider type: whisper. Supported: deepgram, google',
    );
  });
});
