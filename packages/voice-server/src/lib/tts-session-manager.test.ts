import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { createTTSSessionManager } from './tts-session-manager.js';
import type {
  SpeechChunk,
  SpeechOptions,
  SpeechStart,
  SpeechSynthesisHandle,
  TTSError,
  TTSEvent,
  TTSProvider,
  VoiceProviderErrorKind,
  VoiceSessionState,
} from './types.js';
import { isVoiceSessionQueuedTurnsDroppedError } from './types.js';

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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createMockTTSError(
  kind: VoiceProviderErrorKind,
  message: string,
): TTSError {
  return Object.assign(new Error(message), {
    source: 'tts' as const,
    provider: 'mock-tts',
    kind,
  });
}

function createSpeechChunk(overrides: Partial<SpeechChunk> = {}): SpeechChunk {
  return {
    data: new Uint8Array([1, 2, 3]),
    format: 'pcm_f32le',
    sampleRate: 16_000,
    isFinal: false,
    ...overrides,
  };
}

class MockTTSProvider implements TTSProvider {
  readonly name = 'mock-tts';
  readonly capabilities = { streamingTts: true };

  private connected = false;
  private listeners = new Set<(event: TTSEvent) => void>();
  readonly spokenTexts: string[] = [];
  stopCalls = 0;
  throwOnConnect = false;
  throwOnStop = false;
  private nextSpeakError: Error | null = null;
  private activeSpeak: {
    completionSettled: boolean;
    resolveCompletion: (reason: 'completed' | 'stopped') => void;
    rejectCompletion: (error: Error) => void;
  } | null = null;

