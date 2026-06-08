import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { createAudioBufferQueue } from './audio-buffer-queue.js';
import type {
  AudioChunk,
  STTError,
  STTEvent,
  STTProvider,
  VoiceProviderErrorKind,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionState,
} from './types.js';

type RecordedTelemetryEvent = {
  name: string;
  attributes?: Record<string, unknown>;
};

type RecordedTelemetryMetric = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};

type RecordedTelemetryTiming = {
  name: string;
  duration: number;
  attributes?: Record<string, unknown>;
};

function createMockSTTError(
  kind: VoiceProviderErrorKind,
  message: string,
): STTError {
  return Object.assign(new Error(message), {
    source: 'stt' as const,
    provider: 'mock-stt',
    kind,
  });
}

class MockSTTProvider implements STTProvider {
  readonly name = 'mock-stt';
  readonly capabilities = {
    interimTranscripts: true,
  };

  readonly sentAudioChunks: AudioChunk[] = [];
  connectCalls = 0;
  endStreamCalls = 0;

  private connected = false;
  private readonly listeners = new Set<(event: STTEvent) => void>();

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  sendAudio(chunk: AudioChunk): void {
    this.sentAudioChunks.push(chunk);
  }

  endStream(): void {
    this.endStreamCalls += 1;
  }

  onEvent(callback: (event: STTEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateUnexpectedDisconnect(
    message = 'Mock STT disconnected unexpectedly',
  ): void {
    this.connected = false;
    this.emit({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message,
    });
  }

  emit(event: STTEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class DelayedConnectSTTProvider extends MockSTTProvider {
  constructor(private readonly delayMs: number) {
    super();
  }

  override async connect(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, this.delayMs);
    });
    await super.connect();
  }
}

class FailConnectSTTProvider extends MockSTTProvider {
  constructor(
    private readonly error: unknown,
    private readonly delayMs = 0,
  ) {
    super();
  }

  override async connect(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, this.delayMs);
    });
    throw this.error;
  }
}

function makeLinear16Chunk(ms: number, sequence: number): AudioChunk {
  return {
    data: new Uint8Array(ms * 32),
    sampleRate: 16000,
    encoding: 'linear16',
    bytesPerSample: 2,
    channels: 1,
    timestamp: sequence,
    sequence,
  };
}

