import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  MessageId,
  SessionId,
  type ChartRequest,
  type MaelstromResponse,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { createVoiceSession, defaultAudioDropDebounceMs } from './runtime.js';
import { sttProviderFactories } from './stt/registry.js';
import { resolveVoiceSessionConfig } from './types.js';
import type {
  AudioChunk,
  ProcessIntent,
  SpeechOptions,
  STTError,
  STTEvent,
  STTProvider,
  TTSError,
  TTSEvent,
  TTSProvider,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionCallbacks,
  VoiceSessionConfig,
  VoiceSessionIntentRequestBuilder,
} from './types.js';
import { ttsProviderFactories } from './tts/registry.js';

type ProcessIntentResponse = Awaited<ReturnType<ProcessIntent['process']>>;

function createMockSTTError(kind: STTError['kind'], message: string): STTError {
  return Object.assign(new Error(message), {
    source: 'stt' as const,
    provider: 'mock-stt',
    kind,
  });
}

function createMockTTSError(kind: TTSError['kind'], message: string): TTSError {
  return Object.assign(new Error(message), {
    source: 'tts' as const,
    provider: 'mock-tts',
    kind,
  });
}

class MockSTTProvider implements STTProvider {
  readonly name = 'mock-stt';
  readonly capabilities = {
    interimTranscripts: true,
  };