  async connect(): Promise<void> {
    if (this.throwOnConnect) {
      throw new Error('connect failed');
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onEvent(callback: (event: TTSEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle {
    if (this.nextSpeakError) {
      const error = this.nextSpeakError;
      this.nextSpeakError = null;
      throw error;
    }

    this.spokenTexts.push(text);

    let resolveCompletion!: (reason: 'completed' | 'stopped') => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<'completed' | 'stopped'>(
      (resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      },
    );

    this.activeSpeak = {
      completionSettled: false,
      resolveCompletion,
      rejectCompletion,
    };

    return {
      speech: {
        text,
        format: 'pcm_f32le',
        sampleRate: options?.sampleRate ?? 16000,
        queued: false,
      },
      completion,
    };
  }

  stop(): void {
    this.stopCalls += 1;

    if (this.throwOnStop) {
      throw new Error('stop failed');
    }

    this.settleActiveSpeak('stopped');
  }

  settleActiveSpeak(reason: 'completed' | 'stopped'): void {
    if (!this.activeSpeak || this.activeSpeak.completionSettled) {
      return;
    }

    this.activeSpeak.completionSettled = true;
    this.activeSpeak.resolveCompletion(reason);
    this.activeSpeak = null;
  }

  rejectActiveSpeak(error = new Error('completion failed')): void {
    if (!this.activeSpeak || this.activeSpeak.completionSettled) {
      return;
    }

    this.activeSpeak.completionSettled = true;
    this.activeSpeak.rejectCompletion(error);
    this.activeSpeak = null;
  }

  failNextSpeak(error = new Error('speak failed')): void {
    this.nextSpeakError = error;
  }

  emit(event: TTSEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class DelayedConnectTTSProvider extends MockTTSProvider {
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

class FailConnectTTSProvider extends MockTTSProvider {
  constructor(
    private readonly error: unknown,
    private readonly delayMs = 0,
  ) {
    super();
  }

  override async connect(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, this.delayMs);
      });
    }

    throw this.error;
  }
}

function createManager<TProvider extends MockTTSProvider>(
  tts: TProvider = new MockTTSProvider() as TProvider,
  options: {
    emitAudioOutput?: (chunk: SpeechChunk) => number;
  } = {},
) {
  const asyncFailures: Array<{
    event: string;
    error: unknown;
    details?: Record<string, unknown>;
  }> = [];
  const telemetryEvents: RecordedTelemetryEvent[] = [];
  const telemetryMetrics: RecordedTelemetryMetric[] = [];
  const telemetryTimings: RecordedTelemetryTiming[] = [];
  const voiceStates: VoiceSessionState[] = [];
  const traceEvents: Array<{
    event: string;
    details?: Record<string, unknown>;
  }> = [];
  const speechStarts: string[] = [];
  const speechStartEvents: SpeechStart[] = [];
  const speechStops: boolean[] = [];
  let destroyed = false;
  let currentState: VoiceSessionState = 'idle';

  const manager = createTTSSessionManager(tts, {
    isDestroyed: () => destroyed,
    getVoiceState: () => currentState,
    setVoiceState(state) {
      currentState = state;
      voiceStates.push(state);
    },
    trace(event, details) {
      traceEvents.push({ event, details });
    },
    reportError() {},
    reportAsyncFailure(event, error, details) {
      asyncFailures.push({ event, error, details });
    },
    notifyCallbackSafely(callback, _traceEvent, ...args) {
      callback?.(...args);
    },
    emitAudioOutput(chunk: SpeechChunk) {
      return options.emitAudioOutput?.(chunk) ?? 0;
    },
    onSpeechStarted(speech) {
      speechStarts.push(speech.text);
      speechStartEvents.push(speech);
    },
    onSpeechStopped(completed) {
      speechStops.push(completed);
    },
    telemetry: {
      emitProviderError(
        event: RecordedTelemetryEvent,
        metric: RecordedTelemetryMetric,
      ) {
        telemetryEvents.push(event);
        telemetryMetrics.push(metric);
      },
      recordConnectDuration(timing: RecordedTelemetryTiming) {
        telemetryTimings.push(timing);
      },
      recordQueuedTurnsCount(metric: RecordedTelemetryMetric) {
        telemetryMetrics.push(metric);
      },
      recordQueuedTurnsDroppedCount(metric: RecordedTelemetryMetric) {
        telemetryMetrics.push(metric);
      },
      recordFirstByteDuration(timing: RecordedTelemetryTiming) {
        telemetryTimings.push(timing);
      },
      recordSynthesizeDuration(timing: RecordedTelemetryTiming) {
        telemetryTimings.push(timing);
      },
    },
  });

  return {
    manager,
    asyncFailures,
    markDestroyed() {
      destroyed = true;
      manager.destroy();
    },
    speechStarts,
    speechStartEvents,
    speechStops,
    telemetryEvents,
    telemetryMetrics,
    telemetryTimings,
    tts,
    traceEvents,
    voiceStates,
  };
}

describe('tts-session-manager', () => {
  let clock: FakeTimers.InstalledClock;

  beforeEach(() => {
    clock = FakeTimers.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('drains an enqueued successor after the active turn completes', async () => {
    const { manager, speechStarts, speechStops, tts, voiceStates } =
      createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');

    expect(tts.spokenTexts).toEqual(['A']);
    expect(speechStarts).toEqual(['A']);
    expect(voiceStates.at(-1)).toBe('speaking');

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(tts.spokenTexts).toEqual(['A', 'B']);
    expect(speechStarts).toEqual(['A', 'B']);
    expect(speechStops).toEqual([true]);

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(speechStops).toEqual([true, true]);
    expect(voiceStates.at(-1)).toBe('idle');
  });

  test('marks every queued successor in a multi-turn chain', async () => {
    const { manager, speechStartEvents, tts } = createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    manager.enqueueSpeak('C');

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(
      speechStartEvents.map((speech) => ({
        text: speech.text,
        queued: speech.queued,
      })),
    ).toEqual([
      { text: 'A', queued: false },
      { text: 'B', queued: true },
      { text: 'C', queued: true },
    ]);
  });

  test('reports queued-turn drops when a queued successor fails mid-chain', async () => {
    const { asyncFailures, manager, traceEvents, tts } = createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    manager.enqueueSpeak('C');
    tts.failNextSpeak(new Error('provider down'));

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'tts.queued_turns.dropped',
        details: expect.objectContaining({ droppedQueueCount: 1 }),
      }),
    );
    expect(asyncFailures).toHaveLength(1);
    expect(asyncFailures[0]?.event).toBe('tts.queued_speak.failed');
    expect(asyncFailures[0]?.details).toEqual(
      expect.objectContaining({ droppedQueueCount: 1 }),
    );
    expect(isVoiceSessionQueuedTurnsDroppedError(asyncFailures[0]?.error)).toBe(
      true,
    );
    if (!isVoiceSessionQueuedTurnsDroppedError(asyncFailures[0]?.error)) {
      throw new Error('Expected queued-turn drop error');
    }
    expect(asyncFailures[0].error.droppedQueueCount).toBe(1);
    expect(tts.spokenTexts).toEqual(['A']);
  });

  test('destroy clears queued successors before the active turn completes', async () => {
    const { manager, speechStarts, tts, voiceStates, markDestroyed } =
      createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    markDestroyed();

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(tts.spokenTexts).toEqual(['A']);
    expect(speechStarts).toEqual(['A']);
    expect(voiceStates.at(-1)).toBe('speaking');
  });

  test('stop advances the FSM even when tts.stop throws', async () => {
    const { manager, speechStops, tts, voiceStates } = createManager();

    await manager.speakNow('A');
    tts.throwOnStop = true;

    manager.stop('processing');

    expect(speechStops).toEqual([false]);
    expect(voiceStates.at(-1)).toBe('processing');
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('destroy unsubscribes from TTS provider events', async () => {
    const { manager, tts } = createManager();

    await manager.speakNow('A');
    expect(tts.listenerCount()).toBe(1);

    manager.destroy();

    expect(tts.listenerCount()).toBe(0);
  });

  test('surfaces connect rejection without entering speaking state', async () => {
    const { manager, tts, voiceStates } = createManager();

    tts.throwOnConnect = true;

    await expect(manager.speakNow('A')).rejects.toThrow('connect failed');
    expect(voiceStates).toEqual(['speaking', 'idle']);
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('rejected speech completion stops the active turn', async () => {
    const { manager, speechStops, tts, voiceStates } = createManager();

    await manager.speakNow('A');
    tts.rejectActiveSpeak();
    await flushMicrotasks();

    expect(speechStops).toEqual([false]);
    expect(voiceStates.at(-1)).toBe('idle');
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('enqueueSpeak is a no-op after destroy', async () => {
    const { manager, tts, markDestroyed } = createManager();

    markDestroyed();
    manager.enqueueSpeak('A');
    await flushMicrotasks();

    expect(tts.spokenTexts).toEqual([]);
  });

  test('records TTS connect duration telemetry for a successful connect', async () => {
    const { manager, telemetryTimings } = createManager(
      new DelayedConnectTTSProvider(25),
    );

    const speakPromise = manager.speakNow('A');

    await clock.tickAsync(25);
    await speakPromise;

    expect(telemetryTimings).toContainEqual({
      name: 'maelstrom.voice_server.tts.connect.duration',
      duration: 25,
      attributes: {
        provider: 'mock-tts',
        outcome: 'success',
      },
    });
  });

  test('records TTS connect failure duration telemetry without entering an active speech turn', async () => {
    const { manager, telemetryTimings, telemetryEvents, telemetryMetrics } =
      createManager(
        new FailConnectTTSProvider(new Error('connect failed'), 10),
      );

    const speakResult = manager.speakNow('A').then(
      () => ({ status: 'fulfilled' as const }),
      (error) => ({ status: 'rejected' as const, error }),
    );

    await clock.tickAsync(10);

    await expect(speakResult).resolves.toEqual({
      status: 'rejected',
      error: expect.objectContaining({ message: 'connect failed' }),
    });
    expect(telemetryTimings).toContainEqual({
      name: 'maelstrom.voice_server.tts.connect.duration',
      duration: 10,
      attributes: {
        provider: 'mock-tts',
        outcome: 'failure',
      },
    });
    expect(telemetryEvents).toEqual([]);
    expect(telemetryMetrics).toEqual([]);
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('records TTS first-byte telemetry once on first provider chunk with privacy-safe attributes', async () => {
    const { manager, telemetryTimings, tts } = createManager();

    await manager.speakNow('secret reply', 'voice-123');

    tts.emit({
      type: 'chunk',
      chunk: createSpeechChunk({
        text: 'secret reply',
        sequence: 1,
      }),
    });

    const firstByteTimings = telemetryTimings.filter(
      (timing) =>
        timing.name === 'maelstrom.voice_server.tts.first_byte.duration',
    );

    expect(firstByteTimings).toHaveLength(1);
    expect(firstByteTimings).toContainEqual({
      name: 'maelstrom.voice_server.tts.first_byte.duration',
      duration: 0,
      attributes: {
        provider: 'mock-tts',
        queued: false,
        voiceProvided: true,
      },
    });

    const firstByteTiming = firstByteTimings[0]?.attributes ?? {};
    expect(firstByteTiming).not.toHaveProperty('text');
    expect(firstByteTiming).not.toHaveProperty('preview');
    expect(firstByteTiming).not.toHaveProperty('textLength');
    expect(firstByteTiming).not.toHaveProperty('requestedVoice');
    expect(firstByteTiming).not.toHaveProperty('voice');
    expect(firstByteTiming).not.toHaveProperty('voiceId');
    expect(firstByteTiming).not.toHaveProperty('sessionId');
    expect(firstByteTiming).not.toHaveProperty('requestId');
    expect(firstByteTiming).not.toHaveProperty('data');
    expect(firstByteTiming).not.toHaveProperty('chunk');
  });

  test('records TTS first-byte telemetry only once across multiple provider chunks', async () => {
    const { manager, telemetryTimings, tts } = createManager();

    await manager.speakNow('secret reply', 'voice-123');

    tts.emit({
      type: 'chunk',
      chunk: createSpeechChunk({ sequence: 1 }),
    });
    tts.emit({
      type: 'chunk',
      chunk: createSpeechChunk({ sequence: 2, isFinal: true }),
    });

    expect(
      telemetryTimings.filter(
        (timing) =>
          timing.name === 'maelstrom.voice_server.tts.first_byte.duration',
      ),
    ).toHaveLength(1);
  });

  test('records TTS first-byte telemetry before audio forwarding reaches emitAudioOutput', async () => {
    const audioForwardingTelemetryCounts: number[] = [];
    const { manager, telemetryTimings, tts } = createManager(
      new MockTTSProvider(),
      {
        emitAudioOutput() {
          audioForwardingTelemetryCounts.push(
            telemetryTimings.filter(
              (timing) =>
                timing.name ===
                'maelstrom.voice_server.tts.first_byte.duration',
            ).length,
          );
          return 1;
        },
      },
    );

    await manager.speakNow('secret reply', 'voice-123');

    tts.emit({
      type: 'chunk',
      chunk: createSpeechChunk({ sequence: 1 }),
    });

    expect(audioForwardingTelemetryCounts).toEqual([1]);
    expect(
      telemetryTimings.filter(
        (timing) =>
          timing.name === 'maelstrom.voice_server.tts.first_byte.duration',
      ),
    ).toContainEqual({
      name: 'maelstrom.voice_server.tts.first_byte.duration',
      duration: 0,
      attributes: {
        provider: 'mock-tts',
        queued: false,
        voiceProvided: true,
      },
    });
  });

  test('does not record TTS first-byte telemetry when speak fails before any provider chunk arrives', async () => {
    const { manager, telemetryTimings, tts } = createManager();

    tts.failNextSpeak(new Error('speak failed'));

    await expect(manager.speakNow('secret reply', 'voice-123')).rejects.toThrow(
      'speak failed',
    );

    expect(
      telemetryTimings.some(
        (timing) =>
          timing.name === 'maelstrom.voice_server.tts.first_byte.duration',
      ),
    ).toBe(false);
  });

  test('records sanitized TTS synthesize telemetry without text or voice identifiers', async () => {
    const { manager, telemetryTimings, tts } = createManager();

    await manager.speakNow('secret reply', 'voice-123');
    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(telemetryTimings).toContainEqual({
      name: 'maelstrom.voice_server.tts.synthesize.duration',
      duration: 0,
      attributes: {
        provider: 'mock-tts',
        queued: false,
        outcome: 'completed',
        voiceProvided: true,
      },
    });
    const synthTiming = telemetryTimings.find(
      (timing) =>
        timing.name === 'maelstrom.voice_server.tts.synthesize.duration',
    );
    const attributes = synthTiming?.attributes ?? {};
    expect(attributes).not.toHaveProperty('text');
    expect(attributes).not.toHaveProperty('preview');
    expect(attributes).not.toHaveProperty('textLength');
    expect(attributes).not.toHaveProperty('requestedVoice');
    expect(attributes).not.toHaveProperty('voice');
    expect(attributes).not.toHaveProperty('voiceId');
    expect(attributes).not.toHaveProperty('sessionId');
    expect(attributes).not.toHaveProperty('requestId');
  });

  test('records queued-turn queue counts and dropped queued-turn counts without text metadata', async () => {
    const { manager, telemetryMetrics, tts } = createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    manager.enqueueSpeak('C');
    tts.failNextSpeak(new Error('provider down'));

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(telemetryMetrics).toEqual([
      {
        name: 'maelstrom.voice_server.queued_turns.count',
        value: 1,
      },
      {
        name: 'maelstrom.voice_server.queued_turns.count',
        value: 2,
      },
      {
        name: 'maelstrom.voice_server.queued_turns.dropped_count',
        value: 1,
      },
    ]);
    for (const metric of telemetryMetrics) {
      const attributes = metric.attributes ?? {};
      expect(attributes).not.toHaveProperty('text');
      expect(attributes).not.toHaveProperty('preview');
      expect(attributes).not.toHaveProperty('textLength');
      expect(attributes).not.toHaveProperty('requestedVoice');
      expect(attributes).not.toHaveProperty('voice');
      expect(attributes).not.toHaveProperty('voiceId');
      expect(attributes).not.toHaveProperty('message');
      expect(attributes).not.toHaveProperty('sessionId');
      expect(attributes).not.toHaveProperty('requestId');
    }
  });

  test('emits sanitized TTS provider error telemetry from provider error events', async () => {
    const { manager, telemetryEvents, telemetryMetrics, tts } = createManager();

    await manager.connect();
    telemetryEvents.length = 0;
    telemetryMetrics.length = 0;
    const error = Object.assign(
      createMockTTSError(
        'transport',
        'secret reply leaked into provider error',
      ),
      {
        cause: { rawText: 'secret reply' },
      },
    );

    tts.emit({
      type: 'error',
      error,
    });

    expect(telemetryMetrics).toEqual([
      {
        name: 'maelstrom.voice_server.provider.error_count',
        value: 1,
        attributes: {
          source: 'tts',
          provider: 'mock-tts',
          kind: 'transport',
        },
      },
    ]);
    expect(telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.provider.error',
        attributes: {
          source: 'tts',
          provider: 'mock-tts',
          kind: 'transport',
        },
      },
    ]);
    const attributes = telemetryEvents[0]?.attributes ?? {};
    expect(attributes).not.toHaveProperty('message');
    expect(attributes).not.toHaveProperty('cause');
    expect(attributes).not.toHaveProperty('stack');
    expect(attributes).not.toHaveProperty('error');
    expect(attributes).not.toHaveProperty('rawText');
    expect(attributes).not.toHaveProperty('sessionId');
    expect(attributes).not.toHaveProperty('requestId');
    const metricAttributes = telemetryMetrics[0]?.attributes ?? {};
    expect(metricAttributes).not.toHaveProperty('message');
    expect(metricAttributes).not.toHaveProperty('cause');
    expect(metricAttributes).not.toHaveProperty('stack');
    expect(metricAttributes).not.toHaveProperty('error');
    expect(metricAttributes).not.toHaveProperty('rawText');
    expect(metricAttributes).not.toHaveProperty('sessionId');
    expect(metricAttributes).not.toHaveProperty('requestId');
  });
});
