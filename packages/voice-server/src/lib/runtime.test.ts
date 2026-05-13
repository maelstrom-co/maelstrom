import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  type ChartRequest,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import {
  createSttDisconnectSuppressionController,
  createVoiceSession,
  defaultAudioDropDebounceMs,
  handleTranscriptGraceExpiryTerminalBranches,
} from './runtime.js';
import { sttProviderFactories } from './stt/registry.js';
import { ttsProviderFactories } from './tts/registry.js';
import type {
  AudioChunk,
  ProcessIntent,
  SpeechOptions,
  SpeechSynthesisHandle,
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

type ProcessIntentResponse = Awaited<ReturnType<ProcessIntent['process']>>;

function createDisconnectedSTTEvent(clean: boolean, message: string): STTEvent {
  return {
    type: 'disconnected',
    clean,
    reason: clean ? 'clean_shutdown' : 'transport_lost',
    message,
  } as STTEvent;
}

function createDisconnectedTTSEvent(clean: boolean, message: string): TTSEvent {
  return {
    type: 'disconnected',
    clean,
    reason: clean ? 'clean_shutdown' : 'transport_lost',
    message,
  } as TTSEvent;
}

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
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit(
      createDisconnectedSTTEvent(true, 'Mock STT disconnected cleanly'),
    );
  }

  simulateUnexpectedDisconnect(
    message = 'Mock STT disconnected unexpectedly',
  ): void {
    this.connected = false;
    this.emit(createDisconnectedSTTEvent(false, message));
  }

  simulateCleanDisconnect(message = 'Mock STT disconnected cleanly'): void {
    this.connected = false;
    this.emit(createDisconnectedSTTEvent(true, message));
  }

  simulateTransportErrorOnly(message = 'Mock STT transport error'): void {
    this.connected = false;
    this.emit({
      type: 'error',
      error: createMockSTTError('transport', message),
    });
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

class FailOnNthConnectWithSTTErrorProvider extends MockSTTProvider {
  constructor(private readonly failures: Record<number, STTError>) {
    super();
  }

  private connectAttempts = 0;

  override async connect(): Promise<void> {
    this.connectAttempts += 1;
    const failure = this.failures[this.connectAttempts];

    if (failure) {
      throw failure;
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

class AsyncFinalOnEndStreamSTTProvider extends MockSTTProvider {
  constructor(
    private readonly finalText: string,
    private readonly delayMs: number,
  ) {
    super();
  }

  override endStream(): void {
    setTimeout(() => {
      this.emit({
        type: 'transcript',
        result: { text: this.finalText, isFinal: true },
      });
    }, this.delayMs);
    super.endStream();
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

class DisconnectOnNthSendSTTProvider extends MockSTTProvider {
  constructor(private readonly disconnectOnSendCounts: number[]) {
    super();
  }

  override sendAudio(chunk: AudioChunk): void {
    super.sendAudio(chunk);

    if (this.disconnectOnSendCounts.includes(this.sentAudioChunks.length)) {
      this.connected = false;
      this.emit(
        createDisconnectedSTTEvent(false, 'Mock STT disconnected unexpectedly'),
      );
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

class ThrowAndDisconnectThenThrowOnceOnReplaySTTProvider extends MockSTTProvider {
  private liveSendFailed = false;
  private replaySendFailed = false;

  constructor(
    private readonly liveFailureMessage = 'mock live send failure',
    private readonly replayFailureMessage = 'mock replay send failure',
  ) {
    super();
  }

  override sendAudio(chunk: AudioChunk): void {
    if (!this.liveSendFailed) {
      this.liveSendFailed = true;
      this.connected = false;
      this.emit(
        createDisconnectedSTTEvent(false, 'Mock STT disconnected unexpectedly'),
      );
      throw new Error(this.liveFailureMessage);
    }

    if (!this.replaySendFailed) {
      this.replaySendFailed = true;
      throw new Error(this.replayFailureMessage);
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
  protected activeSpeak: {
    resolveCompletion: (reason: 'completed' | 'stopped') => void;
    completionSettled: boolean;
  } | null = null;

  settleActiveSpeak(reason: 'completed' | 'stopped'): void {
    if (!this.activeSpeak || this.activeSpeak.completionSettled) {
      return;
    }

    this.activeSpeak.completionSettled = true;
    this.activeSpeak.resolveCompletion(reason);
    this.activeSpeak = null;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.settleActiveSpeak('stopped');
    this.emit(
      createDisconnectedTTSEvent(true, 'Mock TTS disconnected cleanly'),
    );
  }

  speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle {
    this.spokenTexts.push(text);

    let resolveCompletion!: (reason: 'completed' | 'stopped') => void;
    const completion = new Promise<'completed' | 'stopped'>((resolve) => {
      resolveCompletion = resolve;
    });

    this.activeSpeak = {
      resolveCompletion,
      completionSettled: false,
    };

    return {
      speech: {
        text,
        format: 'pcm_f32le',
        sampleRate: options?.sampleRate ?? 16000,
      },
      completion,
    };
  }

  stop(): void {
    this.stopCalls += 1;
    this.settleActiveSpeak('stopped');
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

class FailOnConnectTTSProvider extends MockTTSProvider {
  constructor(private readonly failureMessage = 'mock tts connect failure') {
    super();
  }

  override async connect(): Promise<void> {
    throw new Error(this.failureMessage);
  }
}

class FailOnSpeakTTSProvider extends MockTTSProvider {
  constructor(private readonly failureMessage = 'mock tts speak failure') {
    super();
  }

  override speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle {
    super.speak(text, options);
    throw new Error(this.failureMessage);
  }
}

class AutoEventTTSProvider extends MockTTSProvider {
  override speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle {
    return super.speak(text, options);
  }
}

class EventOnlyTTSProvider extends MockTTSProvider {
  override speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle {
    const handle = super.speak(text, options);
    this.settleActiveSpeak('completed');
    return handle;
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

  if (!originalSTTFactory || !originalTTSFactory) {
    throw new Error('Missing test provider factory registration');
  }

  const sttFactoryToRestore = originalSTTFactory;
  const ttsFactoryToRestore = originalTTSFactory;

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
    sttProviderFactories[testSTTProviderType] = sttFactoryToRestore;
    ttsProviderFactories[testTTSProviderType] = ttsFactoryToRestore;
  }
}

function createConfig(
  overrides: Partial<VoiceSessionConfig> = {},
  providers: {
    stt?: MockSTTProvider;
    tts?: MockTTSProvider;
  } = {},
) {
  const stt = providers.stt ?? new MockSTTProvider();
  const tts = providers.tts ?? new MockTTSProvider();

  const config: VoiceSessionConfig = {
    stt: createSTTTestConfig(),
    tts: createTTSTestConfig(),
    sessionId: SessionId('session-test'),
    buildChartRequest: defaultBuildChartRequest,
    processIntent: defaultProcessIntent,
    ...overrides,
  };

  return { config, stt, tts };
}

function createRuntime(
  config: VoiceSessionConfig,
  providers: {
    stt: MockSTTProvider;
    tts: MockTTSProvider;
  },
  callbacks?: VoiceSessionCallbacks,
) {
  return withPatchedProviderFactories(providers, () =>
    createVoiceSession(config, callbacks),
  );
}

function createReconnectTraceRecorder() {
  const events: Array<{
    event: string;
    details?: Record<string, unknown>;
  }> = [];

  return {
    events,
    trace(event: string, details?: Record<string, unknown>) {
      events.push({ event, details });
    },
  };
}

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

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'hello world', isFinal: true },
    });

    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await advance(0);
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

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });

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

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });

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
    const { config, stt, tts } = createConfig({
      processIntent,
      transcriptGraceMs: 20,
    });
    const runtime = createRuntime(config, { stt, tts });

    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'hello world', isFinal: false },
    });

    await runtime.stopListening();
    await advance(25);
    await advance(0);

    expect(processCalls).toEqual(['hello world']);
    expect(seenTranscripts).toEqual([
      { text: 'hello world', isFinal: false },
      { text: 'hello world', isFinal: true },
    ]);
  });

  test('waits for an asynchronous endStream final before finalizing manual stop', async () => {
    const processCalls: string[] = [];
    const reportedErrors: Error[] = [];
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

    const stt = new AsyncFinalOnEndStreamSTTProvider('hello world', 5);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          transcriptGraceMs: 20,
          buildChartRequest: defaultBuildChartRequest,
          processIntent,
        },
        {
          onError(error) {
            reportedErrors.push(
              error instanceof Error ? error : new Error(String(error)),
            );
          },
          onTranscript(result) {
            seenTranscripts.push({
              text: result.text,
              isFinal: result.isFinal,
            });
          },
        },
      );

      await runtime.startListening();
      runtime.sendAudioChunk({
        data: new Uint8Array(16384),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 0,
      });
      await runtime.stopListening();
      await advance(0);

      expect(runtime.getVoiceState()).toBe('listening');
      expect(processCalls).toEqual([]);
      expect(seenTranscripts).toEqual([]);

      runtime.sendAudioChunk({
        data: new Uint8Array(16384),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 1,
      });
      await advance(0);

      expect(reportedErrors).toEqual([]);
      expect(stt.sentAudioChunks).toHaveLength(1);

      await advance(5);
      await advance(0);

      expect(processCalls).toEqual(['hello world']);
      expect(seenTranscripts).toEqual([{ text: 'hello world', isFinal: true }]);
      expect(runtime.getVoiceState()).toBe('idle');
      expect(reportedErrors).toEqual([]);
    });
  });

  test('buffers restart audio during startListening connect after a manual stop', async () => {
    const stt = new DelayedConnectSTTProvider(5);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      stt.emit({
        type: 'transcript',
        result: { text: 'hello world', isFinal: false },
      });

      await runtime.stopListening();
      expect(runtime.getVoiceState()).toBe('processing');

      const restartPromise = runtime.startListening();
      runtime.sendAudioChunk({
        data: new Uint8Array(16384),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 2,
        sequence: 2,
      });

      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([]);

      await advance(5);
      await restartPromise;

      expect(runtime.getVoiceState()).toBe('listening');
      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);
    });
  });

  test('manual stop enters transcript grace when the turn only sent startup-buffered audio', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new DelayedConnectSTTProvider(5);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession({
        stt: createSTTTestConfig(),
        tts: createTTSTestConfig(),
        sessionId: SessionId('session-test'),
        transcriptGraceMs: 10,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      const restartPromise = runtime.startListening();
      runtime.sendAudioChunk({
        data: new Uint8Array(16384),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 2,
        sequence: 2,
      });

      await advance(5);
      await restartPromise;

      expect(runtime.getVoiceState()).toBe('listening');
      expect(stt.sentAudioChunks.map((chunk) => chunk.sequence)).toEqual([2]);

      await runtime.stopListening();
      await advance(0);

      expect(runtime.getVoiceState()).toBe('listening');
      expect(traceEvents).toContainEqual(
        expect.objectContaining({
          event: 'stt.transcript_grace.started',
          details: expect.objectContaining({
            transcriptGraceMs: 10,
          }),
        }),
      );

      await advance(10);
      await advance(0);

      expect(runtime.getVoiceState()).toBe('idle');
      expect(traceEvents).toContainEqual(
        expect.objectContaining({
          event: 'stt.transcript_grace.expired',
          details: expect.objectContaining({
            transcriptGraceMs: 10,
            pendingFinalFromVAD: true,
          }),
        }),
      );
    });
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

      stt.emit({
        type: 'transcript',
        result: { text: 'late duplicate', isFinal: true },
      });
      await advance(0);

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

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'first', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await advance(0);

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'second', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await advance(0);

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

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'first', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await advance(0);

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

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });
    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    stt.emit({ type: 'transcript', result: { text: 'hello', isFinal: true } });
    stt.emit({ type: 'transcript', result: { text: 'world', isFinal: true } });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await advance(0);

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

    const { config, stt, tts } = createConfig({
      processIntent,
      vadFinalDebounceMs: 10,
    });
    const runtime = createRuntime(config, { stt, tts });

    await runtime.startListening();
    stt.emit({
      type: 'transcript',
      result: { text: 'fast finalize', isFinal: true },
    });
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(5);
    expect(processCalls).toEqual([]);

    await advance(25);
    await advance(0);
    expect(processCalls).toEqual(['fast finalize']);
  });

  test('suppresses the old user-facing error and waits through transcript grace when VAD ends before any transcript arrives', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
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

    const { config, stt, tts } = createConfig({
      processIntent,
      transcriptGraceMs: 20,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(sharedVadFinalDebounceMs);
    await advance(10);

    expect(runtime.getVoiceState()).toBe('listening');
    expect(reportedErrors).toEqual([]);
    expect(processCalls).toEqual([]);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.started',
        details: expect.objectContaining({ transcriptGraceMs: 20 }),
      }),
    );

    await advance(15);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(reportedErrors).toEqual([]);
    expect(processCalls).toEqual([]);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.expired',
        details: expect.objectContaining({ transcriptGraceMs: 20 }),
      }),
    );
  });

  test('second speech_end during transcript grace resets the grace window', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const { config, stt, tts } = createConfig({
      vadFinalDebounceMs: 5,
      transcriptGraceMs: 20,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(5);
    await advance(10);

    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(5);

    await advance(15);

    expect(runtime.getVoiceState()).toBe('listening');
    expect(reportedErrors).toEqual([]);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.started',
      ),
    ).toHaveLength(2);
    expect(
      traceEvents.some(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toBe(false);

    await advance(10);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(reportedErrors).toEqual([]);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toHaveLength(1);
  });

  test('speech_start cancels active grace without incrementing grace-expiry telemetry', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const { config, stt, tts } = createConfig({
      vadFinalDebounceMs: 5,
      transcriptGraceMs: 20,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(5);
    await advance(10);

    expect(runtime.getVoiceState()).toBe('listening');
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.started',
      ),
    ).toHaveLength(1);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toHaveLength(0);

    runtime.handleVADEvent({ type: 'speech_start', timestamp: Date.now() });

    await advance(25);
    await advance(0);

    expect(runtime.getVoiceState()).toBe('listening');
    expect(reportedErrors).toEqual([]);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.started',
      ),
    ).toHaveLength(1);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toHaveLength(0);
  });

  test('finalizes normally when a transcript arrives during transcript grace', async () => {
    const processCalls: string[] = [];
    const reportedErrors: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { config, stt, tts } = createConfig({
      processIntent,
      transcriptGraceMs: 20,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(sharedVadFinalDebounceMs);
    await advance(5);

    stt.emit({
      type: 'transcript',
      result: { text: 'late arrival', isFinal: true },
    });
    await advance(0);

    expect(processCalls).toEqual(['late arrival']);
    expect(seenTranscripts).toEqual([{ text: 'late arrival', isFinal: true }]);
    expect(reportedErrors).toEqual([]);
    expect(runtime.getVoiceState()).toBe('idle');
    expect(
      traceEvents.some(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toBe(false);

    await advance(25);
    expect(processCalls).toEqual(['late arrival']);
  });

  test('transcriptGraceMs 0 returns to idle on the next timer turn and drops a later provider-final transcript', async () => {
    const processCalls: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { config, stt, tts } = createConfig({
      processIntent,
      transcriptGraceMs: 0,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(config, { stt, tts });

    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(sharedVadFinalDebounceMs);

    expect(runtime.getVoiceState()).toBe('listening');
    expect(processCalls).toEqual([]);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.started',
      ),
    ).toHaveLength(1);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toHaveLength(0);

    await advance(1);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(processCalls).toEqual([]);
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toHaveLength(1);

    stt.emit({
      type: 'transcript',
      result: { text: 'too late', isFinal: true },
    });
    await advance(0);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(processCalls).toEqual([]);
    expect(seenTranscripts).toEqual([]);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript.ignored_after_turn_closed',
        details: expect.objectContaining({
          preview: 'too late',
          isFinal: true,
        }),
      }),
    );
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toHaveLength(1);
  });

  test('finalizes a late interim transcript when transcript grace expires', async () => {
    const processCalls: string[] = [];
    const reportedErrors: string[] = [];
    const seenTranscripts: Array<{ text: string; isFinal: boolean }> = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { config, stt, tts } = createConfig({
      processIntent,
      transcriptGraceMs: 20,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    runtime.onTranscript((result) => {
      seenTranscripts.push({ text: result.text, isFinal: result.isFinal });
    });

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });

    await advance(sharedVadFinalDebounceMs);
    await advance(5);

    stt.emit({
      type: 'transcript',
      result: { text: 'late interim', isFinal: false },
    });
    await advance(0);

    expect(processCalls).toEqual(['late interim']);
    expect(seenTranscripts).toEqual([{ text: 'late interim', isFinal: true }]);
    expect(runtime.getVoiceState()).toBe('idle');

    await advance(20);
    await advance(0);

    expect(processCalls).toEqual(['late interim']);
    expect(seenTranscripts).toEqual([{ text: 'late interim', isFinal: true }]);
    expect(reportedErrors).toEqual([]);
    expect(runtime.getVoiceState()).toBe('idle');
    expect(
      traceEvents.some(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toBe(false);
  });

  test('finalizes accumulated transcript on grace expiry', async () => {
    const finalizedTexts: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const clearedPendingFinalization: boolean[] = [];

    const handled = handleTranscriptGraceExpiryTerminalBranches(
      {
        currentTranscript: '',
        accumulatedTranscript: 'late arrival',
        hasEmittedFinal: false,
      },
      (event, details) => {
        traceEvents.push({ event, details });
      },
      () => {
        clearedPendingFinalization.push(true);
      },
      (text) => {
        finalizedTexts.push(text);
        return { emitted: true, startedProcessing: true };
      },
    );

    expect(handled).toBe(true);
    expect(clearedPendingFinalization).toEqual([true]);
    expect(finalizedTexts).toEqual(['late arrival']);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.completed_with_late_transcript',
        details: expect.objectContaining({
          textLength: 'late arrival'.length,
          usedAccumulatedTranscriptFallback: true,
        }),
      }),
    );
  });

  test('grace callback already finalized', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const finalizedTexts: string[] = [];
    const clearedPendingFinalization: boolean[] = [];

    const handled = handleTranscriptGraceExpiryTerminalBranches(
      {
        currentTranscript: 'provider final',
        accumulatedTranscript: 'provider final',
        hasEmittedFinal: true,
      },
      (event, details) => {
        traceEvents.push({ event, details });
      },
      () => {
        clearedPendingFinalization.push(true);
      },
      (text) => {
        finalizedTexts.push(text);
        return { emitted: true, startedProcessing: true };
      },
    );

    expect(handled).toBe(true);
    expect(finalizedTexts).toEqual([]);
    expect(clearedPendingFinalization).toEqual([]);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.already_finalized',
        details: expect.objectContaining({
          currentTranscriptLength: 'provider final'.length,
          accumulatedTranscriptLength: 'provider final'.length,
        }),
      }),
    );
    expect(
      traceEvents.some(
        (entry) =>
          entry.event ===
            'stt.transcript_grace.completed_with_late_transcript' &&
          entry.details?.textLength === 0,
      ),
    ).toBe(false);
    expect(
      traceEvents.some(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toBe(false);
  });

  test('returns to idle on transcript grace expiry without surfacing the old VAD/transcript race error', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const { config, stt, tts } = createConfig({
      transcriptGraceMs: 10,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'utterance_end', timestamp: Date.now() });

    await advance(sharedVadFinalDebounceMs + 15);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(reportedErrors).toEqual([]);
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.expired',
        details: expect.objectContaining({
          transcriptGraceMs: 10,
          pendingFinalFromVAD: true,
        }),
      }),
    );
  });

  test('repeated grace expiry emits once', async () => {
    const reportedErrors: string[] = [];
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

    const { config, stt, tts } = createConfig({
      transcriptGraceMs: 10,
      processIntent,
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    async function expireTranscriptGraceWithoutTranscript() {
      await runtime.startListening();
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
      await advance(sharedVadFinalDebounceMs + 15);

      expect(runtime.getVoiceState()).toBe('idle');
    }

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);
    expect(processCalls).toEqual([]);
  });

  test('grace callback resets repeated expiry', async () => {
    const reportedErrors: string[] = [];
    const processCalls: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const processIntent: ProcessIntent = {
      async process(request) {
        const updateReason = request.context.updateReasons[0];
        if (updateReason?.type === 'user_intent') {
          processCalls.push(updateReason.intent);
        }

        return createProcessResponse(request);
      },
    };

    const { config, stt, tts } = createConfig({
      transcriptGraceMs: 10,
      processIntent,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    async function expireTranscriptGraceWithoutTranscript() {
      await runtime.startListening();
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
      await advance(sharedVadFinalDebounceMs + 15);

      expect(runtime.getVoiceState()).toBe('idle');
    }

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs);
    await advance(5);

    stt.emit({
      type: 'transcript',
      result: { text: 'reset from grace window', isFinal: false },
    });
    await advance(0);

    expect(runtime.getVoiceState()).toBe('idle');
    expect(processCalls).toEqual(['reset from grace window']);
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);

    await advance(10);
    await advance(0);

    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.already_finalized',
        details: expect.objectContaining({
          currentTranscriptLength: 'reset from grace window'.length,
          accumulatedTranscriptLength: 'reset from grace window'.length,
        }),
      }),
    );

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);

    await expireTranscriptGraceWithoutTranscript();
    expect(reportedErrors).toEqual([
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
      'Repeated transcript grace expiries reached degraded mode without any transcript finalization (count=3, threshold=3, transcriptGraceMs=10)',
    ]);
  });

  test('isolates transcript listeners so one throwing observer does not break the others', async () => {
    const reportedErrors: string[] = [];
    const seenTranscripts: string[] = [];
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

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

  test('reports the first retryable reconnect failure before stopping after max retries', async () => {
    const reportedErrors: Error[] = [];
    const trace = createReconnectTraceRecorder();
    const stt = new FailOnNthConnectSTTProvider([2, 3]);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          maxReconnectAttempts: 2,
          trace: trace.trace,
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
      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(
        trace.events
          .filter((entry) => entry.event === 'stt.reconnect.failed')
          .map((entry) => entry.details?.attempt),
      ).toEqual([1, 2]);
      expect(
        trace.events
          .filter((entry) => entry.event === 'stt.reconnect.failed')
          .map((entry) => entry.details?.message),
      ).toEqual(['mock stt connect failure', 'mock stt connect failure']);
      expect(reportedErrors.map((error) => error.message)).toEqual([
        'mock stt connect failure',
        'STT connection lost after max retries',
      ]);
      expect(reportedErrors[1]).toBeInstanceOf(AggregateError);
      expect(
        Array.from((reportedErrors[1] as AggregateError).errors, (error) =>
          error instanceof Error ? error.message : String(error),
        ),
      ).toEqual(['mock stt connect failure', 'mock stt connect failure']);
      expect(stt.connectCalls).toBe(1);
      expect(runtime.getVoiceState()).toBe('idle');
      expect(runtime.getSttCircuitStatus()).toBe('open');
    });
  });

  test.each([
    [
      'auth',
      {
        kind: 'auth' as const,
        message: 'mock stt auth reconnect failure',
        expectedErrors: [
          'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
          'mock stt auth reconnect failure',
        ],
        expectedFailureCount: 1,
        expectedExhaustedCount: 0,
        expectedCircuitStatus: 'closed',
      },
    ],
    [
      'quota',
      {
        kind: 'quota' as const,
        message: 'mock stt quota reconnect failure',
        expectedErrors: [
          'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
          'mock stt quota reconnect failure',
        ],
        expectedFailureCount: 1,
        expectedExhaustedCount: 0,
        expectedCircuitStatus: 'closed',
      },
    ],
    [
      'unknown',
      {
        kind: 'unknown' as const,
        message: 'mock stt unknown reconnect failure',
        expectedErrors: [
          'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
          'mock stt unknown reconnect failure',
          'STT connection lost after max retries',
        ],
        expectedFailureCount: 3,
        expectedExhaustedCount: 1,
        expectedCircuitStatus: 'open',
      },
    ],
    [
      'server',
      {
        kind: 'server' as const,
        message: 'mock stt server reconnect failure',
        expectedErrors: [
          'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
          'mock stt server reconnect failure',
          'STT connection lost after max retries',
        ],
        expectedFailureCount: 1,
        expectedExhaustedCount: 1,
        expectedCircuitStatus: 'open',
      },
    ],
    [
      'parse',
      {
        kind: 'parse' as const,
        message: 'mock stt parse reconnect failure',
        expectedErrors: [
          'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
          'mock stt parse reconnect failure',
          'STT connection lost after max retries',
        ],
        expectedFailureCount: 3,
        expectedExhaustedCount: 1,
        expectedCircuitStatus: 'open',
      },
    ],
  ] as const)('applies %s reconnect policy by error class', async (_label, {
    kind,
    message,
    expectedErrors,
    expectedFailureCount,
    expectedExhaustedCount,
    expectedCircuitStatus,
  }) => {
    const reportedErrors: Error[] = [];
    const trace = createReconnectTraceRecorder();
    const audioDropped = createAudioDroppedRecorder();
    const failures: Record<number, STTError> = {
      2: createMockSTTError(kind, message),
    };

    if (kind === 'parse' || kind === 'unknown') {
      failures[3] = createMockSTTError(kind, message);
      failures[4] = createMockSTTError(kind, message);
    }

    const stt = new FailOnNthConnectWithSTTErrorProvider(failures);
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          audioBufferMaxMs: 5,
          maxReconnectAttempts: 3,
          trace: trace.trace,
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
      stt.simulateUnexpectedDisconnect();

      runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
      runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

      expect(audioDropped.events).toEqual([]);

      await advance(30);

      expect(reportedErrors.map((error) => error.message)).toEqual([
        ...expectedErrors,
      ]);
      expect((reportedErrors[1] as STTError | undefined)?.kind).toBe(kind);
      expect(runtime.getVoiceState()).toBe('idle');
      expect(runtime.getSttCircuitStatus()).toBe(expectedCircuitStatus);
      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'reconnect_buffer_full',
          droppedDurationMs: 4,
        },
      ]);
      expect(stt.connectCalls).toBe(1);
      expect(
        trace.events.filter((entry) => entry.event === 'stt.reconnect.failed'),
      ).toHaveLength(expectedFailureCount);
      expect(
        trace.events.filter(
          (entry) => entry.event === 'stt.reconnect.exhausted',
        ),
      ).toHaveLength(expectedExhaustedCount);

      if (expectedCircuitStatus === 'open') {
        await expect(runtime.startListening()).rejects.toThrow(
          'Cannot start listening while the STT circuit is open',
        );
      } else {
        await runtime.startListening();
      }

      expect(stt.sentAudioChunks).toEqual([]);
    });
  });

  test.each([
    {
      kind: 'auth' as const,
      message: 'mock stt auth error: invalid api key',
      expectedState: 'idle',
    },
    {
      kind: 'quota' as const,
      message: 'mock stt quota error: subscription overage limit reached',
      expectedState: 'idle',
    },
    {
      kind: 'parse' as const,
      message: 'mock stt parse error: malformed provider payload',
      expectedState: 'listening',
    },
    {
      kind: 'server' as const,
      message: 'mock stt server error: upstream exploded',
      expectedState: 'listening',
    },
    {
      kind: 'unknown' as const,
      message: 'mock stt unknown error: unexpected runtime condition',
      expectedState: 'listening',
    },
  ])('surfaces %s STT provider errors and applies the correct runtime state', async ({
    kind,
    message,
    expectedState,
  }) => {
    const reportedErrors: Error[] = [];
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    await runtime.startListening();
    stt.emit({
      type: 'error',
      error: createMockSTTError(kind, message),
    });

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe(message);
    expect((reportedErrors[0] as STTError).kind).toBe(kind);
    expect((reportedErrors[0] as STTError).source).toBe('stt');
    expect((reportedErrors[0] as STTError).provider).toBe('mock-stt');
    expect(runtime.getVoiceState()).toBe(expectedState);
  });

  test('keeps reconnect eligible after a transport STT error until disconnect triggers recovery', async () => {
    const reportedErrors: Error[] = [];
    const { config, stt, tts } = createConfig({ reconnectDelayMs: 1 });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    await runtime.startListening();
    stt.emit({
      type: 'error',
      error: createMockSTTError('transport', 'mock stt transport error'),
    });
    stt.simulateUnexpectedDisconnect();
    await advance(10);

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe('mock stt transport error');
    expect((reportedErrors[0] as STTError).kind).toBe('transport');
    expect(runtime.getVoiceState()).toBe('listening');
    expect(stt.connectCalls).toBe(2);
  });

  test('reconnects immediately when a transport STT error is the only failure signal', async () => {
    const reportedErrors: Error[] = [];
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1,
      reconnectJitterMs: 0,
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    await runtime.startListening();
    stt.simulateTransportErrorOnly('mock transport error only');
    await advance(10);

    expect(reportedErrors.map((error) => error.message)).toEqual([
      'mock transport error only',
    ]);
    expect(stt.connectCalls).toBe(2);
    expect(runtime.getVoiceState()).toBe('listening');
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
        reconnectJitterMs: 0,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      stt.simulateUnexpectedDisconnect();
      stt.emit(
        createDisconnectedSTTEvent(false, 'Mock STT disconnected unexpectedly'),
      );
      stt.emit(
        createDisconnectedSTTEvent(false, 'Mock STT disconnected unexpectedly'),
      );
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

  test('resets the reconnect attempt budget for a fresh disconnect before the stability window expires', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const reportedErrors: Error[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [3],
      'second cycle first retry fails',
    );
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
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

      stt.simulateUnexpectedDisconnect();
      await advance(10);

      stt.simulateUnexpectedDisconnect();
      await advance(20);

      expect(
        traceEvents
          .filter((entry) => entry.event === 'stt.reconnect.attempt')
          .map((entry) => entry.details?.attempt),
      ).toEqual([1, 1, 2]);
      expect(
        traceEvents
          .filter((entry) => entry.event === 'stt.reconnect.failed')
          .map((entry) => entry.details?.attempt),
      ).toEqual([1]);
      expect(reportedErrors.map((error) => error.message)).toEqual([
        'second cycle first retry fails',
      ]);
      expect(stt.connectCalls).toBe(3);
      expect(runtime.getVoiceState()).toBe('listening');
      expect(runtime.getSttCircuitStatus()).toBe('closed');
    });
  });

  test('jitter uses mocked randomness while staying bounded by remaining reconnect headroom', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const randomSpy = spyOn(Math, 'random').mockReturnValue(0.5);
    const stt = new MockSTTProvider();
    const tts = new MockTTSProvider();

    try {
      await withPatchedProviderFactories({ stt, tts }, async () => {
        const runtime = createVoiceSession({
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 10,
          reconnectBackoffMultiplier: 2,
          reconnectJitterMs: 6,
          maxReconnectDelayMs: 20,
          trace(event, details) {
            traceEvents.push({ event, details });
          },
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        });

        await runtime.startListening();
        stt.simulateUnexpectedDisconnect();
        await advance(20);

        const reconnectAttempt = traceEvents.find(
          (entry) => entry.event === 'stt.reconnect.attempt',
        );

        expect(reconnectAttempt?.details?.attempt).toBe(1);
        expect(reconnectAttempt?.details?.delayMs).toBe(13);
        expect(stt.connectCalls).toBe(2);
        expect(runtime.getVoiceState()).toBe('listening');
      });
    } finally {
      randomSpy.mockRestore();
    }
  });

  test('clamp keeps later reconnect attempts at maxReconnectDelayMs when bounded randomness leaves no headroom', async () => {
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const randomSpy = spyOn(Math, 'random').mockReturnValue(0.75);
    const reportedErrors: Error[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [2, 3],
      'clamp reconnect failure',
    );
    const tts = new MockTTSProvider();

    try {
      await withPatchedProviderFactories({ stt, tts }, async () => {
        const runtime = createVoiceSession(
          {
            stt: createSTTTestConfig(),
            tts: createTTSTestConfig(),
            sessionId: SessionId('session-test'),
            reconnectDelayMs: 10,
            reconnectBackoffMultiplier: 2,
            reconnectJitterMs: 6,
            maxReconnectDelayMs: 20,
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
        stt.simulateUnexpectedDisconnect();
        await advance(50);

        expect(
          traceEvents
            .filter((entry) => entry.event === 'stt.reconnect.attempt')
            .map((entry) => entry.details?.delayMs),
        ).toEqual([14.5, 20]);
        expect(reportedErrors.map((error) => error.message)).toEqual([
          'clamp reconnect failure',
          'STT connection lost after max retries',
        ]);
        expect(runtime.getVoiceState()).toBe('idle');
      });
    } finally {
      randomSpy.mockRestore();
    }
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
          reconnectJitterMs: 0,
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
      stt.simulateUnexpectedDisconnect();
      stt.emit(
        createDisconnectedSTTEvent(false, 'Mock STT disconnected unexpectedly'),
      );
      await advance(10);

      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.attempt'),
      ).toHaveLength(1);
      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.failed'),
      ).toHaveLength(1);
      expect(reportedErrors.map((error) => error.message)).toEqual([
        'mock stt connect failure',
        'STT connection lost after max retries',
      ]);
      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('preserves the final reconnect failure cause and retry history', async () => {
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
          reconnectJitterMs: 0,
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
      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(reportedErrors).toHaveLength(2);
      expect(reportedErrors[0]?.message).toBe('root reconnect failure');
      expect(reportedErrors[1]?.message).toBe(
        'STT connection lost after max retries',
      );
      expect(reportedErrors[1]).toBeInstanceOf(AggregateError);
      expect(
        Array.from((reportedErrors[1] as AggregateError).errors, (error) =>
          error instanceof Error ? error.message : String(error),
        ),
      ).toEqual(['root reconnect failure']);
      expect(reportedErrors[1]?.cause).toBeInstanceOf(Error);
      expect((reportedErrors[1]?.cause as Error | undefined)?.message).toBe(
        'root reconnect failure',
      );
    });
  });

  test('does not retry on clean STT disconnects', async () => {
    const trace = createReconnectTraceRecorder();
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1,
      reconnectJitterMs: 0,
      trace: trace.trace,
    });
    const runtime = createRuntime(config, { stt, tts });

    await runtime.startListening();
    await stt.disconnect();
    await advance(10);

    expect(stt.connectCalls).toBe(1);
    expect(runtime.getVoiceState()).toBe('listening');
    expect(runtime.getSttCircuitStatus()).toBe('closed');
    expect(
      trace.events.filter((entry) => entry.event === 'stt.reconnect.attempt'),
    ).toHaveLength(0);
  });

  test('reconnects on clean idle-timeout STT disconnects', async () => {
    const trace = createReconnectTraceRecorder();
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1,
      reconnectJitterMs: 0,
      trace: trace.trace,
    });
    const runtime = createRuntime(config, { stt, tts });

    await runtime.startListening();
    stt.simulateCleanDisconnect('Mock STT closed after idle timeout');
    await advance(10);

    expect(stt.connectCalls).toBe(2);
    expect(runtime.getVoiceState()).toBe('listening');
    expect(
      trace.events.filter((entry) => entry.event === 'stt.reconnect.attempt'),
    ).toHaveLength(1);
  });

  test('replays the current circuit status synchronously on subscription before later transitions', async () => {
    const statuses: string[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [2],
      'probe exhaustion failure',
    );
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          maxReconnectAttempts: 1,
          circuitBreakerTimeoutMs: 20,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {},
      );

      runtime.onSttCircuitStatusChange((status) => {
        statuses.push(status);
      });

      expect(statuses).toEqual(['closed']);

      await runtime.startListening();
      expect(statuses).toEqual(['closed']);

      stt.simulateUnexpectedDisconnect();
      expect(statuses).toEqual(['closed']);

      await advance(10);
      expect(runtime.getSttCircuitStatus()).toBe('open');
      expect(statuses).toEqual(['closed', 'open']);

      await advance(20);
      expect(runtime.getSttCircuitStatus()).toBe('half_open');
      expect(statuses).toEqual(['closed', 'open', 'half_open']);

      await runtime.startListening();

      expect(runtime.getSttCircuitStatus()).toBe('closed');
      expect(statuses).toEqual(['closed', 'open', 'half_open', 'closed']);
    });
  });

  test('circuit status transitions from open to half_open to closed after a successful probe', async () => {
    const statuses: string[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [2],
      'probe exhaustion failure',
    );
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          maxReconnectAttempts: 1,
          circuitBreakerTimeoutMs: 20,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {},
      );

      runtime.onSttCircuitStatusChange((status) => {
        statuses.push(status);
      });

      expect(statuses).toEqual(['closed']);

      await runtime.startListening();
      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(runtime.getSttCircuitStatus()).toBe('open');

      await advance(20);

      expect(runtime.getSttCircuitStatus()).toBe('half_open');

      await runtime.startListening();

      expect(runtime.getSttCircuitStatus()).toBe('closed');
      expect(statuses).toEqual(['closed', 'open', 'half_open', 'closed']);
    });
  });

  test('startListening rejects when the STT circuit is open instead of silently succeeding', async () => {
    const trace = createReconnectTraceRecorder();
    const reportedErrors: string[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [2],
      'probe exhaustion failure',
    );
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          maxReconnectAttempts: 1,
          circuitBreakerTimeoutMs: 20,
          trace: trace.trace,
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
      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(runtime.getSttCircuitStatus()).toBe('open');

      await expect(runtime.startListening()).rejects.toThrow(
        'Cannot start listening while the STT circuit is open',
      );

      expect(runtime.getVoiceState()).toBe('idle');
      expect(stt.connectCalls).toBe(1);
      expect(reportedErrors).toEqual([
        'probe exhaustion failure',
        'STT connection lost after max retries',
      ]);
      expect(trace.events).toContainEqual(
        expect.objectContaining({
          event: 'stt.connect.skipped',
          details: expect.objectContaining({
            operation: 'start_listening',
            reason: 'circuit_open',
          }),
        }),
      );
    });
  });

  test('warmup rejects when the STT circuit is open instead of appearing successful', async () => {
    const trace = createReconnectTraceRecorder();
    const reportedErrors: string[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [2],
      'probe exhaustion failure',
    );
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          maxReconnectAttempts: 1,
          circuitBreakerTimeoutMs: 20,
          trace: trace.trace,
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
      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(runtime.getSttCircuitStatus()).toBe('open');

      await expect(runtime.warmup()).rejects.toThrow(
        'Cannot warm up while the STT circuit is open',
      );

      expect(runtime.getVoiceState()).toBe('idle');
      expect(stt.connectCalls).toBe(1);
      expect(tts.isConnected()).toBe(true);
      expect(reportedErrors).toEqual([
        'probe exhaustion failure',
        'STT connection lost after max retries',
      ]);
      expect(trace.events).toContainEqual(
        expect.objectContaining({
          event: 'stt.connect.skipped',
          details: expect.objectContaining({
            operation: 'warmup',
            reason: 'circuit_open',
          }),
        }),
      );
    });
  });

  test('circuit status re-opens when the half_open probe fails', async () => {
    const statuses: string[] = [];
    const reportedErrors: string[] = [];
    const stt = new FailOnNthConnectWithSTTErrorProvider({
      2: createMockSTTError('parse', 'initial parse failure'),
      3: createMockSTTError('parse', 'half-open parse failure'),
    });
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          maxReconnectAttempts: 1,
          circuitBreakerTimeoutMs: 20,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          onError(error) {
            reportedErrors.push(error.message);
          },
        },
      );

      runtime.onSttCircuitStatusChange((status) => {
        statuses.push(status);
      });

      expect(statuses).toEqual(['closed']);

      await runtime.startListening();
      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(runtime.getSttCircuitStatus()).toBe('open');

      await advance(20);
      expect(runtime.getSttCircuitStatus()).toBe('half_open');

      await expect(runtime.startListening()).rejects.toThrow(
        'half-open parse failure',
      );
      expect(runtime.getSttCircuitStatus()).toBe('open');
      expect(statuses).toEqual(['closed', 'open', 'half_open', 'open']);
      expect(reportedErrors).toEqual([
        'initial parse failure',
        'STT connection lost after max retries',
      ]);
    });
  });

  test('surfaces TTS provider error events through onError and returns to idle', async () => {
    const cases = [
      {
        kind: 'auth' as const,
        message: 'mock tts auth error: invalid api key',
      },
      {
        kind: 'quota' as const,
        message: 'mock tts quota error: subscription overage limit reached',
      },
      {
        kind: 'parse' as const,
        message: 'mock tts parse error: malformed provider payload',
      },
      {
        kind: 'server' as const,
        message: 'mock tts server error: upstream exploded',
      },
      {
        kind: 'unknown' as const,
        message: 'mock tts unknown error: unexpected runtime condition',
      },
    ];

    for (const testCase of cases) {
      const reportedErrors: Error[] = [];
      const { config, stt, tts } = createConfig();
      const runtime = createRuntime(
        config,
        { stt, tts },
        {
          onError(error) {
            reportedErrors.push(error);
          },
        },
      );

      await runtime.speak('hello world');
      tts.emit({
        type: 'error',
        error: createMockTTSError(testCase.kind, testCase.message),
      });

      expect(reportedErrors).toHaveLength(1);
      expect(reportedErrors[0]?.message).toBe(testCase.message);
      expect((reportedErrors[0] as TTSError).kind).toBe(testCase.kind);
      expect((reportedErrors[0] as TTSError).source).toBe('tts');
      expect((reportedErrors[0] as TTSError).provider).toBe('mock-tts');
      expect(runtime.getVoiceState()).toBe('idle');
    }
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

      stt.simulateUnexpectedDisconnect();
      tts.settleActiveSpeak('completed');
      await advance(550);

      expect(reportedErrors).toContain('mock stt connect failure');
      expect(
        traceEvents.filter((entry) => entry.event === 'stt.reconnect.attempt'),
      ).toHaveLength(0);
    });
  });

  test('drops oldest buffered audio by duration and reports droppedDurationMs', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { config, stt, tts } = createConfig({
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 0.05 });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

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
        reconnectJitterMs: 0,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      stt.simulateUnexpectedDisconnect();

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
        reconnectJitterMs: 0,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
        buildChartRequest: defaultBuildChartRequest,
        processIntent: defaultProcessIntent,
      });

      await runtime.startListening();
      stt.simulateUnexpectedDisconnect();

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

      stt.emit({
        type: 'disconnected',
        clean: false,
        reason: 'transport_lost',
        message: 'Mock STT disconnected unexpectedly',
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

  test('debounces reconnect-buffer audio_dropped notifications and sums droppedDurationMs', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1000,
      reconnectJitterMs: 0,
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    stt.simulateUnexpectedDisconnect();

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

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
    const { config, stt, tts } = createConfig({
      audioBufferMaxMs: 5,
      reconnectDelayMs: 1000,
      reconnectJitterMs: 0,
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);
    expect(audioDropped.events).toEqual([]);

    await runtime.startListening();
    stt.simulateUnexpectedDisconnect();
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
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1000,
      reconnectJitterMs: 0,
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    stt.simulateUnexpectedDisconnect();

    runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);
    runtime.destroy();
    await advance(audioDropDebounceMs);

    expect(audioDropped.events).toEqual([]);
  });

  test('destroy during active grace prevents later onError calls or state-change events after teardown', async () => {
    const reportedErrors: string[] = [];
    const voiceStates: string[] = [];
    const { config, stt, tts } = createConfig({
      vadFinalDebounceMs: 5,
      transcriptGraceMs: 20,
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    runtime.onVoiceStateChange((state) => {
      voiceStates.push(state);
    });

    await runtime.startListening();
    expect(voiceStates).toEqual(['listening']);

    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(5);

    runtime.destroy();

    expect(reportedErrors).toEqual([]);
    expect(voiceStates).toEqual(['listening']);

    await advance(20);
    await advance(0);

    expect(reportedErrors).toEqual([]);
    expect(voiceStates).toEqual(['listening']);
  });

  test('isolates trace callback failures so onError still receives the original runtime failure', async () => {
    const reportedErrors: Error[] = [];
    const stt = new FailOnNthConnectSTTProvider(
      [1],
      'mock stt connect failure',
    );
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          trace() {
            throw new Error('trace exploded');
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

      await expect(runtime.startListening()).rejects.toThrow(
        'mock stt connect failure',
      );

      expect(reportedErrors).toHaveLength(2);
      expect(reportedErrors[0]?.message).toBe(
        'Voice session trace callback failed for "stt.start_listening.requested"',
      );
      expect((reportedErrors[0]?.cause as Error | undefined)?.message).toBe(
        'trace exploded',
      );
      expect(reportedErrors[1]?.message).toBe(
        'Voice session trace callback failed for "stt.connecting"',
      );
      expect((reportedErrors[1]?.cause as Error | undefined)?.message).toBe(
        'trace exploded',
      );
      expect(runtime.getVoiceState()).toBe('idle');
    });
  });

  test('flushes pending reconnect audio_dropped telemetry on stopListening', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1000,
      reconnectJitterMs: 0,
      audioBufferMaxMs: 5,
      trace(event: string, details?: Record<string, unknown>) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    stt.simulateUnexpectedDisconnect();

    runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);
    await runtime.stopListening();
    await advance(audioDropDebounceMs);

    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'reconnect_buffer_full',
        droppedDurationMs: 4,
      },
    ]);
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
          reconnectJitterMs: 0,
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
      stt.simulateUnexpectedDisconnect();

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
      expect(reportedErrors.map((error) => error.message)).toEqual([
        'Dropped 4ms of buffered STT audio because the audio buffer exceeded audioBufferMaxMs',
        'mock stt connect failure',
        'STT connection lost after max retries',
      ]);
      expect(reportedErrors[2]).toBeInstanceOf(AggregateError);
      expect(
        Array.from((reportedErrors[2] as AggregateError).errors, (error) =>
          error instanceof Error ? error.message : String(error),
        ),
      ).toEqual(['mock stt connect failure']);
      expect(reportedErrors[2]?.cause).toBeInstanceOf(Error);
      expect((reportedErrors[2]?.cause as Error | undefined)?.message).toBe(
        'mock stt connect failure',
      );

      await expect(runtime.startListening()).rejects.toThrow(
        'Cannot start listening while the STT circuit is open',
      );
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

  test('trace callback failures during reconnect handling do not flush pending audio_dropped notifications early', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: Error[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const stt = new FailOnNthConnectSTTProvider([2]);
    const tts = new MockTTSProvider();
    const processIntent: ProcessIntent = {
      process() {
        return new Promise<MaelstromResponse>(() => {});
      },
    };

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          audioBufferMaxMs: 5,
          trace(event, details) {
            traceEvents.push({ event, details });

            if (event === 'stt.reconnect.failed') {
              throw new Error('mock reconnect failed trace failure');
            }
          },
          buildChartRequest: defaultBuildChartRequest,
          processIntent,
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

      stt.emit({
        type: 'transcript',
        result: { text: 'hello', isFinal: true },
      });
      runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
      await advance(sharedVadFinalDebounceMs);

      expect(runtime.getVoiceState()).toBe('processing');

      runtime.sendAudioChunk(makeLinear16Chunk(4, 1));
      runtime.sendAudioChunk(makeLinear16Chunk(4, 2));
      await advance(50);

      stt.simulateUnexpectedDisconnect();
      await advance(10);

      expect(audioDropped.events).toEqual([]);
      expect(reportedErrors.map((error) => error.message)).toContain(
        'Voice session trace callback failed for "stt.reconnect.failed"',
      );
      expect(runtime.getVoiceState()).toBe('processing');

      await advance(audioDropDebounceMs + 1);

      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'state_not_listening',
          droppedDurationMs: 8,
        },
      ]);
      expect(traceEvents).not.toContainEqual(
        expect.objectContaining({
          event: 'stt.reconnect.unhandled_failure',
        }),
      );
    });
  });

  test('emits audio_dropped to listeners and callback with the same payload', async () => {
    const callbackEvents: AudioDroppedEvent[] = [];
    const listenerEvents: AudioDroppedEvent[] = [];
    const { config, stt, tts } = createConfig({
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onAudioDropped(event: AudioDroppedEvent) {
          callbackEvents.push(event);
        },
      },
    );

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

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
    const { config, stt, tts } = createConfig({
      reconnectDelayMs: 1,
      reconnectJitterMs: 0,
      audioBufferMaxMs: 5,
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.startListening();
    stt.simulateUnexpectedDisconnect();

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        ...audioDropped.callbacks,
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        ...audioDropped.callbacks,
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

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
    const { config, stt, tts } = createConfig({
      audioBufferMaxMs: 5,
      reconnectDelayMs: 1000,
      reconnectJitterMs: 0,
    });
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));

    await advance(50);

    await runtime.startListening();
    stt.simulateUnexpectedDisconnect();
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
          reconnectJitterMs: 0,
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
      stt.simulateUnexpectedDisconnect();

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
          reconnectJitterMs: 0,
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
      stt.simulateUnexpectedDisconnect();

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
    const { config, stt, tts } = createConfig({ audioBufferMaxMs: 5 });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        ...audioDropped.callbacks,
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

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
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        ...audioDropped.callbacks,
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

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

  test('surfaces non-listening duration_unavailable as the public error cause without emitting audio_dropped', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: Error[] = [];
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        ...audioDropped.callbacks,
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    audioDropped.attach(runtime);

    await runtime.speak('hello world');
    runtime.sendAudioChunk(makeOpusChunk(1));

    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe(
      'Cannot accept audio chunk while voice session is speaking',
    );
    expect(reportedErrors[0]?.cause).toBeInstanceOf(Error);
    expect((reportedErrors[0]?.cause as Error | undefined)?.message).toBe(
      'Opus audio chunks must provide bytesPerSample before buffering so duration can be estimated safely',
    );

    await advance(audioDropDebounceMs + 1);
    expect(audioDropped.events).toEqual([]);
  });

  test('coalesces sustained non-listening audio pressure into debounced state_not_listening buckets', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(config, { stt, tts }, audioDropped.callbacks);

    audioDropped.attach(runtime);

    await runtime.speak('hello world');

    runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
    await advance(50);
    runtime.sendAudioChunk(makeLinear16Chunk(4, 2));
    await advance(40);
    runtime.sendAudioChunk(makeLinear16Chunk(5, 3));

    await advance(audioDropDebounceMs - 90);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'state_not_listening',
        droppedDurationMs: 12,
      },
    ]);

    runtime.sendAudioChunk(makeLinear16Chunk(6, 4));
    await advance(50);
    runtime.sendAudioChunk(makeLinear16Chunk(7, 5));

    await advance(audioDropDebounceMs - 50 + 1);
    expect(audioDropped.events).toEqual([
      {
        type: 'audio_dropped',
        reason: 'state_not_listening',
        droppedDurationMs: 12,
      },
      {
        type: 'audio_dropped',
        reason: 'state_not_listening',
        droppedDurationMs: 13,
      },
    ]);
  });

  test('evicts and reports live stt_send_failed buffered audio', async () => {
    const audioDropped = createAudioDroppedRecorder();
    const reportedErrors: string[] = [];
    const stt = new ThrowAndDisconnectThenThrowOnceOnReplaySTTProvider();
    const tts = new MockTTSProvider();

    await withPatchedProviderFactories({ stt, tts }, async () => {
      const runtime = createVoiceSession(
        {
          stt: createSTTTestConfig(),
          tts: createTTSTestConfig(),
          sessionId: SessionId('session-test'),
          reconnectDelayMs: 1,
          reconnectJitterMs: 0,
          buildChartRequest: defaultBuildChartRequest,
          processIntent: defaultProcessIntent,
        },
        {
          ...audioDropped.callbacks,
          onError(error) {
            reportedErrors.push(error.message);
          },
        },
      );

      audioDropped.attach(runtime);

      await runtime.startListening();
      runtime.sendAudioChunk(makeLinear16Chunk(3, 1));
      await advance(10);
      await advance(audioDropDebounceMs + 1);

      expect(reportedErrors).toContain(
        'Failed to send STT audio chunk while listening',
      );
      expect(reportedErrors).toContain(
        'Failed to replay buffered STT audio chunk',
      );
      expect(audioDropped.events).toEqual([
        {
          type: 'audio_dropped',
          reason: 'stt_send_failed',
          droppedDurationMs: 3,
        },
      ]);
      expect(stt.sentAudioChunks).toHaveLength(0);
    });
  });

  test('suppresses the old VAD/no-transcript error and returns to idle after transcript grace expires', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      {
        ...config,
        transcriptGraceMs: 10,
        trace(event, details) {
          traceEvents.push({ event, details });
        },
      },
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    await runtime.startListening();
    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(sharedVadFinalDebounceMs + 15);

    expect(reportedErrors).toEqual([]);
    expect(runtime.getVoiceState()).toBe('idle');
    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'stt.transcript_grace.expired',
      }),
    );
  });

  test('processRequest reuses the runtime-owned intent boundary and can skip speaking', async () => {
    const processIntent: ProcessIntent = {
      async process(request) {
        return createProcessResponse(request, {
          userMessage: 'spoken reply',
        });
      },
    };

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });
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

    const { config, stt, tts } = createConfig({
      sessionId: SessionId('session-test'),
      buildChartRequest,
      processIntent,
    });
    const runtime = createRuntime(config, { stt, tts });

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

  test('processRequest stops active speech before entering processing', async () => {
    const processIntent: ProcessIntent = {
      async process(request) {
        return createProcessResponse(request);
      },
    };

    const { config, stt, tts } = createConfig({ processIntent });
    const runtime = createRuntime(config, { stt, tts });
    const request = createRequest('typed request');

    await runtime.speak('hello world');
    await runtime.processRequest(request, { speakResponse: false });

    expect(tts.stopCalls).toBe(1);
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('runtime voice state stays authoritative without provider speaking accessors', async () => {
    const voiceStates: string[] = [];
    const { config, stt, tts } = createConfig(
      {},
      { tts: new EventOnlyTTSProvider() },
    );
    const runtime = createRuntime(config, { stt, tts });

    runtime.onVoiceStateChange((state) => {
      voiceStates.push(state);
    });

    await runtime.speak('hello world');

    expect(voiceStates).toEqual(['speaking', 'idle']);
    expect(runtime.getVoiceState()).toBe('idle');
  });

  test('returns to idle and reports an error when TTS disconnects uncleanly mid-speech', async () => {
    const reportedErrors: Error[] = [];
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    await runtime.speak('hello world');
    tts.emit({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message: 'Mock TTS disconnected unexpectedly',
    });

    expect(runtime.getVoiceState()).toBe('idle');
    expect(reportedErrors).toHaveLength(1);
    expect(reportedErrors[0]?.message).toBe(
      'Mock TTS disconnected unexpectedly',
    );
    expect((reportedErrors[0] as TTSError).kind).toBe('transport');
    expect((reportedErrors[0] as TTSError).provider).toBe('mock-tts');
    expect((reportedErrors[0]?.cause as TTSEvent | undefined)?.type).toBe(
      'disconnected',
    );
    expect(reportedErrors[0]?.cause as TTSEvent | undefined).toEqual({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message: 'Mock TTS disconnected unexpectedly',
    });
  });

  test('returns to idle without reporting an error when TTS disconnects cleanly mid-speech', async () => {
    const reportedErrors: Error[] = [];
    const speechStops: boolean[] = [];
    const { config, stt, tts } = createConfig();
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
        onSpeechStopped(completed) {
          speechStops.push(completed);
        },
      },
    );

    await runtime.speak('hello world');
    tts.emit({
      type: 'disconnected',
      clean: true,
      reason: 'clean_shutdown',
      message: 'Mock TTS disconnected cleanly',
    });

    expect(runtime.getVoiceState()).toBe('idle');
    expect(speechStops).toEqual([false]);
    expect(reportedErrors).toEqual([]);
  });

  test('stays out of speaking when TTS connect fails before speech starts', async () => {
    const reportedErrors: Error[] = [];
    const tts = new FailOnConnectTTSProvider();
    const { config, stt } = createConfig({}, { tts });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    await expect(runtime.speak('hello world')).rejects.toThrow(
      'mock tts connect failure',
    );

    expect(runtime.getVoiceState()).toBe('idle');
    expect(runtime.shouldAutoRestart()).toBe(true);
    expect(tts.spokenTexts).toEqual([]);
    expect(reportedErrors).toEqual([]);
  });

  test('stays out of speaking when provider speak throws before a handle starts', async () => {
    const reportedErrors: Error[] = [];
    const tts = new FailOnSpeakTTSProvider();
    const { config, stt } = createConfig({}, { tts });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error);
        },
      },
    );

    await expect(runtime.speak('hello world')).rejects.toThrow(
      'mock tts speak failure',
    );

    expect(runtime.getVoiceState()).toBe('idle');
    expect(runtime.shouldAutoRestart()).toBe(true);
    expect(tts.spokenTexts).toEqual(['hello world']);
    expect(reportedErrors).toEqual([]);
  });

  test('auto-restarts listening after speech completes naturally', async () => {
    const speechStarts: string[] = [];
    const speechStops: boolean[] = [];
    const tts = new AutoEventTTSProvider();
    const { config, stt } = createConfig({}, { tts });
    const runtime = createRuntime(
      config,
      { stt, tts },
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
    tts.settleActiveSpeak('completed');
    await advance(550);

    expect(speechStops).toEqual([true]);
    expect(runtime.getVoiceState()).toBe('listening');
    expect(runtime.shouldAutoRestart()).toBe(false);
    expect(stt.connectCalls).toBe(initialConnectCalls + 1);
  });

  test('interrupting active speech stops playback, reports user interrupt, and does not auto-restart listening', async () => {
    const interrupts: Array<'user' | 'system'> = [];
    const speechStops: boolean[] = [];
    const tts = new AutoEventTTSProvider();
    const { config, stt } = createConfig({}, { tts });
    const runtime = createRuntime(
      config,
      { stt, tts },
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
    runtime.interrupt();

    expect(interrupts).toEqual(['user']);
    expect(speechStops).toEqual([false]);
    expect(runtime.getVoiceState()).toBe('idle');
    expect(runtime.shouldAutoRestart()).toBe(true);
    expect(stt.connectCalls).toBe(0);
  });

  test('interrupt clears pending finalization after speech_end', async () => {
    const reportedErrors: string[] = [];
    const traceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const voiceStates: string[] = [];
    const { config, stt, tts } = createConfig({
      vadFinalDebounceMs: 5,
      transcriptGraceMs: 20,
      trace(event, details) {
        traceEvents.push({ event, details });
      },
    });
    const runtime = createRuntime(
      config,
      { stt, tts },
      {
        onError(error) {
          reportedErrors.push(error.message);
        },
      },
    );

    runtime.onVoiceStateChange((state) => {
      voiceStates.push(state);
    });

    await runtime.startListening();
    expect(voiceStates).toEqual(['listening']);

    runtime.handleVADEvent({ type: 'speech_end', timestamp: Date.now() });
    await advance(5);

    runtime.interrupt();

    expect(runtime.getVoiceState()).toBe('idle');
    expect(voiceStates).toEqual(['listening', 'idle']);
    expect(reportedErrors).toEqual([]);

    await advance(20);
    await advance(0);

    expect(reportedErrors).toEqual([]);
    expect(voiceStates).toEqual(['listening', 'idle']);
    expect(runtime.getVoiceState()).toBe('idle');
    expect(
      traceEvents.filter(
        (entry) => entry.event === 'stt.transcript_grace.started',
      ),
    ).toHaveLength(1);
    expect(
      traceEvents.some(
        (entry) => entry.event === 'stt.transcript_grace.expired',
      ),
    ).toBe(false);
  });
});

describe('createSttDisconnectSuppressionController', () => {
  test('keeps suppression active until the last overlapping force reconnect releases it', () => {
    const suppression = createSttDisconnectSuppressionController();

    const releaseFirst = suppression.suppress();
    const releaseSecond = suppression.suppress();

    expect(suppression.isSuppressed()).toBe(true);

    releaseFirst();
    expect(suppression.isSuppressed()).toBe(true);

    releaseFirst();
    expect(suppression.isSuppressed()).toBe(true);

    releaseSecond();
    expect(suppression.isSuppressed()).toBe(false);
  });
});
