import { describe, expect, mock, test } from 'bun:test';

import type { Engine } from '@maelstrom-co/engine-old';
import {
  ChartRequestMessage,
  MessageId,
  type MaelstromResponse as ProtocolMaelstromResponse,
  SessionId,
} from '@maelstrom-co/protocol';
import type { MaelstromResponse as LegacyMaelstromResponse } from '@maelstrom-co/protocol-old';
import type {
  AudioChunk,
  VoiceProviderErrorKind,
  VoiceSession,
  VoiceSessionState,
} from '@maelstrom-co/voice-server';
import type { ProviderErrorMetadata } from './provider-error-metadata.js';
import { createDemoVoiceWsSessionController } from './voice-ws-session.js';

type MockCall<Args extends unknown[]> = {
  mock: { calls: Args[] };
};

type VoiceSessionStub = VoiceSession & {
  sendAudioChunk: MockCall<[AudioChunk]>;
};

const voiceProviderKinds = [
  'auth',
  'quota',
  'transport',
  'parse',
  'server',
  'unknown',
] as const satisfies VoiceProviderErrorKind[];

const voiceProviderSources = ['stt', 'tts'] as const;

const providerBySource = {
  stt: 'deepgram',
  tts: 'cartesia',
} as const;

function createVoiceSessionStub(
  initialState: VoiceSessionState = 'idle',
  overrides: Partial<VoiceSession> = {},
): VoiceSessionStub {
  let state: VoiceSessionState = initialState;

  const unsubscribe = () => {};

  return {
    warmup: mock(async () => {}),
    getVoiceState: mock(() => state),
    startListening: mock(async () => {
      state = 'listening';
    }),
    stopListening: mock(async () => {
      state = 'idle';
    }),
    interrupt: mock(() => {
      state = 'idle';
    }),
    processRequest: mock(async () => undefined),
    onVoiceStateChange: mock(() => unsubscribe),
    onTranscript: mock(() => unsubscribe),
    onVADEvent: mock(() => unsubscribe),
    onAudioOutput: mock(() => unsubscribe),
    onAudioDropped: mock(() => unsubscribe),
    shouldAutoRestart: mock(() => false),
    handleVADEvent: mock(() => {}),
    sendAudioChunk: mock(() => {}),
    speak: mock(async () => {}),
    enqueueSpeak: mock(() => {}),
    destroy: mock(() => {
      state = 'idle';
    }),
    ...overrides,
  } as VoiceSessionStub;
}

function createEngineResponse(
  userMessage: string,
  requestId = 'response-id',
): LegacyMaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId,
    userMessage,
    rationale: '',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}

function createVoiceSessionResponse(
  userMessage: string,
  requestId = 'response-id',
): ProtocolMaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId(requestId),
    userMessage,
    rationale: '',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}

function createEngineStub(
  overrides: Partial<Pick<Engine, 'process' | 'addAssistantMessage'>> = {},
): Pick<Engine, 'process' | 'addAssistantMessage'> {
  return {
    process: mock(async () => createEngineResponse('hello back')),
    addAssistantMessage: mock(async () => {}),
    ...overrides,
  };
}

function createClassifiedProviderCase(
  kind: VoiceProviderErrorKind,
  source: (typeof voiceProviderSources)[number],
) {
  const provider = providerBySource[source];
  const prefix = provider[0].toUpperCase() + provider.slice(1);
  const operation = source === 'stt' ? 'capture' : 'playback';

  return {
    kind,
    source,
    provider,
    trigger: source === 'stt' ? 'startListening' : 'speak',
    errorMessage: `${prefix} ${kind} ${operation} failure`,
    causeMessage: `${source} ${kind} root cause`,
  } as const;
}

const classifiedProviderCases = voiceProviderSources.flatMap((source) =>
  voiceProviderKinds.map((kind) => createClassifiedProviderCase(kind, source)),
);

