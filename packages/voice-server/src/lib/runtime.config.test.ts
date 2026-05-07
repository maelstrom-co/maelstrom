import { describe, expect, test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import {
  resolveVoiceProvisionConfig,
  resolveVoiceSessionConfig,
} from './runtime.config.js';
import { sttProviderFactories } from './stt/registry.js';
import { ttsProviderFactories } from './tts/registry.js';
import type {
  ProcessIntent,
  STTEvent,
  STTProvider,
  TTSEvent,
  TTSProvider,
  VoiceSessionConfig,
  VoiceSessionIntentRequestBuilder,
} from './types.js';

class MockSTTProvider implements STTProvider {
  readonly name = 'mock-stt';
  readonly capabilities = {
    interimTranscripts: true,
  };

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  sendAudio(): void {}

  endStream(): void {}

  onEvent(_callback: (event: STTEvent) => void): () => void {
    return () => {};
  }

  isConnected(): boolean {
    return true;
  }
}

class MockTTSProvider implements TTSProvider {
  readonly name = 'mock-tts';
  readonly capabilities = { streamingTts: true };

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  speak(): void {}

  stop(): void {}

  onEvent(_callback: (event: TTSEvent) => void): () => void {
    return () => {};
  }

  isConnected(): boolean {
    return true;
  }
}

const defaultResolveConfig = {
  vadFinalDebounceMs: 250,
  audioBufferMaxMs: 12,
  maxReconnectAttempts: 4,
  reconnectDelayMs: 1500,
};

const testSTTProviderType = 'google';
const testTTSProviderType = 'google';

function createSTTTestConfig(overrides: Record<string, unknown> = {}) {
  return {
    type: testSTTProviderType,
    options: {
      projectId: 'test-project',
      ...overrides,
    },
  } as const;
}

function createTTSTestConfig(overrides: Record<string, unknown> = {}) {
  return {
    type: testTTSProviderType,
    options: {
      ...overrides,
    },
  } as const;
}

const defaultBuildChartRequest: VoiceSessionIntentRequestBuilder = ({
  transcript,
}) => ({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: transcript }],
    chartDimensions: { columns: 12, rows: 8 },
    layoutMode: 'tiling',
  },
  instances: [],
  vessels: [],
  layout: { type: 'tiling', tree: [], instances: [] },
});

