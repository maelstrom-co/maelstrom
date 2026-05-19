import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  MessageId,
  SessionId,
  type ChartRequest,
  type MaelstromResponse,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { createTurnCoordinator } from './turn-coordinator.js';
import type {
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
  const transcripts: Array<{ text: string; isFinal: boolean }> = [];
  const voiceStates: VoiceSessionState[] = [];
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

  const coordinator = createTurnCoordinator({
    sessionId: SessionId('turn-coordinator-test'),
    intentBoundary: {
      buildChartRequest,
      processIntent: { process: processIntent },
    },
    autoRestartListening: overrides.autoRestartListening ?? true,
    transcriptGraceMs: overrides.transcriptGraceMs ?? 10,
    interimResults: overrides.interimResults ?? false,
    isDestroyed: () => destroyed,
    trace(event, details) {
      traces.push({ event, details });
    },
    reportError(error) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    reportAsyncFailure(event, error, details) {
      traces.push({ event, details });
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    notifyCallbackSafely(callback, _traceEvent, ...args) {
      callback?.(...args);
    },
    eventSink: {
      emitTranscript(result, options) {
        transcripts.push({ text: result.text, isFinal: result.isFinal });
        if (options.includeCallback) {
          callbacks.onTranscript?.(result);
        }
        return transcripts.length;
      },
      emitVoiceStateChange(state) {
        voiceStates.push(state);
        callbacks.onVoiceStateChange?.(state);
      },
    },
    callbacks,
    getSttStartListening: () => async () => {
      sttStartListeningCalls += 1;
    },
    getTTSStop: () => () => {
      ttsStopCalls += 1;
    },
    getTTSSpeak: () => async (text) => {
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
  });

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
    traces,
    transcripts,
    ttsStopCalls: () => ttsStopCalls,
    vadClearCalls: () => vadClearCalls,
    voiceStates,
  };
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
});