function createManagerTestContext() {
  const traces: Array<{ event: string; details?: Record<string, unknown> }> =
    [];
  const reportedErrors: Error[] = [];
  const emittedDropEvents: VoiceSessionAudioDroppedEvent[] = [];
  const statuses: string[] = [];
  const telemetryEvents: RecordedTelemetryEvent[] = [];
  const telemetryMetrics: RecordedTelemetryMetric[] = [];
  const telemetryTimings: RecordedTelemetryTiming[] = [];
  let destroyed = false;
  let voiceState: VoiceSessionState = 'idle';
  const turnState = {
    currentTranscript: '',
    accumulatedTranscript: '',
    hasEmittedFinal: false,
    hasReceivedSpeech: false,
    hasSentAudioForTurn: false,
    pendingFinalFromVAD: false,
    suppressIncomingAudio: false,
  };

  const queue = createAudioBufferQueue({
    audioBufferMaxMs: 20,
    trace(event, details) {
      traces.push({ event, details });
    },
    reportError(error) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    emitAudioDropped(event) {
      emittedDropEvents.push(event);
    },
    isDestroyed() {
      return destroyed;
    },
  });

  return {
    traces,
    reportedErrors,
    emittedDropEvents,
    statuses,
    telemetryEvents,
    telemetryMetrics,
    telemetryTimings,
    queue,
    getVoiceState() {
      return voiceState;
    },
    getTurnState() {
      return turnState;
    },
    setDestroyed(value: boolean) {
      destroyed = value;
    },
    callbacks: {
      language: 'en-US',
      maxReconnectAttempts: 2,
      reconnectDelayMs: 1,
      maxReconnectDelayMs: 20,
      reconnectBackoffMultiplier: 2,
      reconnectJitterMs: 0,
      circuitBreakerTimeoutMs: 20,
      isDestroyed() {
        return destroyed;
      },
      getVoiceState() {
        return voiceState;
      },
      setVoiceState(state: VoiceSessionState) {
        voiceState = state;
      },
      trace(event: string, details?: Record<string, unknown>) {
        traces.push({ event, details });
      },
      reportError(error: unknown) {
        reportedErrors.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
      clearAutoRestartTimeout() {},
      abortActiveProcessing() {},
      resetTurnTracking() {
        turnState.currentTranscript = '';
        turnState.accumulatedTranscript = '';
        turnState.hasEmittedFinal = false;
        turnState.hasReceivedSpeech = false;
        turnState.hasSentAudioForTurn = false;
        turnState.pendingFinalFromVAD = false;
      },
      getTurnState() {
        return turnState;
      },
      setPendingFinalFromVAD(value: boolean) {
        turnState.pendingFinalFromVAD = value;
      },
      setSuppressIncomingAudio(value: boolean) {
        turnState.suppressIncomingAudio = value;
      },
      markHasSentAudioForTurn() {
        turnState.hasSentAudioForTurn = true;
      },
      clearPendingFinalization() {},
      finalizeTranscript() {
        return { emitted: false, startedProcessing: false };
      },
      updateTranscriptState() {},
      emitFinalTranscript() {},
      createForwardedTranscriptResult(result: unknown) {
        return result;
      },
      forwardTranscriptResult() {},
      eventBus: {
        emitSttCircuitStatusChange(status: string) {
          statuses.push(status);
        },
      },
      telemetry: {
        recordConnectDuration(timing: RecordedTelemetryTiming) {
          telemetryTimings.push(timing);
        },
        recordFirstTokenDuration(timing: RecordedTelemetryTiming) {
          telemetryTimings.push(timing);
        },
        emitTranscriptMetadata(event: RecordedTelemetryEvent) {
          telemetryEvents.push(event);
        },
        emitProviderError(
          event: RecordedTelemetryEvent,
          metric: RecordedTelemetryMetric,
        ) {
          telemetryEvents.push(event);
          telemetryMetrics.push(metric);
        },
      },
    },
  };
}

function getFirstTokenTelemetry(
  context: ReturnType<typeof createManagerTestContext>,
) {
  return context.telemetryTimings.filter(
    (timing) =>
      timing.name === 'maelstrom.voice_server.stt.first_token.duration',
  );
}

describe('stt-session-manager kernel extraction', () => {
  let clock: FakeTimers.InstalledClock;

  beforeEach(() => {
    clock = FakeTimers.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('exports the dedicated STT session manager kernel and removes legacy runtime helper imports', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(typeof module?.createSTTSessionManager).toBe('function');
  });

  test('replays pre-connection buffered audio once listening starts', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          sendAudio: (chunk: AudioChunk, durationMs?: number) => void;
          destroy?: () => Promise<void> | void;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    const chunk = makeLinear16Chunk(4, 1);

    manager.sendAudio(chunk, 4);
    await manager.startListening();

    expect(stt.connectCalls).toBe(1);
    expect(context.getVoiceState()).toBe('listening');
    expect(stt.sentAudioChunks).toEqual([chunk]);
    expect(context.getTurnState().hasSentAudioForTurn).toBe(true);

    await manager.disconnect?.();
  });

  test('reuses one reconnect lifecycle and replays reconnect-buffered audio once after duplicate disconnects', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          sendAudio: (chunk: AudioChunk, durationMs?: number) => void;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    stt.sentAudioChunks.length = 0;

    const bufferedChunk = makeLinear16Chunk(4, 2);

    stt.simulateUnexpectedDisconnect();
    manager.sendAudio(bufferedChunk, 4);
    stt.emit({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message: 'Mock STT disconnected unexpectedly',
    });

    await clock.tickAsync(10);

    expect(stt.connectCalls).toBe(2);
    expect(
      context.traces.filter((entry) => entry.event === 'stt.reconnect.attempt'),
    ).toHaveLength(1);
    expect(stt.sentAudioChunks).toEqual([bufferedChunk]);
    expect(context.getVoiceState()).toBe('listening');
    expect(context.queue.getBufferedDurationMs()).toBe(0);

    await manager.disconnect?.();
  });

  test('disconnect clears an in-flight reconnect delay after destroy', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    context.callbacks.reconnectDelayMs = 20;
    context.callbacks.maxReconnectDelayMs = 20;
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    stt.simulateUnexpectedDisconnect();
    await clock.tickAsync(0);

    expect(clock.countTimers()).toBeGreaterThan(0);

    context.setDestroyed(true);
    await manager.disconnect?.();

    expect(clock.countTimers()).toBe(0);
  });

  test('exposes endStream through the STT session manager boundary', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          endStream: () => void;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    manager.endStream();

    expect(stt.endStreamCalls).toBe(1);
  });

  test('stopListening goes idle while reconnect audio is still buffered', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    context.callbacks.reconnectDelayMs = 1000;
    context.callbacks.maxReconnectDelayMs = 1000;
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          sendAudio: (chunk: AudioChunk, durationMs?: number) => void;
          startListening: () => Promise<void>;
          stopListening: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    stt.simulateUnexpectedDisconnect();
    manager.sendAudio(makeLinear16Chunk(4, 1), 4);
    manager.sendAudio(makeLinear16Chunk(4, 2), 4);

    await clock.tickAsync(50);
    expect(stt.isConnected()).toBe(false);
    await manager.stopListening();

    expect(context.getVoiceState()).toBe('idle');
  });

  test('records STT connect duration telemetry for a successful warmup connect', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new DelayedConnectSTTProvider(25);
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          connect: (operation?: 'start_listening' | 'warmup') => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    const connectPromise = manager.connect('warmup');

    await clock.tickAsync(25);
    await connectPromise;

    expect(context.telemetryTimings).toEqual([
      {
        name: 'maelstrom.voice_server.stt.connect.duration',
        duration: 25,
        attributes: {
          provider: 'mock-stt',
          operation: 'warmup',
          outcome: 'success',
          circuitStatus: 'closed',
        },
      },
    ]);

    await manager.disconnect?.();
  });

  test('records STT connect failure duration telemetry and sanitized provider error telemetry', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const sttError = createMockSTTError(
      'transport',
      'user said hello world before the socket dropped',
    );
    const stt = new FailConnectSTTProvider(sttError, 10);
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          connect: (operation?: 'start_listening' | 'warmup') => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    const connectResult = manager.connect('start_listening').then(
      () => ({ status: 'fulfilled' as const }),
      (error) => ({ status: 'rejected' as const, error }),
    );

    await clock.tickAsync(10);

    await expect(connectResult).resolves.toEqual({
      status: 'rejected',
      error: sttError,
    });
    expect(context.telemetryTimings).toEqual([
      {
        name: 'maelstrom.voice_server.stt.connect.duration',
        duration: 10,
        attributes: {
          provider: 'mock-stt',
          operation: 'start_listening',
          outcome: 'failure',
          circuitStatus: 'closed',
        },
      },
    ]);
    expect(context.telemetryMetrics).toEqual([
      {
        name: 'maelstrom.voice_server.provider.error_count',
        value: 1,
        attributes: {
          source: 'stt',
          provider: 'mock-stt',
          kind: 'transport',
        },
      },
    ]);
    expect(context.telemetryEvents).toContainEqual({
      name: 'maelstrom.voice_server.provider.error',
      attributes: {
        source: 'stt',
        provider: 'mock-stt',
        kind: 'transport',
      },
    });
  });

  test('emits transcript metadata telemetry without transcript text or preview fields', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    context.callbacks.setVoiceState('listening');
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          connect: (operation?: 'start_listening' | 'warmup') => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.connect('warmup');
    context.telemetryEvents.length = 0;
    stt.emit({
      type: 'transcript',
      result: {
        text: 'hello world',
        isFinal: false,
        confidence: 0.91,
        language: 'en',
        durationInSeconds: 1.23,
      },
    });

    expect(context.telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.stt.transcript.metadata',
        attributes: {
          provider: 'mock-stt',
          isFinal: false,
          confidence: 0.91,
          language: 'en',
          durationInSeconds: 1.23,
        },
      },
    ]);
    const attributes = context.telemetryEvents[0]?.attributes ?? {};
    expect(attributes).not.toHaveProperty('text');
    expect(attributes).not.toHaveProperty('textLength');
    expect(attributes).not.toHaveProperty('preview');
    expect(attributes).not.toHaveProperty('sessionId');
    expect(attributes).not.toHaveProperty('requestId');

    await manager.disconnect?.();
  });

  test('records STT first-token telemetry once for the first non-final transcript from startListening', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    await clock.tickAsync(12);

    stt.emit({
      type: 'transcript',
      result: {
        text: 'hello world',
        isFinal: false,
        confidence: 0.91,
        language: 'en',
        durationInSeconds: 1.23,
      },
    });

    const firstTokenTimings = getFirstTokenTelemetry(context);

    expect(firstTokenTimings).toEqual([
      {
        name: 'maelstrom.voice_server.stt.first_token.duration',
        duration: 12,
        attributes: {
          provider: 'mock-stt',
          operation: 'start_listening',
          circuitStatus: 'closed',
        },
      },
    ]);

    const attributes = firstTokenTimings[0]?.attributes ?? {};
    expect(attributes).not.toHaveProperty('text');
    expect(attributes).not.toHaveProperty('textLength');
    expect(attributes).not.toHaveProperty('preview');
    expect(attributes).not.toHaveProperty('confidence');
    expect(attributes).not.toHaveProperty('language');
    expect(attributes).not.toHaveProperty('durationInSeconds');
    expect(attributes).not.toHaveProperty('rawAudio');
    expect(attributes).not.toHaveProperty('audio');
    expect(attributes).not.toHaveProperty('chunk');
    expect(attributes).not.toHaveProperty('sessionId');
    expect(attributes).not.toHaveProperty('requestId');

    await manager.disconnect?.();
  });

  test('records STT first-token telemetry only once across multiple non-final transcripts and a final transcript', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();

    stt.emit({
      type: 'transcript',
      result: {
        text: 'first draft',
        isFinal: false,
        confidence: 0.2,
      },
    });
    await clock.tickAsync(5);
    stt.emit({
      type: 'transcript',
      result: {
        text: 'second draft',
        isFinal: false,
        confidence: 0.4,
        language: 'en',
      },
    });
    await clock.tickAsync(5);
    stt.emit({
      type: 'transcript',
      result: {
        text: 'final answer',
        isFinal: true,
        confidence: 0.99,
        durationInSeconds: 2.5,
      },
    });

    const firstTokenTimings = getFirstTokenTelemetry(context);

    expect(firstTokenTimings).toHaveLength(1);
    expect(firstTokenTimings[0]).toMatchObject({
      name: 'maelstrom.voice_server.stt.first_token.duration',
      attributes: {
        provider: 'mock-stt',
        operation: 'start_listening',
        circuitStatus: 'closed',
      },
    });
    expect(firstTokenTimings[0]?.attributes ?? {}).not.toHaveProperty('text');
    expect(firstTokenTimings[0]?.attributes ?? {}).not.toHaveProperty(
      'sessionId',
    );
    expect(firstTokenTimings[0]?.attributes ?? {}).not.toHaveProperty(
      'requestId',
    );

    await manager.disconnect?.();
  });

  test('does not emit STT first-token telemetry when only final transcripts arrive', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    context.telemetryTimings.length = 0;

    stt.emit({
      type: 'transcript',
      result: {
        text: 'final only',
        isFinal: true,
        confidence: 0.88,
        language: 'en',
        durationInSeconds: 1.5,
      },
    });

    expect(getFirstTokenTelemetry(context)).toHaveLength(0);

    await manager.disconnect?.();
  });

  test("does not emit STT first-token telemetry when connect('start_listening') fails before any transcript arrives", async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const error = createMockSTTError(
      'transport',
      'connect failed before transcript',
    );
    const stt = new FailConnectSTTProvider(error, 7);
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          connect: (operation?: 'start_listening' | 'warmup') => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    const connectPromise = manager.connect('start_listening').then(
      () => ({ status: 'fulfilled' as const }),
      (connectError) => ({ status: 'rejected' as const, error: connectError }),
    );

    await clock.tickAsync(7);
    await expect(connectPromise).resolves.toEqual({
      status: 'rejected',
      error,
    });

    expect(getFirstTokenTelemetry(context)).toHaveLength(0);
  });

  test('emits sanitized STT provider error telemetry from provider error events', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          connect: (operation?: 'start_listening' | 'warmup') => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.connect('warmup');
    context.telemetryEvents.length = 0;
    const error = Object.assign(
      createMockSTTError(
        'transport',
        'transcript: hello world leaked to error',
      ),
      {
        cause: { rawText: 'hello world' },
      },
    );

    stt.emit({
      type: 'error',
      error,
    });

    expect(context.telemetryMetrics).toContainEqual({
      name: 'maelstrom.voice_server.provider.error_count',
      value: 1,
      attributes: {
        source: 'stt',
        provider: 'mock-stt',
        kind: 'transport',
      },
    });
    expect(context.telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.provider.error',
        attributes: {
          source: 'stt',
          provider: 'mock-stt',
          kind: 'transport',
        },
      },
    ]);
    const attributes = context.telemetryEvents[0]?.attributes ?? {};
    expect(attributes).not.toHaveProperty('message');
    expect(attributes).not.toHaveProperty('cause');
    expect(attributes).not.toHaveProperty('stack');
    expect(attributes).not.toHaveProperty('error');
    expect(attributes).not.toHaveProperty('rawText');
    expect(attributes).not.toHaveProperty('sessionId');
    expect(attributes).not.toHaveProperty('requestId');
    const metricAttributes = context.telemetryMetrics[0]?.attributes ?? {};
    expect(metricAttributes).not.toHaveProperty('message');
    expect(metricAttributes).not.toHaveProperty('cause');
    expect(metricAttributes).not.toHaveProperty('stack');
    expect(metricAttributes).not.toHaveProperty('error');
    expect(metricAttributes).not.toHaveProperty('rawText');
    expect(metricAttributes).not.toHaveProperty('sessionId');
    expect(metricAttributes).not.toHaveProperty('requestId');
    expect(context.reportedErrors).toEqual([error]);

    await manager.disconnect?.();
  });
});