function createChartRequestEnvelope(
  sessionId: string,
  envelopeId: string,
  intent: string,
) {
  return ChartRequestMessage({
    id: MessageId(envelopeId),
    sessionId: SessionId(sessionId),
    timestamp: 1000,
    request: {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [],
      vessels: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    },
  });
}

function createSendEngineErrorMock() {
  return mock(
    (
      _error: string,
      _requestIdOrMetadata?: MessageId | ProviderErrorMetadata,
      _metadata?: ProviderErrorMetadata,
    ) => {},
  );
}

describe('createDemoVoiceWsSessionController', () => {
  test('covers open, audio capture lifecycle, and speak flow', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = createSendEngineErrorMock();
    const forwardBinaryAudioInput = mock(async () => {});
    const voiceSession = createVoiceSessionStub();
    const engine = createEngineStub();

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-123'),
      voiceSession,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput,
    });

    await controller.onOpen();
    await controller.onMessage(
      JSON.stringify({ type: 'client.audio_capture.ready' }),
    );
    await controller.onMessage(
      JSON.stringify({
        type: 'client.audio_capture.audio_sent',
        data: new Uint8Array([1, 2, 3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 1,
      }),
    );
    await controller.onMessage(
      JSON.stringify({ type: 'client.audio_capture.closed' }),
    );
    await controller.onMessage(
      JSON.stringify({ type: 'client.voice.speak', text: 'hello world' }),
    );

    expect(voiceSession.warmup).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.stt.ready',
        sessionId: 'session-123',
      }),
    );
    expect(voiceSession.startListening).toHaveBeenCalledTimes(1);
    expect(voiceSession.sendAudioChunk).toHaveBeenCalledTimes(1);
    const forwardedAudio = voiceSession.sendAudioChunk.mock.calls[0]?.[0];
    expect(forwardedAudio).toBeDefined();
    if (!forwardedAudio) {
      throw new Error('Expected forwarded audio chunk');
    }
    expect(Array.from(forwardedAudio.data)).toEqual([1, 2, 3]);
    expect(forwardedAudio.sampleRate).toBe(16000);
    expect(forwardedAudio.encoding).toBe('linear16');
    expect(voiceSession.stopListening).toHaveBeenCalledTimes(1);
    expect(voiceSession.enqueueSpeak).not.toHaveBeenCalled();
    expect(voiceSession.speak).toHaveBeenCalledWith('hello world');
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('routes client.voice.speak to speak() and never enqueueSpeak()', async () => {
    const voiceSession = createVoiceSessionStub();

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-123'),
      voiceSession,
      engine: createEngineStub(),
      transport: {
        sendMessage: mock(() => {}),
        sendEngineError: createSendEngineErrorMock(),
      },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({ type: 'client.voice.speak', text: 'hello world' }),
    );

    expect(voiceSession.speak).toHaveBeenCalledTimes(1);
    expect(voiceSession.speak).toHaveBeenCalledWith('hello world');
    expect(voiceSession.enqueueSpeak).not.toHaveBeenCalled();
  });

  test('does not announce ready when warmup fails and surfaces the error to the client', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = createSendEngineErrorMock();
    const voiceSession = createVoiceSessionStub('idle', {
      warmup: mock(async () => {
        throw new Error('warmup failed');
      }),
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-123'),
      voiceSession,
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onOpen();

    expect(sendEngineError).toHaveBeenCalledWith('warmup failed');
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine.stt.ready' }),
    );
  });

  test('surfaces start, stop, speak, and assistant-history failures to the client', async () => {
    const sendEngineError = createSendEngineErrorMock();
    const forwardBinaryAudioInput = mock(async () => {});

    const startController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-start'),
      voiceSession: createVoiceSessionStub('idle', {
        startListening: mock(async () => {
          throw new Error('start failed');
        }),
      }),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await startController.onMessage(
      JSON.stringify({ type: 'client.audio_capture.ready' }),
    );
    await Promise.resolve();

    const stopController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-stop'),
      voiceSession: createVoiceSessionStub('listening', {
        stopListening: mock(async () => {
          throw new Error('stop failed');
        }),
      }),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await stopController.onMessage(
      JSON.stringify({ type: 'client.audio_capture.closed' }),
    );
    await Promise.resolve();

    const speakController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-speak'),
      voiceSession: createVoiceSessionStub('idle', {
        speak: mock(() => {
          throw new Error('speak failed');
        }),
      }),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await speakController.onMessage(
      JSON.stringify({ type: 'client.voice.speak', text: 'hello world' }),
    );

    const historyController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-history'),
      voiceSession: createVoiceSessionStub(),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
        addAssistantMessage: mock(async () => {
          throw new Error('history failed');
        }),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await historyController.onMessage(
      JSON.stringify({
        type: 'client.history.add_assistant_message',
        id: 'msg-1',
        message: 'assistant says hi',
      }),
    );

    expect(sendEngineError.mock.calls.map((call) => call[0])).toEqual([
      'start failed',
      'stop failed',
      'speak failed',
      'history failed',
    ]);
  });

  test.each(
    classifiedProviderCases,
  )('forwards classified $source $kind failures with additive metadata and flattened causes', async ({
    trigger,
    source,
    kind,
    provider,
    errorMessage,
    causeMessage,
  }) => {
    const sendEngineError = createSendEngineErrorMock();

    const providerError = Object.assign(
      new Error(errorMessage, {
        cause: new Error(causeMessage),
      }),
      {
        source,
        kind,
        provider,
      },
    );

    const voiceSession = createVoiceSessionStub(
      'idle',
      trigger === 'startListening'
        ? {
            startListening: mock(async () => {
              throw providerError;
            }),
          }
        : {
            speak: mock(() => {
              throw providerError;
            }),
          },
    );

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId(`session-${source}-${kind}`),
      voiceSession,
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify(
        trigger === 'startListening'
          ? { type: 'client.audio_capture.ready' }
          : { type: 'client.voice.speak', text: 'hello world' },
      ),
    );
    await Promise.resolve();

    expect(sendEngineError).toHaveBeenCalledWith(
      `${errorMessage}: ${causeMessage}`,
      {
        kind,
        source,
        provider,
      },
    );
  });

  test('forwards classified provider metadata from a wrapped cause ancestor', async () => {
    const sendEngineError = createSendEngineErrorMock();
    const providerCause = Object.assign(new Error('deepgram auth root cause'), {
      source: 'stt',
      kind: 'auth',
      provider: 'deepgram',
    });
    const wrappedError = new Error('start wrapper failure', {
      cause: new Error('transport wrapper', {
        cause: providerCause,
      }),
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-wrapped-provider'),
      voiceSession: createVoiceSessionStub('idle', {
        startListening: mock(async () => {
          throw wrappedError;
        }),
      }),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({ type: 'client.audio_capture.ready' }),
    );
    await Promise.resolve();

    expect(sendEngineError).toHaveBeenCalledWith(
      'start wrapper failure: transport wrapper: deepgram auth root cause',
      {
        kind: 'auth',
        source: 'stt',
        provider: 'deepgram',
      },
    );
  });

  test('keeps generic runtime errors flat', async () => {
    const sendEngineError = createSendEngineErrorMock();

    const genericController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-generic'),
      voiceSession: createVoiceSessionStub('idle', {
        startListening: mock(async () => {
          throw new Error('generic startup failure');
        }),
      }),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await genericController.onMessage(
      JSON.stringify({ type: 'client.audio_capture.ready' }),
    );
    await Promise.resolve();

    expect(sendEngineError).toHaveBeenCalledWith('generic startup failure');
  });

  test('does not classify wrapped non-provider errors as provider failures', async () => {
    const sendEngineError = createSendEngineErrorMock();
    const wrappedGenericError = new Error('outer wrapper failure', {
      cause: new Error('inner generic failure'),
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-wrapped-generic'),
      voiceSession: createVoiceSessionStub('idle', {
        startListening: mock(async () => {
          throw wrappedGenericError;
        }),
      }),
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({ type: 'client.audio_capture.ready' }),
    );
    await Promise.resolve();

    expect(sendEngineError).toHaveBeenCalledWith(
      'outer wrapper failure: inner generic failure',
    );
    expect(sendEngineError.mock.calls[0]?.[1]).toBeUndefined();
  });

  test('routes client.maelstrom.process through voiceSession when voice is enabled', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = createSendEngineErrorMock();
    let mirroredRequestDuringProcessing: ReturnType<
      ReturnType<
        typeof createDemoVoiceWsSessionController
      >['getLatestChartRequest']
    > = null;
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => {
      mirroredRequestDuringProcessing = controller.getLatestChartRequest();
      return undefined;
    });
    const engine = createEngineStub({
      process: mock(async () => createEngineResponse('should not be used')),
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-voice'),
      voiceSession,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: createChartRequestEnvelope(
          'session-voice',
          'envelope-req-1',
          'show chart',
        ),
      }),
    );

    expect(voiceSession.processRequest).toHaveBeenCalledTimes(1);
    const mirroredRequest = controller.getLatestChartRequest();
    expect(mirroredRequest).toEqual({
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'show chart' }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [],
      vessels: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    });
    expect(mirroredRequestDuringProcessing === mirroredRequest).toBe(true);
    expect(voiceSession.processRequest).toHaveBeenCalledWith(
      mirroredRequest,
      expect.objectContaining({ speakResponse: true }),
    );
    expect(engine.process).not.toHaveBeenCalled();
    expect(sendEngineError).not.toHaveBeenCalled();
    // processRequest returns undefined → no correlation response sent
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine.maelstrom.response' }),
    );
  });

  test('sends engine.maelstrom.response with envelope id after voiceSession.processRequest resolves', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = createSendEngineErrorMock();
    const voiceResponse = createVoiceSessionResponse(
      'chart updated',
      'voice-generated-uuid',
    );
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => voiceResponse);

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-voice-corr'),
      voiceSession,
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('should not be used')),
      }),
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: createChartRequestEnvelope(
          'session-voice-corr',
          'envelope-corr-id',
          'pie chart',
        ),
      }),
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.maelstrom.response',
        requestId: 'envelope-corr-id',
        response: voiceResponse,
      }),
    );
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('unwraps ChartRequestMessage envelope and uses envelope id for engine correlation', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = createSendEngineErrorMock();
    const engineResponse = createEngineResponse('done', 'engine-resp-1');
    const engine = createEngineStub({
      process: mock(async () => engineResponse),
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-engine'),
      voiceSession: null,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: createChartRequestEnvelope(
          'session-engine',
          'envelope-id-42',
          'bar chart',
        ),
      }),
    );

    expect(engine.process).toHaveBeenCalledTimes(1);
    const latestRequest = controller.getLatestChartRequest();
    expect(latestRequest?.context.updateReasons).toEqual([
      { type: 'user_intent', intent: 'bar chart' },
    ]);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'engine.maelstrom.response',
        requestId: 'envelope-id-42',
        response: engineResponse,
      }),
    );
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('rejects malformed audio payloads instead of forwarding empty chunks', async () => {
    const sendEngineError = createSendEngineErrorMock();
    const voiceSession = createVoiceSessionStub('listening');
    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-audio'),
      voiceSession,
      engine: createEngineStub({
        process: mock(async () => createEngineResponse('')),
      }),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.audio_capture.audio_sent',
        data: 'bad-audio-shape',
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: 1,
      }),
    );

    expect(voiceSession.sendAudioChunk).not.toHaveBeenCalled();
    expect(sendEngineError).toHaveBeenCalledWith(
      'Unsupported audio payload shape',
    );
  });
});
