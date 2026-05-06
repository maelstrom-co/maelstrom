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

    // Match on call[0] (message) instead of `toHaveBeenCalledWith` so the
    // assertion stays robust to controller changes that pass `undefined`
    // as the optional second arg.
    expect(sendEngineError.mock.calls[0]?.[0]).toBe('warmup failed');
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
    // `getExplicitRequestId` is delete-on-read, so the only safe place to
    // observe the staged id is inside the mock — once processRequest returns
    // and the assertion phase begins, the entry is already consumed.
    let explicitIdDuringProcessing = null;
    const voiceSession = createVoiceSessionStub();
    // The runtime would call processIntent.process(request, signal) with the
    // exact same request reference; emulate that here so the adapter-side
    // lookup-by-reference is exercised.
    voiceSession.processRequest = mock(async (request) => {
      explicitIdDuringProcessing = controller.getExplicitRequestId(request);
      // Return a falsy-but-defined response so handleMaelstromProcess does NOT
      // treat this as the runtime-aborted path.
      return { userMessage: '' };
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

    const innerChartRequest = {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'show chart' }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [],
      vessels: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 1,
        request: {
          type: 'chart_request',
          sessionId: 'session-voice',
          id: 'req-1',
          timestamp: 1,
          request: innerChartRequest,
        },
      }),
    );

    // Assert call count before reading mock.calls[0] — guards against any
    // future regression that fires processRequest twice and would otherwise
    // silently last-write-wins on the captured explicit id.
    expect(voiceSession.processRequest).toHaveBeenCalledTimes(1);
    const [calledWithRequest, calledWithOptions] =
      voiceSession.processRequest.mock.calls[0] ?? [];
    const liveChartRequest = controller.getLatestChartRequest();
    expect(liveChartRequest).toEqual(innerChartRequest);
    expect(calledWithRequest).toBe(liveChartRequest);
    expect(calledWithOptions).toEqual({ speakResponse: true });
    expect(explicitIdDuringProcessing).toBe('req-1');
    // Reading is delete-on-read; a second lookup against the same reference
    // returns null so a stale id can't replay onto a later turn.
    expect(controller.getExplicitRequestId(liveChartRequest)).toBeNull();
    expect(engine.process).not.toHaveBeenCalled();
    expect(sendEngineError).not.toHaveBeenCalled();
    // processRequest returns undefined → no correlation response sent
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine.maelstrom.response' }),
    );
  });

  // The "voice session present + processRequest resolves with a response →
  // engine.maelstrom.response is emitted with the envelope id" path is owned
  // by `voice-intent-adapter` (see processIntent.process there), not by the
  // ws-session controller — the controller only stages the envelope id and
  // returns. The corresponding adapter test covers correlation end-to-end at
  // `voice-intent-adapter.test.js:processIntent uses the explicit request id`.

  test('unwraps ChartRequestMessage envelope and uses envelope id for engine correlation', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const engineResponse = {
      requestId: 'engine-resp-1',
      userMessage: 'done',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
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
        response: {
          ...engineResponse,
          type: 'maelstrom_response',
        },
      }),
    );
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('forwards speakResponse=false when no update reason carries user_intent', async () => {
    const voiceSession = createVoiceSessionStub();
    let observedOptions = null;
    voiceSession.processRequest = mock(async (_request, options) => {
      observedOptions = options;
      return { userMessage: '' };
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-resize',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: {
        sendMessage: mock(() => {}),
        sendEngineError: mock(() => {}),
      },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 1,
        request: {
          type: 'chart_request',
          sessionId: 'session-resize',
          id: 'req-resize',
          timestamp: 1,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [
                {
                  type: 'chart_resize',
                  previous: { columns: 12, rows: 8 },
                  current: { columns: 14, rows: 9 },
                },
              ],
              chartDimensions: { columns: 14, rows: 9 },
              layoutMode: 'tiling',
            },
            instances: [],
            vessels: [],
            layout: { type: 'tiling', tree: [], instances: [] },
          },
        },
      }),
    );

    expect(observedOptions).toEqual({ speakResponse: false });
  });

  test('emits a correlated engine.error when voiceSession.processRequest is aborted', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub();
    // Runtime returns undefined when an STT turn supersedes the explicit one.
    voiceSession.processRequest = mock(async () => undefined);

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-aborted',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 1,
        request: {
          type: 'chart_request',
          sessionId: 'session-aborted',
          id: 'req-aborted',
          timestamp: 1,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'hi' }],
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

    expect(sendEngineError).toHaveBeenCalledWith(
      'Request superseded before intent processing',
      'req-aborted',
    );
  });

  test('emits a correlated engine.error if voiceSession.processRequest itself throws', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async () => {
      throw new Error('voice runtime crashed');
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-throw',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 1,
        request: {
          type: 'chart_request',
          sessionId: 'session-throw',
          id: 'req-throw',
          timestamp: 1,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'hi' }],
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

    expect(sendEngineError).toHaveBeenCalledWith(
      'voice runtime crashed',
      'req-throw',
    );
  });

  test('keeps explicit ids identity-keyed across concurrent requests', async () => {
    let firstRequest = null;
    let secondRequest = null;
    let resolveFirst = null;
    let resolveSecond = null;

    const voiceSession = createVoiceSessionStub();
    voiceSession.processRequest = mock(async (request) => {
      if (firstRequest === null) {
        firstRequest = request;
        await new Promise((resolve) => {
          resolveFirst = resolve;
        });
      } else {
        secondRequest = request;
        await new Promise((resolve) => {
          resolveSecond = resolve;
        });
      }
      return { userMessage: '' };
    });

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-multi',
      voiceSession,
      engine: {
        process: mock(async () => ({ userMessage: '' })),
        addAssistantMessage: mock(async () => {}),
      },
      transport: {
        sendMessage: mock(() => {}),
        sendEngineError: mock(() => {}),
      },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    const buildEnvelopeJson = (id, intent) =>
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 1,
        request: {
          type: 'chart_request',
          sessionId: 'session-multi',
          id,
          timestamp: 1,
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
        },
      });

    // Poll on the deterministic signal we actually care about — that the
    // mock recorded the request — rather than guessing how many microtasks
    // separate `onMessage` from `processRequest`. Bun's mock list reflects
    // calls synchronously, so this loop needs only a single await once the
    // call has reached the mock.
    const waitFor = async (predicate) => {
      while (!predicate()) {
        await Promise.resolve();
      }
    };

    const firstDone = controller.onMessage(buildEnvelopeJson('req-A', 'first'));
    await waitFor(() => firstRequest !== null);
    const secondDone = controller.onMessage(
      buildEnvelopeJson('req-B', 'second'),
    );
    await waitFor(() => secondRequest !== null);

    // Both requests are mid-flight. Each id is only retrievable via the
    // matching ChartRequest reference — no clobbering, no cross-talk.
    expect(controller.getExplicitRequestId(firstRequest)).toBe('req-A');
    expect(controller.getExplicitRequestId(secondRequest)).toBe('req-B');

    // Delete-on-read: a second lookup against either reference returns null.
    expect(controller.getExplicitRequestId(firstRequest)).toBeNull();
    expect(controller.getExplicitRequestId(secondRequest)).toBeNull();

    resolveFirst();
    resolveSecond();
    await firstDone;
    await secondDone;
  });

  test('routes the no-voice-session engine path with envelope-correlated response', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const engineResponse = {
      requestId: 'req-direct',
      userMessage: 'ok',
      rationale: '',
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
    const engine = {
      process: mock(async () => engineResponse),
      addAssistantMessage: mock(async () => {}),
    };

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-direct',
      voiceSession: null,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 7,
        request: {
          type: 'chart_request',
          sessionId: 'session-direct',
          id: 'req-direct',
          timestamp: 7,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'hello' }],
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
    // Verify the adapter ran outside the mock body so a failed assertion
    // surfaces as a clean test failure rather than a generic engine error
    // that the controller's catch would swallow into sendEngineError.
    const legacyRequest = engine.process.mock.calls[0]?.[0];
    expect(legacyRequest?.id).toBe('req-direct');
    expect(legacyRequest?.context.sessionId).toBe('session-direct');
    expect(legacyRequest?.context.timestamp).toBe(7);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'engine.maelstrom.response',
      sessionId: 'session-direct',
      requestId: 'req-direct',
      response: {
        ...engineResponse,
        type: 'maelstrom_response',
      },
    });
    expect(sendEngineError).not.toHaveBeenCalled();
  });

  test('emits a correlated engine.error when the no-voice engine path throws', async () => {
    const sendMessage = mock(() => {});
    const sendEngineError = mock(() => {});
    const engine = {
      process: mock(async () => {
        throw new Error('LLM provider unavailable');
      }),
      addAssistantMessage: mock(async () => {}),
    };

    const controller = createDemoVoiceWsSessionController({
      sessionId: 'session-fail',
      voiceSession: null,
      engine,
      transport: { sendMessage, sendEngineError },
      forwardBinaryAudioInput: mock(async () => {}),
    });

    await controller.onMessage(
      JSON.stringify({
        type: 'client.maelstrom.process',
        timestamp: 1,
        request: {
          type: 'chart_request',
          sessionId: 'session-fail',
          id: 'req-fail',
          timestamp: 1,
          request: {
            type: 'chart_request',
            context: {
              updateReasons: [{ type: 'user_intent', intent: 'hi' }],
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

    expect(sendEngineError).toHaveBeenCalledWith(
      'LLM provider unavailable',
      'req-fail',
    );
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'engine.maelstrom.response' }),
    );
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
