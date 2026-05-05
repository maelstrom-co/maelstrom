import { describe, expect, mock, test } from 'bun:test';

import { createDemoVoiceWsSessionController } from './voice-ws-session.js';

function createVoiceSessionStub(initialState = 'idle', overrides = {}) {
  let state = initialState;

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
    handleVADEvent: mock(() => {}),
    sendAudioChunk: mock(() => {}),
    speak: mock(async () => {}),
    destroy: mock(() => {
      state = 'idle';
    }),
    ...overrides,
  };
}

describe('createDemoVoiceWsSessionController', () => {
  test('covers open, audio capture lifecycle, and speak flow', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const forwardBinaryAudioInput = mock(async () => {});
    const voiceSession = createVoiceSessionStub();
    const engine = {
      process: mock(async () => ({ userMessage: 'hello back' })),
      addAssistantMessage: mock(async () => {}),
    };

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-123',
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
    const forwardedAudio = voiceSession.sendAudioChunk.mock.calls[0]?.[0];
    expect(forwardedAudio).toBeDefined();
    expect(Array.from(forwardedAudio.data)).toEqual([1, 2, 3]);
    expect(forwardedAudio.sampleRate).toBe(16000);
    expect(forwardedAudio.encoding).toBe('linear16');
    expect(voiceSession.stopListening).toHaveBeenCalledTimes(1);
    expect(voiceSession.speak).toHaveBeenCalledWith('hello world');
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('does not announce ready when warmup fails and surfaces the error to the client', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub('idle', {
      warmup: mock(async () => {
        throw new Error('warmup failed');
      }),
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-123',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
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
    const sendEngineError = mock(() => {});
    const forwardBinaryAudioInput = mock(async () => {});

    const startController = createDemoVoiceWsSessionController({
      sessionId: 'session-start',
      voiceSession: createVoiceSessionStub('idle', {
        startListening: mock(async () => {
          throw new Error('start failed');
        }),
      }),
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await startController.onMessage(
      JSON.stringify({ type: 'client.audio_capture.ready' }),
    );
    await Promise.resolve();

    const stopController = createDemoVoiceWsSessionController({
      sessionId: 'session-stop',
      voiceSession: createVoiceSessionStub('listening', {
        stopListening: mock(async () => {
          throw new Error('stop failed');
        }),
      }),
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await stopController.onMessage(
      JSON.stringify({ type: 'client.audio_capture.closed' }),
    );
    await Promise.resolve();

    const speakController = createDemoVoiceWsSessionController({
      sessionId: 'session-speak',
      voiceSession: createVoiceSessionStub('idle', {
        speak: mock(async () => {
          throw new Error('speak failed');
        }),
      }),
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await speakController.onMessage(
      JSON.stringify({ type: 'client.voice.speak', text: 'hello world' }),
    );

    const historyController = createDemoVoiceWsSessionController({
      sessionId: 'session-history',
      voiceSession: createVoiceSessionStub(),
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {
          throw new Error('history failed');
        }),
      },
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

  test('routes client.maelstrom.process through voiceSession when voice is enabled', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    let mirroredRequestDuringProcessing = null;
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => {
      mirroredRequestDuringProcessing = controller.getLatestChartRequest();
    });
    const engine = {
      process: mock(async () => ({ userMessage: 'should not be used' })),
      addAssistantMessage: mock(async () => {}),
    };

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-voice',
      voiceSession,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: {
          type: 'chart_request',
          id: 'envelope-req-1',
          sessionId: 'session-voice',
          timestamp: 1000,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'show chart' }],
              chartDimensions: { columns: 12, rows: 8 },
              layoutMode: 'tiling',
            },
            instances: [],
            vessels: [],
            layout: { type: 'tiling', tree: [], instances: [] },
          },
        },
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
    expect(mirroredRequestDuringProcessing).toBe(mirroredRequest);
    expect(voiceSession.processRequest.mock.calls[0]?.[0]).toBe(
      mirroredRequest,
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
    const sendEngineError = mock(() => {});
    const voiceResponse = {
      type: 'maelstrom_response',
      requestId: 'voice-generated-uuid',
      userMessage: 'chart updated',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => voiceResponse);

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-voice-corr',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: 'should not be used' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: {
          type: 'chart_request',
          id: 'envelope-corr-id',
          sessionId: 'session-voice-corr',
          timestamp: 3000,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'pie chart' }],
              chartDimensions: { columns: 12, rows: 8 },
              layoutMode: 'tiling',
            },
            instances: [],
            vessels: [],
            layout: { type: 'tiling', tree: [], instances: [] },
          },
        },
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
    const sendEngineError = mock(() => {});
    const engineResponse = { requestId: 'engine-resp-1', userMessage: 'done', rationale: '', executionPlan: [], layout: { type: 'tiling', tree: [], instances: [] } };
    const engine = {
      process: mock(async () => engineResponse),
      addAssistantMessage: mock(async () => {}),
    };

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-engine',
      voiceSession: null,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: {
          type: 'chart_request',
          id: 'envelope-id-42',
          sessionId: 'session-engine',
          timestamp: 2000,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'bar chart' }],
              chartDimensions: { columns: 12, rows: 8 },
              layoutMode: 'tiling',
            },
            instances: [],
            vessels: [],
            layout: { type: 'tiling', tree: [], instances: [] },
          },
        },
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
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub('listening');
    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-audio',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
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