  protected connected = false;
  protected listeners = new Set<(event: STTEvent) => void>();
  readonly sentAudioChunks: AudioChunk[] = [];
  connectCalls = 0;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
    this.emit({ type: 'connected' });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit({ type: 'disconnected' });
  }

  sendAudio(_chunk: AudioChunk): void {
    this.sentAudioChunks.push(_chunk);
  }

  endStream(): void {}

  onEvent(callback: (event: STTEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  emit(event: STTEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class FailOnNthConnectSTTProvider extends MockSTTProvider {
  constructor(
    private readonly failingAttempts: number[],
    private readonly failureMessage = 'mock stt connect failure',
  ) {
    super();
  }

  private connectAttempts = 0;

  override async connect(): Promise<void> {
    this.connectAttempts += 1;
    if (this.failingAttempts.includes(this.connectAttempts)) {
      throw new Error(this.failureMessage);
    }

    await super.connect();
  }
}

class SyncFinalOnEndStreamSTTProvider extends MockSTTProvider {
  constructor(private readonly finalText: string) {
    super();
  }

  override endStream(): void {
    this.emit({
      type: 'transcript',
      result: { text: this.finalText, isFinal: true },
    });
    super.endStream();
  }
}

class DisconnectOnNthSendSTTProvider extends MockSTTProvider {
  constructor(private readonly disconnectOnSendCounts: number[]) {
    super();
  }

  override sendAudio(chunk: AudioChunk): void {
    super.sendAudio(chunk);

    if (this.disconnectOnSendCounts.includes(this.sentAudioChunks.length)) {
      this.connected = false;
      this.emit({ type: 'disconnected' });
    }
  }
}

class ThrowOnNthSendSTTProvider extends MockSTTProvider {
  constructor(
    private readonly throwOnSendCount: number,
    private readonly failureMessage = 'mock replay send failure',
  ) {
    super();
  }

  override sendAudio(chunk: AudioChunk): void {
    if (this.sentAudioChunks.length + 1 === this.throwOnSendCount) {
      throw new Error(this.failureMessage);
    }

    super.sendAudio(chunk);
  }
}

class ThrowOnceOnSendSTTProvider extends MockSTTProvider {
  private hasThrown = false;

  constructor(private readonly failureMessage = 'mock replay send failure') {
    super();
  }

  override sendAudio(chunk: AudioChunk): void {
    if (!this.hasThrown) {
      this.hasThrown = true;
      throw new Error(this.failureMessage);
    }

    super.sendAudio(chunk);
  }
}

class ThrowAndDisconnectOnceOnSendSTTProvider extends MockSTTProvider {
  private hasThrown = false;

  constructor(private readonly failureMessage = 'mock live send failure') {
    super();
  }

  override sendAudio(chunk: AudioChunk): void {
    if (!this.hasThrown) {
      this.hasThrown = true;
      this.connected = false;
      this.emit({ type: 'disconnected' });
      throw new Error(this.failureMessage);
    }

    super.sendAudio(chunk);
  }
}

class MockTTSProvider implements TTSProvider {
  readonly name = 'mock-tts';
  readonly capabilities = { streamingTts: true };

  private connected = false;
  private listeners = new Set<(event: TTSEvent) => void>();
  readonly spokenTexts: string[] = [];
  stopCalls = 0;

  async connect(): Promise<void> {
    this.connected = true;
    this.emit({ type: 'connected' });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit({ type: 'disconnected' });
  }

  speak(text: string, _options?: SpeechOptions): void {
    this.spokenTexts.push(text);
  }

  stop(): void {
    this.stopCalls += 1;
    this.emit({ type: 'stopped' });
  }

  onEvent(callback: (event: TTSEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  emit(event: TTSEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class AutoEventTTSProvider extends MockTTSProvider {
  override speak(text: string, options?: SpeechOptions): void {
    super.speak(text, options);
    this.emit({
      type: 'started',
      speech: {
        text,
        format: 'pcm_f32le',
        sampleRate: options?.sampleRate ?? 16000,
      },
    });
  }
}

class EventOnlyTTSProvider extends MockTTSProvider {
  override speak(text: string, options?: SpeechOptions): void {
    super.speak(text, options);
    this.emit({
      type: 'started',
      speech: {
        text,
        format: 'pcm_f32le',
        sampleRate: options?.sampleRate ?? 16000,
      },
    });
    this.emit({ type: 'completed' });
  }
}

let clock: ReturnType<typeof FakeTimers.install>;

function advance(ms: number): Promise<number> {
  return clock.tickAsync(ms);
}

function createRequestId(text: string): ReturnType<typeof MessageId> {
  return MessageId(`req-${text.replace(/\s+/g, '-')}`);
}

function getRequestId(request: ChartRequest): ReturnType<typeof MessageId> {
  const userIntent = request.context.updateReasons.find(
    (reason): reason is Extract<typeof reason, { type: 'user_intent' }> =>
      reason.type === 'user_intent',
  );

  return createRequestId(userIntent?.intent ?? 'test');
}

function createProcessResponse(
  request: ChartRequest,
  overrides: Partial<MaelstromResponse> = {},
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: getRequestId(request),
    userMessage: '',
    rationale: '',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
    ...overrides,
  };
}

function createRequest(text: string): ChartRequest {
  return {
    type: 'chart_request' as const,
    context: {
      updateReasons: [{ type: 'user_intent' as const, intent: text }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'tiling' as const,
    },
    instances: [],
    vessels: [],
    layout: { type: 'tiling' as const, tree: [], instances: [] },
  };
}

const defaultBuildChartRequest: VoiceSessionIntentRequestBuilder = ({
  transcript,
}) => createRequest(transcript);

const defaultProcessIntent: ProcessIntent = {
  async process(request) {
    return createProcessResponse(request);
  },
};

const sharedVadFinalDebounceMs = 500;
const audioDropDebounceMs = defaultAudioDropDebounceMs;

type AudioDroppedEvent = VoiceSessionAudioDroppedEvent;

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

function makeOpusChunk(
  sequence: number,
  overrides: Partial<AudioChunk> = {},
): AudioChunk {
  return {
    data: Uint8Array.from([1, 2, 3, 4]),
    sampleRate: 48000,
    encoding: 'opus',
    timestamp: sequence,
    sequence,
    ...overrides,
  };
}

function createAudioDroppedRecorder() {
  const events: AudioDroppedEvent[] = [];

  function record(event: AudioDroppedEvent) {
    const previousEvent = events.at(-1);

    if (
      previousEvent?.type === event.type &&
      previousEvent.reason === event.reason &&
      previousEvent.droppedDurationMs === event.droppedDurationMs
    ) {
      return;
    }

    events.push(event);
  }

  const callbacks: VoiceSessionCallbacks & {
    onAudioDropped?: (event: AudioDroppedEvent) => void;
  } = {
    onAudioDropped(event: AudioDroppedEvent) {
      record(event);
    },
  };

  return {
    events,
    callbacks,
    attach(runtime: ReturnType<typeof createVoiceSession>) {
      runtime.onAudioDropped((event) => {
        record(event);
      });
    },
  };
}

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

function withPatchedProviderFactories<T>(
  providers: {
    stt?: STTProvider;
    tts?: TTSProvider;
  },
  run: () => T,
): T {
  const originalSTTFactory = sttProviderFactories[testSTTProviderType];
  const originalTTSFactory = ttsProviderFactories[testTTSProviderType];

  if (providers.stt) {
    sttProviderFactories[testSTTProviderType] = () => providers.stt!;
  }

  if (providers.tts) {
    ttsProviderFactories[testTTSProviderType] = () => providers.tts!;
  }

  try {
    return run();
  } finally {
    sttProviderFactories[testSTTProviderType] = originalSTTFactory;
    ttsProviderFactories[testTTSProviderType] = originalTTSFactory;
  }
}

function createConfig(overrides: Partial<VoiceSessionConfig> = {}) {
  const stt = new MockSTTProvider();
  const tts = new MockTTSProvider();

  const config: VoiceSessionConfig = {
    stt: createSTTTestConfig(),
    tts: createTTSTestConfig(),
    sessionId: SessionId('session-test'),
    buildChartRequest: defaultBuildChartRequest,
    processIntent: defaultProcessIntent,
    ...overrides,
  };

  function createRuntime(callbacks?: VoiceSessionCallbacks) {
    return withPatchedProviderFactories({ stt, tts }, () =>
      createVoiceSession(config, callbacks),
    );
  }

  return { config, stt, tts, createRuntime };
}

describe('resolveVoiceSessionConfig', () => {
  test('applies runtime defaults and derives interim results from provider capabilities', () => {
    const resolved = resolveVoiceSessionConfig(
      {
        stt: createSTTTestConfig({ interimResults: false }),
        tts: createTTSTestConfig({ sampleRate: 32000 }),
        sessionId: SessionId('resolve-session'),
      },
      {
        vadFinalDebounceMs: 250,
        audioBufferMaxMs: 12,
        maxReconnectAttempts: 4,
        reconnectDelayMs: 1500,
      },
    );

    expect(resolved.vadFinalDebounceMs).toBe(250);
    expect(resolved.audioBufferMaxMs).toBe(12);
    expect(resolved.maxReconnectAttempts).toBe(4);
    expect(resolved.reconnectDelayMs).toBe(1500);
    expect(resolved.autoRestartListening).toBe(true);
    expect(resolved.interimResults).toBe(false);
    expect(resolved.intentBoundary).toBeNull();
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
        {
          vadFinalDebounceMs: 250,
          audioBufferMaxMs: 12,
          maxReconnectAttempts: 4,
          reconnectDelayMs: 1500,
        },
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
        {
          vadFinalDebounceMs: 250,
          audioBufferMaxMs: 12,
          maxReconnectAttempts: 4,
          reconnectDelayMs: 1500,
        },
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
        {
          vadFinalDebounceMs: 250,
          audioBufferMaxMs: 12,
          maxReconnectAttempts: 4,
          reconnectDelayMs: 1500,
        },
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
        {
          vadFinalDebounceMs: 250,
          audioBufferMaxMs: 12,
          maxReconnectAttempts: 4,
          reconnectDelayMs: 1500,
        },
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
        {
          vadFinalDebounceMs: 250,
          audioBufferMaxMs: 12,
          maxReconnectAttempts: 4,
          reconnectDelayMs: 1500,
        },
      ),
    ).toThrow(
      'Voice session audioBufferMaxMs must be a finite number greater than 0, received 0',
    );
  });
});

describe('createVoiceSession runtime finalization', () => {
  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('buildChartRequest uses named transcript/sessionId input for finalized turns', async () => {
    const processCalls: string[] = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        processCalls.push(
          request.context.updateReasons[0]?.type === 'user_intent'
            ? request.context.updateReasons[0].intent
            : '',
        );

        return createProcessResponse(request);
      },
    };

    const { stt, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'hello world', isFinal: true },
    });

    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await runtime.stopListening();
    await advance(0);

    expect(processCalls).toEqual(['hello world']);
  });

  test('uses the shared default VAD debounce until an app overrides it', async () => {
    const processCalls: string[] = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { stt, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'shared default finalize', isFinal: true },
    });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(250);
    expect(processCalls).toEqual([]);

    await advance(275);
    expect(processCalls).toEqual(['shared default finalize']);
  });

  test('builds providers from registry-backed config and defaults interimResults from STT capabilities', async () => {
    const processCalls: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const stt = new MockSTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        buildChartRequest: defaultBuildChartRequest,
        processIntent,
      });

      runtime.onTranscript((result) => {
        seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
      });

      await runtime.startListening();
      stt.emit({
        type: 'transcript',
        result: { text: 'registry path', isFinal: false },
      });
      stt.emit({
        type: 'transcript',
        result: { text: 'registry path', isFinal: true },
      });
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

      await advance(sharedVadFinalDebounceMs);
      await advance(0);

      expect(seenTranscripts).toEqual([
        { text: 'registry path', isFinal: false },
        { text: 'registry path', isFinal: false },
        { text: 'registry path', isFinal: true },
      ]);
      expect(processCalls).toEqual(['registry path']);
    });
  });

  test('returns to idle on manual stop when no speech was captured', async () => {
    const processCalls: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();

    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    await runtime.stopListening();

    expect(runtime.getVoiceState()).toBe('idle');
    expect(processCalls).toEqual([]);
    expect(seenTranscripts).toEqual([]);
  });

  test('finalizes the live interim transcript when capture stops before a provider final arrives', async () => {
    const processCalls: string[] = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const { stt, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();

    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'hello world', isFinal: false },
    });

    await runtime.stopListening();
    await advance(0);

    expect(processCalls).toEqual(['hello world']);
    expect(seenTranscripts).toEqual([
      { text: 'hello world', isFinal: false },
      { text: 'hello world', isFinal: true },
    ]);
  });

  test('finalizes a synchronous endStream transcript only once on manual stop', async () => {
    let resolveProcess!: (value: ProcessIntentResponse) => void;
    const processResponse = new Promise<ProcessIntentResponse>((resolve) => {
      resolveProcess = resolve;
    });
    const processCalls: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const processIntent: ProcessIntent = {
      process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return processResponse;
      },
    };

    const stt = new SyncFinalOnEndStreamSTTProvider('hello world');
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          buildChartRequest: defaultBuildChartRequest,
          processIntent,
        },
        {
          onTranscript(result) {
            seenTranscripts.push({
              text: result.text,
              isFinal: result.isFinal,
            });
          },
        },
      );

      await runtime.startListening();
      stt.emit({
        type: 'transcript',
        result: { text: 'hello world', isFinal: false },
      });

      await runtime.stopListening();
      await advance(0);

      expect(runtime.getVoiceState()).toBe('processing');
      expect(processCalls).toEqual(['hello world']);
      expect(seenTranscripts).toEqual([
        { text: 'hello world', isFinal: false },
        { text: 'hello world', isFinal: true },
      ]);

      resolveProcess({
        type: 'maelstrom_response',
        requestId: MessageId('req-hello-world'),
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      });
      await advance(0);

      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('ignores stale in-flight process results after a newer utterance wins', async () => {
    let firstResolve!: (value: ProcessIntentResponse) => void;
    const firstResponse = new Promise<ProcessIntentResponse>((resolve) => {
      firstResolve = resolve;
    });
    const signals: AbortSignal[] = [];

    const processIntent: ProcessIntent = {
      process(request, signal) {
        signals.push(signal ?? new AbortController().signal);

        if (
          request.context.updateReasons[0]?.type === 'user_intent' &&
          request.context.updateReasons[0].intent === 'first'
        ) {
          return firstResponse;
        }

        return Promise.resolve(
          createProcessResponse(request, {
            userMessage: 'second reply',
          }),
        );
      },
    };

    const { stt, tts, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'first', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'second', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);

    firstResolve({
      type: 'maelstrom_response',
      requestId: MessageId('req-first'),
      userMessage: 'stale reply',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
    await advance(0);

    expect(signals[0]?.aborted).toBe(true);
    expect(tts.spokenTexts).toEqual(['second reply']);
  });

  test('aborts in-flight processing when listening restarts before a new utterance finalizes', async () => {
    let firstResolve!: (value: ProcessIntentResponse) => void;
    const firstResponse = new Promise<ProcessIntentResponse>((resolve) => {
      firstResolve = resolve;
    });
    const signals: AbortSignal[] = [];

    const processIntent: ProcessIntent = {
      process(request, signal) {
        signals.push(signal ?? new AbortController().signal);

        if (
          request.context.updateReasons[0]?.type === 'user_intent' &&
          request.context.updateReasons[0].intent === 'first'
        ) {
          return firstResponse;
        }

        return Promise.resolve(
          createProcessResponse(request, {
            userMessage: 'fresh reply',
          }),
        );
      },
    };

    const { stt, tts, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'first', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);

    expect(runtime.getVoiceState()).toBe('processing');

    await runtime.startListening();

    expect(runtime.getVoiceState()).toBe('listening');
    expect(signals[0]?.aborted).toBe(true);

    firstResolve({
      type: 'maelstrom_response',
      requestId: MessageId('req-first'),
      userMessage: 'stale reply',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
    await advance(0);

    expect(tts.spokenTexts).toEqual([]);
  });

  test('accumulates multiple final transcript fragments into one finalized utterance', async () => {
    const processCalls: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { stt, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();
    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'hello', isFinal: true } });
    stt.emit({ type: 'transcript', result: { text: 'world', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);

    expect(seenTranscripts).toEqual([
      { text: 'hello', isFinal: false },
      { text: 'hello world', isFinal: false },
      { text: 'hello world', isFinal: true },
    ]);
    expect(processCalls).toEqual(['hello world']);
  });

  test('uses configured VAD debounce timing for finalization', async () => {
    const processCalls: string[] = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { stt, createRuntime } = createConfig({
      processIntent,
      vadFinalDebounceMs: 10,
    });
    const runtime = createRuntime();

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'fast finalize', isFinal: true },
    });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(5);
    expect(processCalls).toEqual([]);

    await advance(25);
    expect(processCalls).toEqual(['fast finalize']);
  });

  test('isolates transcript listeners so one throwing observer does not break the others', async () => {
    const reportedErrors: string[] = [];
    const seenTranscripts: string[] = [];
    const { stt, createRuntime } = createConfig();
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    runtime.onTranscript(() => {
      throw new Error('listener exploded');
    });
    runtime.onTranscript((result) => {
      seenTranscripts.push(result.text);
    });

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'hello', isFinal: false } });

    expect(seenTranscripts).toEqual(['hello']);
    expect(reportedErrors).toEqual(['listener exploded']);
  });

  test('reports each failed reconnect attempt before stopping after max retries', async () => {
    const reportedErrors: Error[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new FailOnNthConnectSTTProvider([2, 3]);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          maxReconnectAttempts: 2,
          trace(event, details) {
            traceEvents.push({ event, details });
          },
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      await runtime.startListening();
      await stt.disconnect();
      await advance(10);

      expect(
        traceEvents
          .filter((entry) => entry.event === 'stt.reconnect.failed')
          .map((entry) => entry.details?.attempt),
      ).toEqual([1, 2]);
      expect(
        traceEvents
          .filter((entry) => entry.event === 'stt.reconnect.failed')
          .map((entry) => entry.details?.message),
      ).toEqual(['mock stt connect failure', 'mock stt connect failure']);
      expect(reportedErrors.map((error) => error.message)).toEqual([
        'STT connection lost after max retries',
      ]);
      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('surfaces non-transport STT provider errors through onError and returns to idle', async () => {
    const reportedErrors: Error[] = [];
    const { stt, createRuntime } = createConfig();
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error);
      },
    });

    await runtime.startListening();
    stt.emit({
      type: 'error',
      error: createMockSTTError('server', 'mock stt provider error'),
    });

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe('mock stt provider error');
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('keeps reconnect eligible after a transport STT error until disconnect triggers recovery', async () => {
    const reportedErrors: Error[] = [];
    const { stt, createRuntime } = createConfig({ reconnectDelayMs: 1 });
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error);
      },
    });

    await runtime.startListening();
    stt.emit({
      type: 'error',
      error: createMockSTTError('transport', 'mock stt transport error'),
    });
    await stt.disconnect();
    await advance(10);

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe('mock stt transport error');
    expect((reportedErrors[0] as STTError).kind).toBe('transport');
    expect(runtime.getVoiceState()).toBe('listening');
    expect(stt.connectCalls).toBe(2);
  });

  test('reuses one reconnect attempt when duplicate disconnect events arrive before reconnect succeeds', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new MockSTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        reconnectDelayMs: 1,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      await stt.disconnect();
      stt.emit({ type: 'disconnected' });
      stt.emit({ type: 'disconnected' });
      await advance(10);

      expect(stt.connectCalls).toBe(2);
      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.attempt'),
      ).toHaveLength(1);
      expect(
        traceEvents.filter(
          (entry) => entry.event === 'stt.reconnect.succeeded',
        ),
      ).toHaveLength(1);
      expect(runtime.getVoiceState()).toBe('listening');
    });
  });

  test('reuses the active reconnect lifecycle when disconnect fires repeatedly', async () => {
    const reportedErrors: Error[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new FailOnNthConnectSTTProvider([2]);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          maxReconnectAttempts: 1,
          trace(event, details) {
            traceEvents.push({ event, details });
          },
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      await runtime.startListening();
      await stt.disconnect();
      stt.emit({ type: 'disconnected' });
      await advance(10);

      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.attempt'),
      ).toHaveLength(1);
      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.failed'),
      ).toHaveLength(1);
      expect(reportedErrors.map((error) => error.message)).toEqual([
        'STT connection lost after max retries',
      ]);
      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('preserves the final reconnect failure cause', async () => {
    const reportedErrors: Error[] = [];
    const stt = new FailOnNthConnectSTTProvider([2], 'root reconnect failure');
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          maxReconnectAttempts: 1,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      await runtime.startListening();
      await stt.disconnect();
      await advance(10);

      expect(reportedErrors).toHaveLength(1);
      expect(reportedErrors[0]?.message).toBe(
        'STT connection lost after max retries',
      );
      expect(reportedErrors[0]?.cause).toBeInstanceOf(Error);
      expect((reportedErrors[0]?.cause as Error | undefined)?.message).toBe(
        'root reconnect failure',
      );
    });
  });

  test('surfaces TTS provider error events through onError and returns to idle', async () => {
    const reportedErrors: Error[] = [];
    const { tts, createRuntime } = createConfig();
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error);
      },
    });

    await runtime.speak('hello world');
    tts.emit({
      type: 'error',
      error: createMockTTSError('server', 'mock tts provider error'),
    });

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe('mock tts provider error');
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('reports auto-restart startListening failures instead of swallowing them', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new FailOnNthConnectSTTProvider([2]);
    const tts = new AutoEventTTSProvider();
    const processIntent: ProcessIntent = {
      async process(request) {
        return createProcessResponse(request, {
          userMessage: 'hello back',
        });
      },
    };

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          trace(event, details) {
            traceEvents.push({ event, details });
          },
          processIntent,
          buildChartRequest: defaultBuildChartRequest,
        },
        {
          onError(error) {
            reportedErrors.push(error.message);
          },
        },
      );

      await runtime.startListening();
      stt.emit({
        type: 'transcript',
        result: { text: 'hello', isFinal: true },
      });
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
      await advance(500);

      expect(runtime.getVoiceState()).toBe('speaking');

      await stt.disconnect();
      tts.emit({ type: 'completed' });
      await advance(550);

      expect(reportedErrors).toContain('mock stt connect failure');
      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.attempt'),
      ).toHaveLength(0);
    });
  });

  test('drops oldest buffered audio by duration and reports droppedDurationMs', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(audioDropDebounceMs - 1);
    expect(audioDropped.events).toEqual([]);

    await advance(2);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);

    await runtime.startListening();

    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
  });

  test('reports buffered-audio overflow instead of silently dropping it', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({ audioBufferMaxMs: 0.05 });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk({
      data: Uint8Array.from([1]),
      sampleRate: 16000,
      encoding: 'linear16',
      timestamp: 1,
      sequence: 1,
    });
    runtime.sendAudioChunk({
      data: Uint8Array.from([2]),
      sampleRate: 16000,
      encoding: 'linear16',
      timestamp: 2,
      sequence: 2,
    });

    await runtime.startListening();
    await advance(audioDropDebounceMs + 1);

    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 0.03125,
      },
    ]);
    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
  });

  test('replays buffered audio in FIFO order after reconnect', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new MockSTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        reconnectDelayMs: 1,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      await stt.disconnect();

      runtime.sendAudioChunk({
        data: Uint8Array.from([1]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 1,
        sequence: 1,
      });
      runtime.sendAudioChunk({
        data: Uint8Array.from([2]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 2,
        sequence: 2,
      });
      runtime.sendAudioChunk({
        data: Uint8Array.from([3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 3,
        sequence: 3,
      });

      await advance(10);

      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([
        1, 2, 3,
      ]);
      expect(
        traceEvents
          .filter((entry) => entry.event === 'stt.buffered_audio.replayed')
          .map((entry) => entry.details?.remainingBufferedAudioMs),
      ).toEqual([0.0625, 0.03125, 0]);
    });
  });

  test('stops replay without losing remaining buffered audio when disconnect happens mid-flush', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new DisconnectOnNthSendSTTProvider([1]);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        reconnectDelayMs: 1,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      await stt.disconnect();

      runtime.sendAudioChunk({
        data: Uint8Array.from([1]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 1,
        sequence: 1,
      });
      runtime.sendAudioChunk({
        data: Uint8Array.from([2]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 2,
        sequence: 2,
      });
      runtime.sendAudioChunk({
        data: Uint8Array.from([3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 3,
        sequence: 3,
      });

      await advance(10);

      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([1]);
      expect(traceEvents).toContainEqual(
        expect.objectContaining({
          event: 'stt.buffered_audio.flush_stopped',
          details: expect.objectContaining({
            reason: 'stt_disconnected',
            pendingBufferedAudioMs: 0.0625,
            nextBufferedAudioSequence: 2,
          }),
        }),
      );

      stt.emit({ type: 'disconnected' });
      await advance(10);

      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([
        1, 2, 3,
      ]);
      expect(
        traceEvents
          .filter((entry) => entry.event === 'stt.buffered_audio.replayed')
          .map((entry) => entry.details?.remainingBufferedAudioMs),
      ).toEqual([0.0625, 0.03125, 0]);
    });
  });

  test('debounces reconnect-buffer audio_dropped notifications and sums droppedDurationMs', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({
      reconnectDelayMs: 1000,
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    await stt.disconnect();

    runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));
    runtime.sendAudioChunk(makeLinear16Chunk(3, 3));

    await advance(audioDropDebounceMs - 1);
    expect(audioDropped.events).toEqual([]);

    await advance(2);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 8,
      },
    ]);
  });

  test('coalesces overflow notifications without starving them under sustained pressure', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));
    await advance(50);
    runtime.sendAudioChunk(makeLinear16Chunk(4, 3));
    await advance(60);

    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 8,
      },
    ]);

    await advance(audioDropDebounceMs);
    expect(audioDropped.events).toHaveLength(1);
  });

  test('flushes the pending audio_dropped bucket immediately when the reason changes within the debounce window', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({
      audioBufferMaxMs: 5,
      reconnectDelayMs: 1000,
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);
    expect(audioDropped.events).toEqual([]);

    await runtime.startListening();
    await stt.disconnect();
    runtime.sendAudioChunk(makeLinear16Chunk(4, 3));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 4));

    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);

    await advance(audioDropDebounceMs + 1);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 4,
      },
    ]);
  });

  test('does not emit debounced audio_dropped notifications after destroy', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({
      reconnectDelayMs: 1000,
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    await stt.disconnect();

    runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);
    runtime.destroy();
    await advance(audioDropDebounceMs);

    expect(audioDropped.events).toEqual([]);
  });

  test('clears buffered reconnect audio and pending drop state on stopListening', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const { stt, createRuntime } = createConfig({
      reconnectDelayMs: 1000,
      audioBufferMaxMs: 5,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    await stt.disconnect();

    runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);
    await runtime.stopListening();
    await advance(audioDropDebounceMs);

    expect(audioDropped.events).toEqual([]);
    expect(runtime.getVoiceState()).toBe('idle');
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.stop_listening.requested',
        details: expect.objectContaining({
          pendingBufferedAudioMs: 4,
        }),
      }),
    );
  });

  test('flushes pending reconnect audio_dropped notifications before reconnect exhaustion', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: Error[] = [];
    const stt = new FailOnNthConnectSTTProvider([2]);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          maxReconnectAttempts: 1,
          audioBufferMaxMs: 5,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          ...audioDropped.callbacks,
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      audioDropped.attach(runtime);

      await runtime.startListening();
      await stt.disconnect();

      runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
      runtime.sendAudioChunk(makeLinear16Chunk(4, 2));
      await advance(10);

      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'reconnect_buffer_full',
          droppedDurationMs: 4,
        },
      ]);
      expect(reportedErrors.map((error) => error.message)).toContain(
        'STT connection lost after max retries',
      );

      await runtime.startListening();
      await advance(audioDropDebounceMs + 1);

      expect(stt.sentAudioChunks).toEqual([]);
      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'reconnect_buffer_full',
          droppedDurationMs: 4,
        },
      ]);
    });
  });

  test('emits audio_dropped to listeners and callback with the same payload', async () => {
    const callbackEvents: AudioDroppedEvent[] = [];
    const listenerEvents: AudioDroppedEvent[] = [];
    const { createRuntime } = createConfig({
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime({
      onAudioDropped(event: AudioDroppedEvent) {
        callbackEvents.push(event);
      },
    });

    runtime.onAudioDropped((event) => {
      listenerEvents.push(event);
    });

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(audioDropDebounceMs + 1);

    expect(listenerEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);
    expect(callbackEvents).toEqual(listenerEvents);
  });

  test('isolates audio_dropped listeners so one throwing observer does not break the others', async () => {
    const reportedErrors: string[] = [];
    const seenEvents: AudioDroppedEvent[] = [];
    const { createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    runtime.onAudioDropped(() => {
      throw new Error('audio drop listener exploded');
    });
    runtime.onAudioDropped((event) => {
      seenEvents.push(event);
    });

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(audioDropDebounceMs + 1);

    expect(seenEvents).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);
    expect(reportedErrors).toContain('audio drop listener exploded');
  });

  test('rejects a single buffered chunk that exceeds audioBufferMaxMs even after draining the queue', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({
      reconnectDelayMs: 1,
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    await stt.disconnect();

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(8, 2));

    await advance(audioDropDebounceMs + 1);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 11,
      },
    ]);

    await advance(10);
    expect(stt.sentAudioChunks).toEqual([]);
  });

  test('buffers a chunk that fills audioBufferMaxMs exactly without dropping it', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(5, 1));
    await advance(audioDropDebounceMs + 1);

    expect(audioDropped.events).toEqual([]);

    await runtime.startListening();
    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([1]);
  });

  test('rejects invalid buffered chunks without corrupting later buffering', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: string[] = [];
    const { stt, createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime({
      ...audioDropped.callbacks,
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    audioDropped.attach(runtime);

    runtime.sendAudioChunk({
      data: new Uint8Array(0),
      sampleRate: 16000,
      encoding: 'linear16',
      bytesPerSample: 2,
      channels: 1,
      timestamp: 1,
      sequence: 1,
    });
    runtime.sendAudioChunk(makeLinear16Chunk(3, 2));

    await advance(audioDropDebounceMs + 1);

    expect(reportedErrors).toContain(
      'STT audio chunk duration must be positive, received 0ms',
    );
    expect(audioDropped.events).toEqual([]);

    await runtime.startListening();
    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
  });

  test('rejects buffered opus chunks without explicit bytesPerSample and keeps later buffering intact', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: string[] = [];
    const { stt, createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime({
      ...audioDropped.callbacks,
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeOpusChunk(1));
    runtime.sendAudioChunk(makeLinear16Chunk(3, 2));

    await advance(audioDropDebounceMs + 1);

    expect(reportedErrors).toContain(
      'Opus audio chunks must provide bytesPerSample before buffering so duration can be estimated safely',
    );
    expect(audioDropped.events).toEqual([]);

    await runtime.startListening();
    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
  });

  test('recovers cleanly after rejecting an oversized chunk and buffers the next in-budget chunk', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(8, 2));
    runtime.sendAudioChunk(makeLinear16Chunk(3, 3));

    await advance(audioDropDebounceMs + 1);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 11,
      },
    ]);

    await runtime.startListening();
    expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([3]);
  });

  test('flushes the pending bucket immediately when a reconnect oversized rejection changes the reason', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { stt, createRuntime } = createConfig({
      audioBufferMaxMs: 5,
      reconnectDelayMs: 1000,
    });
    const runtime = createRuntime(audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);

    await runtime.startListening();
    await stt.disconnect();
    runtime.sendAudioChunk(makeLinear16Chunk(8, 3));

    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);

    await advance(audioDropDebounceMs + 1);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 8,
      },
    ]);
  });

  test('reports buffered-audio replay failures instead of silently abandoning the chunk', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: Error[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new ThrowOnNthSendSTTProvider(1, 'mock replay send failure');
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          trace(event, details) {
            traceEvents.push({ event, details });
          },
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          ...audioDropped.callbacks,
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      audioDropped.attach(runtime);

      await runtime.startListening();
      await stt.disconnect();

      runtime.sendAudioChunk({
        data: Uint8Array.from([1]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 1,
        sequence: 1,
      });

      await advance(audioDropDebounceMs + 1);

      expect(reportedErrors).toHaveLength(1);
      expect(reportedErrors[0]?.message).toBe(
        'Failed to replay buffered STT audio chunk',
      );
      expect(reportedErrors[0]?.cause).toBeInstanceOf(Error);
      expect((reportedErrors[0]?.cause as Error | undefined)?.message).toBe(
        'mock replay send failure',
      );
      expect(traceEvents).toContainEqual(
        expect.objectContaining({
          event: 'stt.buffered_audio.flush_failed',
          details: expect.objectContaining({
            reason: 'send_failed',
            nextBufferedAudioSequence: 1,
            pendingBufferedAudioMs: 0,
            flushFailedChunkMs: 0.03125,
            message: 'mock replay send failure',
          }),
        }),
      );
      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'reconnect_buffer_full',
          droppedDurationMs: 0.03125,
        },
      ]);
      expect(stt.sentAudioChunks).toHaveLength(0);
    });
  });

  test('drops a failing replay chunk and continues replaying later buffered audio', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: Error[] = [];
    const stt = new ThrowOnceOnSendSTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          ...audioDropped.callbacks,
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      audioDropped.attach(runtime);

      await runtime.startListening();
      await stt.disconnect();

      runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
      runtime.sendAudioChunk(makeLinear16Chunk(3, 2));

      await advance(audioDropDebounceMs + 1);

      expect(reportedErrors.map((error) => error.message)).toContain(
        'Failed to replay buffered STT audio chunk',
      );
      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'reconnect_buffer_full',
          droppedDurationMs: 3,
        },
      ]);
      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
    });
  });

  test('reports buffer overflow through onError alongside audio_dropped', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: string[] = [];
    const { createRuntime } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime({
      ...audioDropped.callbacks,
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));
    await advance(audioDropDebounceMs + 1);

    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'pre_connection_buffer_full',
        droppedDurationMs: 3,
      },
    ]);
    expect(reportedErrors).toContain(
      'Dropped 3ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
    );
  });

  test('reports non-listening audio chunks through onError and audio_dropped', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: string[] = [];
    const { createRuntime } = createConfig();
    const runtime = createRuntime({
      ...audioDropped.callbacks,
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    audioDropped.attach(runtime);

    await runtime.speak('hello world');
    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));

    expect(reportedErrors).toContain(
      'Cannot accept audio chunk while voice session is speaking',
    );
    await advance(audioDropDebounceMs + 1);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'state_not_listening',
        droppedDurationMs: 3,
      },
    ]);
  });

  test('buffers and replays a live audio chunk when sendAudio fails mid-listen', async () => {
    const reportedErrors: string[] = [];
    const stt = new ThrowAndDisconnectOnceOnSendSTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onError(error) {
            reportedErrors.push(error.message);
          },
        },
      );

      await runtime.startListening();
      runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
      await advance(10);

      expect(reportedErrors).toContain(
        'Failed to send STT audio chunk while listening',
      );
      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([1]);
    });
  });

  test('reports VAD end without transcript and returns to idle', async () => {
    const reportedErrors: string[] = [];
    const { createRuntime } = createConfig();
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error.message);
      },
    });

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);

    expect(reportedErrors).toContain(
      'VAD ended the utterance before a transcript was available',
    );
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('processRequest reuses the runtime-owned intent boundary and can skip speaking', async () => {
    const processIntent: ProcessIntent = {
      async process(request) {
        return createProcessResponse(request, {
          userMessage: 'spoken reply',
        });
      },
    };

    const { tts, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();
    const request = createRequest('typed request');

    const response = await runtime.processRequest(request, {
      speakResponse: false,
    });

    expect(response?.userMessage).toBe('spoken reply');
    expect(tts.spokenTexts).toEqual([]);
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('buildIntentRequest awaits async builder before processIntent runs', async () => {
    let resolveBuilder!: (request: ReturnType<typeof createRequest>) => void;
    const builderEvents: string[] = [];
    const builderSessionIds: SessionId[] = [];
    const processIntentCalls: string[] = [];
    const buildChartRequest: VoiceSessionIntentRequestBuilder = ({
      transcript,
      sessionId,
    }) => {
      builderEvents.push(`build:${transcript}`);
      builderSessionIds.push(sessionId);

      return new Promise<ReturnType<typeof createRequest>>((resolve) => {
        resolveBuilder = resolve;
      }).then((request) => {
        builderEvents.push(`build:resolved:${transcript}`);
        return request;
      });
    };

    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processIntentCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const stt = new MockSTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        buildChartRequest,
        processIntent,
      });

      await runtime.startListening();
      stt.emit({
        type: 'transcript',
        result: { text: 'hello async', isFinal: true },
      });
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
      await advance(550);

      expect(builderEvents).toEqual(['build:hello async']);
      expect(builderSessionIds).toEqual([SessionId('session-test')]);
      expect(processIntentCalls).toEqual([]);
      expect(runtime.getVoiceState()).toBe('processing');

      resolveBuilder(createRequest('hello async'));
      await advance(0);

      expect(builderEvents).toEqual([
        'build:hello async',
        'build:resolved:hello async',
      ]);
      expect(processIntentCalls).toEqual(['hello async']);
      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('processRequest stops active speech before entering processing', async () => {
    const processIntent: ProcessIntent = {
      async process(request) {
        return createProcessResponse(request);
      },
    };

    const { tts, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime();
    const request = createRequest('typed request');

    await runtime.speak('hello world');
    await runtime.processRequest(request, { speakResponse: false });

    expect(tts.stopCalls).toBe(1);
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('runtime voice state stays authoritative without provider speaking accessors', async () => {
    const voiceStates: string[] = [];
    const stt = new MockSTTProvider();
    const tts = new EventOnlyTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      runtime.onVoiceStateChange((state) => {
        voiceStates.push(state);
      });

      await runtime.speak('hello world');

      expect(voiceStates).toEqual(['speaking', 'idle']);
      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('returns to idle and reports a classified transport error when TTS disconnects mid-speech', async () => {
    const reportedErrors: Error[] = [];
    const { tts, createRuntime } = createConfig();
    const runtime = createRuntime({
      onError(error) {
        reportedErrors.push(error);
      },
    });

    await runtime.speak('hello world');
    tts.emit({ type: 'disconnected' });

    expect(runtime.getVoiceState()).toBe('idle');
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe('TTS disconnected while speaking');
    expect((reportedErrors[0] as TTSError).kind).toBe('transport');
    expect((reportedErrors[0] as TTSError).provider).toBe('mock-tts');
  });

  test('auto-restarts listening after speech completes naturally', async () => {
    const speechStarts: string[] = [];
    const speechStops: boolean[] = [];
    const tts = new AutoEventTTSProvider();
    const stt = new MockSTTProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onSpeechStarted(speech) {
            speechStarts.push(speech.text);
          },
          onSpeechStopped(completed) {
            speechStops.push(completed);
          },
        },
      );

      await runtime.speak('hello world');

      expect(runtime.getVoiceState()).toBe('speaking');
      expect(runtime.shouldAutoRestart()).toBe(false);
      expect(speechStarts).toEqual(['hello world']);

      const initialConnectCalls = stt.connectCalls;
      tts.emit({ type: 'completed' });
      await advance(550);

      expect(speechStops).toEqual([true]);
      expect(runtime.getVoiceState()).toBe('listening');
      expect(runtime.shouldAutoRestart()).toBe(false);
      expect(stt.connectCalls).toBe(initialConnectCalls + 1);
    });
  });

  test('interrupting active speech stops playback, reports user interrupt, and does not auto-restart listening', async () => {
    const interrupts: Array<'user' | 'system'> = [];
    const speechStops: boolean[] = [];
    const tts = new AutoEventTTSProvider();
    const stt = new MockSTTProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onInterrupt(source) {
            interrupts.push(source);
          },
          onSpeechStopped(completed) {
            speechStops.push(completed);
          },
        },
      );

      await runtime.speak('hello world');

      expect(runtime.getVoiceState()).toBe('speaking');

      runtime.interrupt();
      await advance(550);

      expect(tts.stopCalls).toBe(1);
      expect(interrupts).toEqual(['user']);
      expect(speechStops).toEqual([false]);
      expect(runtime.getVoiceState()).toBe('idle');
      expect(runtime.shouldAutoRestart()).toBe(true);
      expect(stt.connectCalls).toBe(0);
    });
  });

  test('interrupting processing aborts the in-flight turn and prevents stale speech', async () => {
    let resolveProcess!: (value: ProcessIntentResponse) => void;
    const processResponse = new Promise<ProcessIntentResponse>((resolve) => {
      resolveProcess = resolve;
    });
    const interrupts: Array<'user' | 'system'> = [];
    const processSignals: AbortSignal[] = [];
    const processIntent: ProcessIntent = {
      process(_request, signal) {
        processSignals.push(signal ?? new AbortController().signal);

        return processResponse;
      },
    };

    const { stt, tts, createRuntime } = createConfig({ processIntent });
    const runtime = createRuntime({
      onInterrupt(source) {
        interrupts.push(source);
      },
    });

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'hello', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(550);

    expect(runtime.getVoiceState()).toBe('processing');

    runtime.interrupt();
    await advance(0);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(interrupts).toEqual(['user']);
    expect(processSignals[0]?.aborted).toBe(true);

    resolveProcess({
      type: 'maelstrom_response',
      requestId: MessageId('req-hello'),
      userMessage: 'stale reply',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
    await advance(0);

    expect(tts.spokenTexts).toEqual([]);
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('interrupt during speak() with delayed TTS connect should not fire tts.speak()', async () => {
    class DelayedConnectTTSProvider extends MockTTSProvider {
      override isConnected(): boolean {
        return false;
      }

      override async connect(): Promise<void> {
        return new Promise<void>((resolve) => {
          clock.setTimeout(() => {
            super.connect();
            resolve();
          }, 10);
        });
      }
    }

    const tts = new DelayedConnectTTSProvider();
    const stt = new MockSTTProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      const speakPromise = runtime.speak('hello world');

      expect(runtime.getVoiceState()).toBe('speaking');

      runtime.interrupt();

      expect(runtime.getVoiceState()).toBe('idle');

      await advance(10);
      await speakPromise;

      expect(tts.spokenTexts).toEqual([]);
    });
  });

  test('does not auto-restart listening after destroy when a delayed TTS completion arrives', async () => {
    const reportedErrors: string[] = [];
    const stt = new MockSTTProvider();
    const tts = new AutoEventTTSProvider();
    const processIntent: ProcessIntent = {
      async process(request) {
        return createProcessResponse(request, {
          userMessage: 'hello back',
        });
      },
    };

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          processIntent,
          buildChartRequest: defaultBuildChartRequest,
        },
        {
          onError(error) {
            reportedErrors.push(error.message);
          },
        },
      );

      await runtime.startListening();
      stt.emit({
        type: 'transcript',
        result: { text: 'hello', isFinal: true },
      });
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
      await advance(sharedVadFinalDebounceMs);

      runtime.destroy();
      tts.emit({ type: 'completed' });
      await advance(550);

      expect(stt.connectCalls).toBe(1);
      expect(reportedErrors).toEqual([]);
    });
  });
});
