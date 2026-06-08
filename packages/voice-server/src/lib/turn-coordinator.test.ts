import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TelemetrySink } from '@maelstrom-co/telemetry';
import {
  MessageId,
  SessionId,
  type ChartRequest,
  type MaelstromResponse,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import {
  createTurnCoordinator,
  type TurnCoordinatorDeps,
} from './turn-coordinator.js';
import type {
  TranscriptionResult,
  VoiceSessionCallbacks,
  VoiceSessionIntentRequestBuilder,
  VoiceSessionState,
} from './types.js';

function createRequest(text: string): ChartRequest {
  return {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: text }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'tiling',
    },
    instances: [],
    vessels: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}

function createResponse(
  request: ChartRequest,
  overrides: Partial<MaelstromResponse> = {},
): MaelstromResponse {
  const userIntent = request.context.updateReasons.find(
    (reason): reason is Extract<typeof reason, { type: 'user_intent' }> =>
      reason.type === 'user_intent',
  );

  return {
    type: 'maelstrom_response',
    requestId: MessageId(`request:${userIntent?.intent ?? 'test'}`),
    userMessage: '',
    rationale: '',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
    ...overrides,
  };
}

function createCoordinatorHarness(
  overrides: Partial<{
    autoRestartListening: boolean;
    interimResults: boolean;
    transcriptGraceMs: number;
    callbacks: VoiceSessionCallbacks;
    emitStateTelemetry: (
      previousState: VoiceSessionState,
      newState: VoiceSessionState,
    ) => void;
    buildChartRequest: VoiceSessionIntentRequestBuilder;
    processIntent: (
      request: ChartRequest,
      signal?: AbortSignal,
    ) => Promise<MaelstromResponse>;
  }> = {},
) {
  const callbackEvents: Array<{ name: string; value: unknown }> = [];
  const traces: Array<{ event: string; details?: Record<string, unknown> }> =
    [];
  const reportedErrors: Error[] = [];
  const telemetryEvents: Array<{
    name: string;
    attributes?: Record<string, string | number | boolean>;
  }> = [];
  const telemetryTimings: Array<{
    name: string;
    duration: number;
    attributes?: Record<string, string | number | boolean>;
  }> = [];
  const transcripts: Array<{ text: string; isFinal: boolean }> = [];
  const voiceStates: VoiceSessionState[] = [];
  const stateTelemetryCalls: Array<{
    previousState: VoiceSessionState;
    newState: VoiceSessionState;
  }> = [];
  let destroyed = false;
  let currentState: VoiceSessionState = 'idle';
  let pendingFinalFromVAD = false;
  let sttStartListeningCalls = 0;
  let sttEndStreamCalls = 0;
  let vadClearCalls = 0;
  let ttsStopCalls = 0;
  const spokenTexts: string[] = [];

  const callbacks: VoiceSessionCallbacks = {
    onInterrupt(reason) {
      callbackEvents.push({ name: 'onInterrupt', value: reason });
    },
    onSpeechStopped(completed) {
      callbackEvents.push({ name: 'onSpeechStopped', value: completed });
    },
    onTranscript(result) {
      callbackEvents.push({ name: 'onTranscript', value: result.isFinal });
    },
    ...overrides.callbacks,
  };

  const buildChartRequest: VoiceSessionIntentRequestBuilder =
    overrides.buildChartRequest ??
    (({ transcript }) => createRequest(transcript));

  const processIntent =
    overrides.processIntent ?? (async (request) => createResponse(request));

  const telemetry: TelemetrySink = {
    emitEvent(event) {
      telemetryEvents.push({
        name: event.name,
        attributes: event.attributes as
          | Record<string, string | number | boolean>
          | undefined,
      });
    },
    recordMetric() {},
    recordTiming(timing) {
      telemetryTimings.push({
        name: timing.name,
        duration: timing.duration,
        attributes: timing.attributes as
          | Record<string, string | number | boolean>
          | undefined,
      });
    },
  };

  const deps: TurnCoordinatorDeps = {
    sessionId: SessionId('turn-coordinator-test'),
    intentBoundary: {
      buildChartRequest,
      processIntent: { process: processIntent },
    },
    autoRestartListening: overrides.autoRestartListening ?? true,
    transcriptGraceMs: overrides.transcriptGraceMs ?? 10,
    interimResults: overrides.interimResults ?? false,
    isDestroyed: () => destroyed,
    trace(event: string, details?: Record<string, unknown>) {
      traces.push({ event, details });
    },
    reportError(error: unknown) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    reportAsyncFailure(
      event: string,
      error: unknown,
      details?: Record<string, unknown>,
    ) {
      traces.push({ event, details });
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    notifyCallbackSafely<T extends unknown[]>(
      callback: ((...args: T) => void) | undefined,
      _traceEvent: string,
      ...args: T
    ) {
      callback?.(...args);
    },
    eventSink: {
      emitTranscript(
        result: TranscriptionResult,
        options: { includeCallback: boolean },
      ) {
        transcripts.push({ text: result.text, isFinal: result.isFinal });
        if (options.includeCallback) {
          callbacks.onTranscript?.(result);
        }
        return transcripts.length;
      },
      emitVoiceStateChange(state: VoiceSessionState) {
        voiceStates.push(state);
        callbacks.onVoiceStateChange?.(state);
      },
    },
    emitStateTelemetry:
      overrides.emitStateTelemetry ??
      ((previousState: VoiceSessionState, newState: VoiceSessionState) => {
        stateTelemetryCalls.push({ previousState, newState });
      }),
    telemetry,
    callbacks,
    getSttStartListening: () => async () => {
      sttStartListeningCalls += 1;
    },
    getTTSStop: () => () => {
      ttsStopCalls += 1;
    },
    getTTSSpeak: () => async (text: string) => {
      spokenTexts.push(text);
    },
    getSttEndStream: () => () => {
      sttEndStreamCalls += 1;
    },
    getVADClearPendingFinalization: () => () => {
      pendingFinalFromVAD = false;
      vadClearCalls += 1;
    },
    getVADIsPendingFinalFromVAD: () => () => pendingFinalFromVAD,
  };

  const coordinator = createTurnCoordinator(deps);

  return {
    callbackEvents,
    coordinator,
    destroy() {
      destroyed = true;
    },
    getCurrentState() {
      return currentState;
    },
    pendingFinalFromVAD(value: boolean) {
      pendingFinalFromVAD = value;
    },
    reportedErrors,
    setCurrentState(state: VoiceSessionState) {
      currentState = state;
      coordinator.setVoiceState(state);
    },
    spokenTexts,
    sttEndStreamCalls: () => sttEndStreamCalls,
    sttStartListeningCalls: () => sttStartListeningCalls,
    stateTelemetryCalls,
    telemetryEvents,
    telemetryTimings,
    traces,
    transcripts,
    ttsStopCalls: () => ttsStopCalls,
    vadClearCalls: () => vadClearCalls,
    voiceStates,
  };
}

function expectTelemetryAttributesToStaySanitized(
  attributes: Record<string, string | number | boolean> | undefined,
): void {
  expect(attributes).not.toHaveProperty('requestId');
  expect(attributes).not.toHaveProperty('sessionId');
  expect(attributes).not.toHaveProperty('text');
  expect(attributes).not.toHaveProperty('textLength');
  expect(attributes).not.toHaveProperty('preview');
  expect(attributes).not.toHaveProperty('prompt');
  expect(attributes).not.toHaveProperty('responseText');
  expect(attributes).not.toHaveProperty('replyLength');
  expect(attributes).not.toHaveProperty('transcriptLength');
  expect(attributes).not.toHaveProperty('userMessage');
}

describe('turn-coordinator', () => {
  let clock: FakeTimers.InstalledClock;

  beforeEach(() => {
    clock = FakeTimers.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('interrupt handles speaking, processing, and listening states in isolation', () => {
    const speaking = createCoordinatorHarness();
    speaking.setCurrentState('speaking');
    speaking.coordinator.interrupt();

    expect(speaking.ttsStopCalls()).toBe(1);
    expect(speaking.callbackEvents).toContainEqual({
      name: 'onInterrupt',
      value: 'user',
    });

    const processing = createCoordinatorHarness();
    processing.setCurrentState('processing');
    processing.coordinator.interrupt();

    expect(processing.voiceStates.at(-1)).toBe('idle');
    expect(processing.callbackEvents).toContainEqual({
      name: 'onInterrupt',
      value: 'user',
    });

    const listening = createCoordinatorHarness();
    listening.setCurrentState('listening');
    listening.coordinator.interrupt();

    expect(listening.sttEndStreamCalls()).toBe(1);
    expect(listening.voiceStates.at(-1)).toBe('idle');
    expect(listening.callbackEvents).toContainEqual({
      name: 'onInterrupt',
      value: 'user',
    });
  });

  test('suppresses one auto-restart after speaking interruption, then rearms', async () => {
    const harness = createCoordinatorHarness();

    harness.setCurrentState('speaking');
    harness.coordinator.interrupt();
    harness.coordinator.setVoiceState('idle');
    await clock.tickAsync(500);

    expect(harness.sttStartListeningCalls()).toBe(0);

    harness.setCurrentState('speaking');
    harness.coordinator.setVoiceState('idle');
    await clock.tickAsync(500);

    expect(harness.sttStartListeningCalls()).toBe(1);
  });

  test('emits state telemetry only after voice state listeners and callbacks finish', () => {
    const sequence: string[] = [];
    const harness = createCoordinatorHarness({
      callbacks: {
        onVoiceStateChange() {
          sequence.push('callback');
        },
      },
      emitStateTelemetry(previousState, newState) {
        sequence.push(`telemetry:${previousState}->${newState}`);
      },
    });

    harness.coordinator.setVoiceState('listening');

    expect(harness.voiceStates).toEqual(['listening']);
    expect(sequence).toEqual(['callback', 'telemetry:idle->listening']);
  });

  test('swallows state telemetry failures without blocking the transition or callbacks', () => {
    const callbackStates: VoiceSessionState[] = [];
    const harness = createCoordinatorHarness({
      callbacks: {
        onVoiceStateChange(state) {
          callbackStates.push(state);
        },
      },
      emitStateTelemetry() {
        throw new Error('telemetry exploded');
      },
    });

    expect(() => harness.coordinator.setVoiceState('listening')).not.toThrow();

    expect(harness.coordinator.getVoiceState()).toBe('listening');
    expect(harness.voiceStates).toEqual(['listening']);
    expect(callbackStates).toEqual(['listening']);
  });

  test('skips stale intent work after a newer request wins during request creation', async () => {
    let firstResolve!: (request: ChartRequest) => void;
    const processedRequests: string[] = [];
    const harness = createCoordinatorHarness({
      processIntent: async (request) => {
        processedRequests.push(
          request.context.updateReasons[0]?.type === 'user_intent'
            ? request.context.updateReasons[0].intent
            : 'unknown',
        );
        return createResponse(request);
      },
    });

    const first = harness.coordinator.executeIntentRequest(
      () =>
        new Promise<ChartRequest>((resolve) => {
          firstResolve = resolve;
        }),
      {},
    );
    const second = harness.coordinator.processRequest(createRequest('second'));

    firstResolve(createRequest('first'));
    await Promise.all([first, second]);

    expect(processedRequests).toEqual(['second']);
  });

  test('reports repeated grace expiry only at the configured threshold boundary', async () => {
    const harness = createCoordinatorHarness({ transcriptGraceMs: 10 });

    harness.setCurrentState('listening');

    for (let index = 0; index < 2; index += 1) {
      harness.coordinator.startTranscriptGrace();
      await clock.tickAsync(10);
      harness.setCurrentState('listening');
    }

    expect(harness.reportedErrors).toEqual([]);

    harness.coordinator.startTranscriptGrace();
    await clock.tickAsync(10);

    expect(harness.reportedErrors).toHaveLength(1);
    expect(harness.reportedErrors[0]?.message).toContain(
      'Repeated transcript grace expiries reached degraded mode',
    );
  });

  test('records explicit intent timing and turn lifecycle telemetry without request or response content', async () => {
    const harness = createCoordinatorHarness({
      processIntent: async (request) =>
        createResponse(request, {
          userMessage: 'secret assistant reply',
        }),
    });

    await harness.coordinator.processRequest(createRequest('secret user intent'));

    expect(harness.telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.turn.started',
        attributes: { source: 'explicit' },
      },
      {
        name: 'maelstrom.voice_server.turn.completed',
        attributes: {
          source: 'explicit',
          outcome: 'completed',
        },
      },
    ]);
    expect(harness.telemetryTimings).toHaveLength(1);
    expect(harness.telemetryTimings[0]?.name).toBe(
      'maelstrom.voice_server.intent.duration',
    );
    expect(harness.telemetryTimings[0]?.duration).toBeGreaterThanOrEqual(0);
    expect(harness.telemetryTimings[0]?.attributes).toEqual({
      outcome: 'completed',
      speakResponse: true,
    });
    expect(harness.spokenTexts).toEqual(['secret assistant reply']);

    for (const event of harness.telemetryEvents) {
      expectTelemetryAttributesToStaySanitized(event.attributes);
    }
    for (const timing of harness.telemetryTimings) {
      expectTelemetryAttributesToStaySanitized(timing.attributes);
    }
  });

  test('records STT turn lifecycle telemetry when a finalized transcript starts processing', async () => {
    const harness = createCoordinatorHarness();

    harness.coordinator.finalizeTranscript('hello from speech');
    await clock.tickAsync(0);

    expect(harness.telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.turn.started',
        attributes: { source: 'stt' },
      },
      {
        name: 'maelstrom.voice_server.turn.completed',
        attributes: {
          source: 'stt',
          outcome: 'completed',
        },
      },
    ]);
  });

  test('records aborted intent timing and turn completion exactly once when interrupted mid-processing', async () => {
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const harness = createCoordinatorHarness({
      processIntent: (_request, signal) =>
        new Promise<MaelstromResponse>((_resolve, reject) => {
          resolveStarted();
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    });

    const pendingRequest = harness.coordinator.processRequest(
      createRequest('interrupt me'),
    );

    await started;

    harness.coordinator.interrupt();
    await pendingRequest;

    expect(harness.telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.turn.started',
        attributes: { source: 'explicit' },
      },
      {
        name: 'maelstrom.voice_server.turn.completed',
        attributes: {
          source: 'explicit',
          outcome: 'aborted',
        },
      },
    ]);
    expect(harness.telemetryTimings[0]?.attributes).toEqual({
      outcome: 'aborted',
      speakResponse: true,
    });
  });

  test('records superseded and errored terminal outcomes without duplicate turn completion events', async () => {
    let resolveFirstRequestStarted!: () => void;
    const firstRequestStarted = new Promise<void>((resolve) => {
      resolveFirstRequestStarted = resolve;
    });
    let firstRequestSignal: AbortSignal | undefined;
    const harness = createCoordinatorHarness({
      processIntent: (request, signal) => {
        const intent = request.context.updateReasons[0];
        if (intent?.type === 'user_intent' && intent.intent === 'first request') {
          firstRequestSignal = signal;
          return new Promise<MaelstromResponse>((_resolve, reject) => {
            resolveFirstRequestStarted();
            signal?.addEventListener('abort', () => {
              reject(new Error('superseded'));
            });
          });
        }

        if (intent?.type === 'user_intent' && intent.intent === 'error request') {
          throw new Error('process failed');
        }

        return Promise.resolve(createResponse(request));
      },
    });

    const firstRequest = harness.coordinator.processRequest(
      createRequest('first request'),
    );
    await firstRequestStarted;
    const secondRequest = harness.coordinator.processRequest(
      createRequest('second request'),
    );

    await Promise.all([firstRequest, secondRequest]);
    await expect(
      harness.coordinator.processRequest(createRequest('error request')),
    ).resolves.toBeUndefined();

    expect(firstRequestSignal?.aborted).toBe(true);
    expect(harness.telemetryEvents).toEqual([
      {
        name: 'maelstrom.voice_server.turn.started',
        attributes: { source: 'explicit' },
      },
      {
        name: 'maelstrom.voice_server.turn.started',
        attributes: { source: 'explicit' },
      },
      {
        name: 'maelstrom.voice_server.turn.completed',
        attributes: {
          source: 'explicit',
          outcome: 'superseded',
        },
      },
      {
        name: 'maelstrom.voice_server.turn.completed',
        attributes: {
          source: 'explicit',
          outcome: 'completed',
        },
      },
      {
        name: 'maelstrom.voice_server.turn.started',
        attributes: { source: 'explicit' },
      },
      {
        name: 'maelstrom.voice_server.turn.completed',
        attributes: {
          source: 'explicit',
          outcome: 'errored',
        },
      },
    ]);
    expect(
      harness.telemetryEvents.filter(
        (event) => event.name === 'maelstrom.voice_server.turn.completed',
      ),
    ).toHaveLength(3);
    expect(harness.telemetryTimings.map((timing) => timing.attributes)).toEqual([
      {
        outcome: 'superseded',
        speakResponse: true,
      },
      {
        outcome: 'completed',
        speakResponse: true,
      },
      {
        outcome: 'errored',
        speakResponse: true,
      },
    ]);
  });
});