const defaultProcessIntent: ProcessIntent = {
  async process() {
    return {
      type: 'maelstrom_response',
      requestId: 'req-runtime-config-test' as never,
      userMessage: '',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
  },
};

function withPatchedProviderFactories<T>(
  providers: {
    stt?: STTProvider;
    tts?: TTSProvider;
  },
  run: () => T,
): T {
  const originalSTTFactory = sttProviderFactories[testSTTProviderType];
  const originalTTSFactory = ttsProviderFactories[testTTSProviderType];

  if (!originalSTTFactory || !originalTTSFactory) {
    throw new Error('Missing test provider factory registration');
  }

  if (providers.stt) {
    const sttProvider = providers.stt;
    sttProviderFactories[testSTTProviderType] = () => sttProvider;
  }

  if (providers.tts) {
    const ttsProvider = providers.tts;
    ttsProviderFactories[testTTSProviderType] = () => ttsProvider;
  }

  try {
    return run();
  } finally {
    sttProviderFactories[testSTTProviderType] = originalSTTFactory;
    ttsProviderFactories[testTTSProviderType] = originalTTSFactory;
  }
}

describe('resolveVoiceSessionConfig', () => {
  test('applies runtime defaults and derives interim results from provider capabilities', () => {
    const resolved = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig({ interimResults: false }),
        tts: createTTSTestConfig({ sampleRate: 32000 }),
        sessionId: SessionId('resolve-session'),
      },
      defaultResolveConfig,
    );

    expect(resolved.vadFinalDebounceMs).toBe(250);
    expect(resolved.audioBufferMaxMs).toBe(12);
    expect(resolved.maxReconnectAttempts).toBe(4);
    expect(resolved.reconnectDelayMs).toBe(1500);
    expect(resolved.autoRestartListening).toBe(true);
    expect(resolved.interimResults).toBe(false);
    expect(resolved.intentBoundary).toBeNull();
  });

  test('resolveVoiceProvisionConfig remains an alias of resolveVoiceSessionConfig', () => {
    expect(resolveVoiceProvisionConfig).toBe(resolveVoiceSessionConfig);
  });

  test('wraps provider construction failures with voice-session context', () => {
    const originalFactory = sttProviderFactories[testSTTProviderType];
    sttProviderFactories[testSTTProviderType] = (() => {
      throw new Error('boom');
    }) as (typeof sttProviderFactories)[typeof testSTTProviderType];

    let thrown: unknown;

    try {
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
        },
        defaultResolveConfig,
      );
    } catch (error) {
      thrown = error;
    } finally {
      sttProviderFactories[testSTTProviderType] = originalFactory;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'Failed to construct STT provider for voice session',
    );
    expect((thrown as { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect((thrown as { cause: Error }).cause.message).toBe('boom');
  });

  test('wraps TTS provider construction failures with voice-session context', () => {
    const originalFactory = ttsProviderFactories[testTTSProviderType];
    ttsProviderFactories[testTTSProviderType] = (() => {
      throw new Error('tts boom');
    }) as (typeof ttsProviderFactories)[typeof testTTSProviderType];

    let thrown: unknown;

    try {
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
        },
        defaultResolveConfig,
      );
    } catch (error) {
      thrown = error;
    } finally {
      ttsProviderFactories[testTTSProviderType] = originalFactory;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'Failed to construct TTS provider for voice session',
    );
    expect((thrown as { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect((thrown as { cause: Error }).cause.message).toBe('tts boom');
  });

  test('rejects invalid audioBufferMaxMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          audioBufferMaxMs: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session audioBufferMaxMs must be a finite number greater than 0, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          audioBufferMaxMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session audioBufferMaxMs must be a finite number greater than 0, received -1',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          audioBufferMaxMs: 0,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session audioBufferMaxMs must be a finite number greater than 0, received 0',
    );
  });

  test('rejects invalid vadFinalDebounceMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          vadFinalDebounceMs: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session vadFinalDebounceMs must be a finite number greater than or equal to 0, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          vadFinalDebounceMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session vadFinalDebounceMs must be a finite number greater than or equal to 0, received -1',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          vadFinalDebounceMs: Number.POSITIVE_INFINITY,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session vadFinalDebounceMs must be a finite number greater than or equal to 0, received Infinity',
    );
  });

  test('rejects invalid reconnectDelayMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectDelayMs: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectDelayMs must be a finite number greater than or equal to 0, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectDelayMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectDelayMs must be a finite number greater than or equal to 0, received -1',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectDelayMs: Number.POSITIVE_INFINITY,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectDelayMs must be a finite number greater than or equal to 0, received Infinity',
    );
  });

  test('rejects invalid maxReconnectAttempts values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          maxReconnectAttempts: 1.5,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectAttempts must be a non-negative integer, received 1.5',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          maxReconnectAttempts: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectAttempts must be a non-negative integer, received -1',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          maxReconnectAttempts: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectAttempts must be a non-negative integer, received NaN',
    );
  });

  test('preserves explicit interimResults and autoRestartListening overrides', () => {
    const stt = new MockSTTProvider();
    Object.assign(stt.capabilities, { interimTranscripts: false });
    const tts = new MockTTSProvider();

    const resolved = withPatchedProviderFactories({ stt, tts }, () =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          interimResults: true,
          autoRestartListening: false,
        },
        defaultResolveConfig,
      ),
    );

    expect(resolved.interimResults).toBe(true);
    expect(resolved.autoRestartListening).toBe(false);
  });

  test('returns a null intent boundary when only one intent callback is configured', () => {
    const onlyBuildChartRequest = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('resolve-session'),
        buildChartRequest: defaultBuildChartRequest,
      } as unknown as VoiceSessionConfig,
      defaultResolveConfig,
    );

    const onlyProcessIntent = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('resolve-session'),
        processIntent: defaultProcessIntent,
      } as unknown as VoiceSessionConfig,
      defaultResolveConfig,
    );

    expect(onlyBuildChartRequest.intentBoundary).toBeNull();
    expect(onlyProcessIntent.intentBoundary).toBeNull();
  });
});
