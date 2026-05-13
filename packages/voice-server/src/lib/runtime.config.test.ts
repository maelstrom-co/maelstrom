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
  SpeechSynthesisHandle,
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

  speak(): SpeechSynthesisHandle {
    return {
      speech: {
        text: 'mock speech',
        format: 'mp3',
        sampleRate: 24000,
      },
      completion: Promise.resolve('completed'),
    };
  }

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
  transcriptGraceMs: 1500,
  audioBufferMaxMs: 12,
  maxReconnectAttempts: 4,
  reconnectDelayMs: 1500,
  maxReconnectDelayMs: 8000,
  reconnectBackoffMultiplier: 1.5,
  reconnectJitterMs: 200,
  circuitBreakerTimeoutMs: 45000,
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
    expect(resolved.transcriptGraceMs).toBe(1500);
    expect(resolved.audioBufferMaxMs).toBe(12);
    expect(resolved.maxReconnectAttempts).toBe(4);
    expect(resolved.reconnectDelayMs).toBe(1500);
    expect(resolved.maxReconnectDelayMs).toBe(8000);
    expect(resolved.reconnectBackoffMultiplier).toBe(1.5);
    expect(resolved.reconnectJitterMs).toBe(200);
    expect(resolved.circuitBreakerTimeoutMs).toBe(45000);
    expect(resolved.autoRestartListening).toBe(true);
    expect(resolved.interimResults).toBe(false);
    expect(resolved.intentBoundary).toBeNull();
  });

  test('preserves explicit bounded reconnect and circuit overrides', () => {
    const resolved = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('resolve-session'),
        reconnectDelayMs: 2000,
        maxReconnectDelayMs: 16000,
        reconnectBackoffMultiplier: 2.5,
        reconnectJitterMs: 350,
        circuitBreakerTimeoutMs: 120000,
      },
      defaultResolveConfig,
    );

    expect(resolved.reconnectDelayMs).toBe(2000);
    expect(resolved.maxReconnectDelayMs).toBe(16000);
    expect(resolved.reconnectBackoffMultiplier).toBe(2.5);
    expect(resolved.reconnectJitterMs).toBe(350);
    expect(resolved.circuitBreakerTimeoutMs).toBe(120000);
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

  test('resolves transcriptGraceMs defaults and overrides', () => {
    const resolvedWithDefault = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('resolve-session'),
      },
      defaultResolveConfig,
    );

    const resolvedWithOverride = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('resolve-session'),
        transcriptGraceMs: 42,
      },
      defaultResolveConfig,
    );

    const resolvedWithZero = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('resolve-session'),
        transcriptGraceMs: 0,
      },
      defaultResolveConfig,
    );

    expect(resolvedWithDefault.transcriptGraceMs).toBe(1500);
    expect(resolvedWithOverride.transcriptGraceMs).toBe(42);
    expect(resolvedWithZero.transcriptGraceMs).toBe(0);
  });

  test('rejects invalid transcriptGraceMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          transcriptGraceMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session transcriptGraceMs must be a finite number greater than or equal to 0, received -1',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          transcriptGraceMs: Number.POSITIVE_INFINITY,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session transcriptGraceMs must be a finite number greater than or equal to 0, received Infinity',
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

  test('rejects invalid maxReconnectDelayMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          maxReconnectDelayMs: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectDelayMs must be a finite number greater than 0, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          maxReconnectDelayMs: 0,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectDelayMs must be a finite number greater than 0, received 0',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          maxReconnectDelayMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectDelayMs must be a finite number greater than 0, received -1',
    );
  });

  test('rejects maxReconnectDelayMs values below reconnectDelayMs', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectDelayMs: 1500,
          maxReconnectDelayMs: 1499,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session maxReconnectDelayMs must be greater than or equal to reconnectDelayMs, received maxReconnectDelayMs=1499 and reconnectDelayMs=1500',
    );
  });

  test('rejects invalid reconnectBackoffMultiplier values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectBackoffMultiplier: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectBackoffMultiplier must be a finite number greater than or equal to 1, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectBackoffMultiplier: 0,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectBackoffMultiplier must be a finite number greater than or equal to 1, received 0',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectBackoffMultiplier: 0.5,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectBackoffMultiplier must be a finite number greater than or equal to 1, received 0.5',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectBackoffMultiplier: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectBackoffMultiplier must be a finite number greater than or equal to 1, received -1',
    );
  });

  test('rejects invalid reconnectJitterMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectJitterMs: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectJitterMs must be a finite number greater than or equal to 0, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectJitterMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectJitterMs must be a finite number greater than or equal to 0, received -1',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          reconnectJitterMs: Number.POSITIVE_INFINITY,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session reconnectJitterMs must be a finite number greater than or equal to 0, received Infinity',
    );
  });

  test('rejects invalid circuitBreakerTimeoutMs values', () => {
    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          circuitBreakerTimeoutMs: Number.NaN,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session circuitBreakerTimeoutMs must be a finite number greater than 0, received NaN',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          circuitBreakerTimeoutMs: 0,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session circuitBreakerTimeoutMs must be a finite number greater than 0, received 0',
    );

    expect(() =>
      resolveVoiceSessionConfig(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('resolve-session'),
          circuitBreakerTimeoutMs: -1,
        },
        defaultResolveConfig,
      ),
    ).toThrow(
      'Voice session circuitBreakerTimeoutMs must be a finite number greater than 0, received -1',
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
