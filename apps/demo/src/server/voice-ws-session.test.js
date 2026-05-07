import { describe, expect, mock, test } from 'bun:test';

import { MessageId, SessionId } from '@maelstrom-co/protocol';

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
    processRequest: mock(async () => ({})),
    handleVADEvent: mock(() => {}),
    sendAudioChunk: mock(() => {}),
    speak: mock(async () => {}),
    destroy: mock(() => {
      state = 'idle';
    }),
    ...overrides,
  };
}

function createEngineStub(overrides = {}) {
  return {
    handle: mock(async (envelope) => {
      if (envelope.type === 'chart_request') {
        return {
          ok: true,
          value: {
            type: 'chart_response',
            sessionId: envelope.sessionId,
            id: envelope.id,
            response: {
              type: 'maelstrom_response',
              requestId: envelope.id,
              userMessage: '',
              rationale: '',
              executionPlan: [],
              layout: { type: 'tiling', tree: [], instances: [] },
            },
          },
        };
      }
      return {
        ok: true,
        value: {
          type: 'assistant_message_result',
          sessionId: envelope.sessionId,
          id: envelope.id,
          outcome: 'inserted',
        },
      };
    }),
    ...overrides,
  };
}

const validProcessMessage = {
  type: 'client.maelstrom.process',
  request: {
    type: 'chart_request',
    sessionId: 'session-voice',
    id: 'msg-explicit-1',
    timestamp: 1,
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
};

describe('createDemoVoiceWsSessionController', () => {
  test('covers open, audio capture lifecycle, and speak flow', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const forwardBinaryAudioInput = mock(async () => {});
    const voiceSession = createVoiceSessionStub();

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-123'),
      voiceSession,
      engine: createEngineStub(),
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
        sessionId: SessionId('session-123'),
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
      sessionId: SessionId('session-123'),
      voiceSession,
      engine: createEngineStub(),
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onOpen();

    expect(sendEngineError).toHaveBeenCalledWith('warmup failed', undefined);
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine.stt.ready' }),
    );
  });

  test('surfaces start, stop, speak, and assistant-history failures to the client', async () => {
    const sendEngineError = mock(() => {});
    const forwardBinaryAudioInput = mock(async () => {});

    const startController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-start'),
      voiceSession: createVoiceSessionStub('idle', {
        startListening: mock(async () => {
          throw new Error('start failed');
        }),
      }),
      engine: createEngineStub(),
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
      engine: createEngineStub(),
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
        speak: mock(async () => {
          throw new Error('speak failed');
        }),
      }),
      engine: createEngineStub(),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput,
    });

    await speakController.onMessage(
      JSON.stringify({ type: 'client.voice.speak', text: 'hello world' }),
    );

    const historyController = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-history'),
      voiceSession: createVoiceSessionStub(),
      engine: {
        handle: mock(async () => ({
          ok: false,
          error: { type: 'history', message: 'history failed' },
        })),
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

  test('routes client.maelstrom.process through voiceSession when voice is enabled and stages an explicit request id', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub();
    const engine = createEngineStub();

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-voice'),
      voiceSession,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(JSON.stringify(validProcessMessage));

    expect(voiceSession.processRequest).toHaveBeenCalledTimes(1);
    const [stagedRequest, processOptions] =
      voiceSession.processRequest.mock.calls[0];
    expect(processOptions).toEqual({ speakResponse: true });
    expect(controller.getExplicitRequestId(stagedRequest)).toBe(
      MessageId('msg-explicit-1'),
    );
    // Single-shot read: a buggy double-read returns null.
    expect(controller.getExplicitRequestId(stagedRequest)).toBeNull();
    expect(engine.handle).not.toHaveBeenCalled();
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('emits a correlated engine.error when voiceSession.processRequest is superseded (resolves undefined)', async () => {
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => undefined);

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-superseded'),
      voiceSession,
      engine: createEngineStub(),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(JSON.stringify(validProcessMessage));

    expect(sendEngineError).toHaveBeenCalledWith(
      'Request superseded before intent processing',
      MessageId('msg-explicit-1'),
    );
  });

  test('emits a correlated engine.error when voiceSession.processRequest throws (defensive fallback)', async () => {
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => {
      throw new Error('processRequest kaboom');
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-throw'),
      voiceSession,
      engine: createEngineStub(),
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(JSON.stringify(validProcessMessage));

    expect(sendEngineError).toHaveBeenCalledWith(
      'processRequest kaboom',
      MessageId('msg-explicit-1'),
    );
  });

  test('routes client.maelstrom.process with non-user-intent reasons through voiceSession with speakResponse: false', async () => {
    const voiceSession = createVoiceSessionStub();
    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-mutation'),
      voiceSession,
      engine: createEngineStub(),
      transport: { sendMessage: mock(() => {}), sendEngineError: mock(() => {}) },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: {
          ...validProcessMessage.request,
          request: {
            ...validProcessMessage.request.request,
            context: {
              ...validProcessMessage.request.request.context,
              updateReasons: [
                {
                  type: 'chart_resize',
                  previous: { rows: 8, columns: 12 },
                  current: { rows: 8, columns: 16 },
                },
              ],
            },
          },
        },
      }),
    );

    expect(voiceSession.processRequest).toHaveBeenCalledTimes(1);
    const [, processOptions] = voiceSession.processRequest.mock.calls[0];
    expect(processOptions).toEqual({ speakResponse: false });
  });

  test('routes client.maelstrom.process through engine.handle when voice is disabled', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const engine = createEngineStub();

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-text'),
      voiceSession: null,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(JSON.stringify(validProcessMessage));

    expect(engine.handle).toHaveBeenCalledTimes(1);
    const envelope = engine.handle.mock.calls[0]?.[0];
    expect(envelope.type).toBe('chart_request');
    expect(envelope.sessionId).toBe('session-voice');
    expect(envelope.id).toBe('msg-explicit-1');
    // Reattached layout discriminator survives safeParse strip.
    expect(envelope.request.layout.type).toBe('tiling');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'engine.maelstrom.response',
      sessionId: SessionId('session-text'),
      requestId: MessageId('msg-explicit-1'),
      response: expect.objectContaining({
        type: 'maelstrom_response',
        requestId: MessageId('msg-explicit-1'),
      }),
    });
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('rejects malformed chart_request envelopes via wire-ingress validation', async () => {
    const sendEngineError = mock(() => {});
    const engine = createEngineStub();

    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-bad'),
      voiceSession: null,
      engine,
      transport: { sendMessage: mock(() => {}), sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        request: { type: 'chart_request', request: { malformed: true } },
      }),
    );

    expect(engine.handle).not.toHaveBeenCalled();
    expect(sendEngineError).toHaveBeenCalledTimes(1);
  });

  test('passes the assistant message id through as an AssistantInjectionMessage', async () => {
    const engine = createEngineStub();
    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-history'),
      voiceSession: createVoiceSessionStub(),
      engine,
      transport: {
        sendMessage: mock(() => {}),
        sendEngineError: mock(() => {}),
      },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.history.add_assistant_message',
        id: 'msg-42',
        message: 'assistant says hi',
      }),
    );

    expect(engine.handle).toHaveBeenCalledTimes(1);
    const envelope = engine.handle.mock.calls[0]?.[0];
    expect(envelope.type).toBe('assistant_message');
    expect(envelope.id).toBe(MessageId('msg-42'));
    expect(envelope.content).toBe('assistant says hi');
  });

  test('rejects malformed audio payloads instead of forwarding empty chunks', async () => {
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub('listening');
    const controller = createDemoVoiceWsSessionController({
      sessionId: SessionId('session-audio'),
      voiceSession,
      engine: createEngineStub(),
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
