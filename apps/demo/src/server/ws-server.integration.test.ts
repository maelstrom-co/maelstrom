import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { EngineOutput } from '@maelstrom-co/protocol';
import { MessageId, SessionId } from '@maelstrom-co/protocol';
import {
  createControllableMockEngine,
  createControllableMockVoiceSession,
  createTestServer,
  openTestWs,
  send,
  type TestServer,
  type TestWsClient,
  waitForBinaryFrame,
  waitForCondition,
  waitForMessage,
} from './__test-utils__/ws-integration-helpers.js';
import { AUDIO_FLAGS, type DemoWsAppDeps } from './ws-server.js';

interface TestContext {
  server: TestServer;
  client: TestWsClient;
}

const INTEGRATION_TIMEOUT_MS = 5000;

describe('ws-server integration', () => {
  describe('scenario 1: connect receives engine.stt.ready', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      const mockVoice = createControllableMockVoiceSession();
      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('receives engine.stt.ready after connecting', async () => {
      const msg = await waitForMessage(ctx.client.received, 'engine.stt.ready');
      expect(msg.type).toBe('engine.stt.ready');
    });
  });

  describe('scenario 2: full happy-path voice lifecycle', () => {
    let ctx: TestContext;
    let mockVoice: ReturnType<typeof createControllableMockVoiceSession>;
    let mockEngine: ReturnType<typeof createControllableMockEngine>;

    beforeEach(async () => {
      mockVoice = createControllableMockVoiceSession();
      mockEngine = createControllableMockEngine();

      const output: EngineOutput = {
        type: 'chart_response',
        sessionId: SessionId('test-session'),
        id: MessageId('resp-1'),
        response: {
          type: 'maelstrom_response',
          requestId: MessageId('resp-1'),
          userMessage: 'Showing weather',
          rationale: '',
          executionPlan: [],
          layout: { type: 'tiling', tree: [], instances: [] },
        },
      };
      mockEngine.setNextResult({ ok: true, value: output });

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => mockEngine.engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('audio -> transcript -> engine -> tts -> idle', async () => {
      await waitForMessage(ctx.client.received, 'engine.stt.ready');
      const voice = mockVoice.getBound();

      send(ctx.client.ws, {
        type: 'client.audio_capture.ready',
        sessionId: 'test-session',
        timestamp: 0,
      });

      send(ctx.client.ws, {
        type: 'client.vad.speech_start',
        sessionId: 'test-session',
        timestamp: 0,
      });

      for (let i = 0; i < 3; i++) {
        ctx.client.ws.send(new Uint8Array([1, 2, 3, 4]).buffer);
      }

      await waitForCondition(
        () => mockVoice.calls.sendAudioChunk.mock.calls.length === 3,
        INTEGRATION_TIMEOUT_MS,
      );

      expect(mockVoice.calls.sendAudioChunk).toHaveBeenCalledTimes(3);
      const forwardedAudio = mockVoice.calls.sendAudioChunk.mock.calls[0]?.[0];
      expect(forwardedAudio).toBeDefined();
      if (!forwardedAudio) {
        throw new Error('Expected forwarded audio chunk');
      }
      expect(Array.from(forwardedAudio.data)).toEqual([1, 2, 3, 4]);
      expect(forwardedAudio.sampleRate).toBe(16000);
      expect(forwardedAudio.encoding).toBe('linear16');

      voice.triggerTranscript({ text: 'show', isFinal: false });
      await waitForMessage(ctx.client.received, 'engine.stt.transcript');

      voice.triggerTranscript({ text: 'show weather', isFinal: true });

      send(ctx.client.ws, {
        type: 'client.vad.speech_end',
        sessionId: 'test-session',
        timestamp: 0,
      });

      await voice.triggerIntent({ text: 'show weather', isFinal: true });

      const responseMsg = await waitForMessage(
        ctx.client.received,
        'engine.maelstrom.response',
      );
      expect(responseMsg.type).toBe('engine.maelstrom.response');

      expect(mockEngine.calls.length).toBeGreaterThan(0);
      const [engineCall] = mockEngine.calls;
      if (!engineCall) {
        throw new Error('mock engine recorded no calls');
      }
      expect(engineCall.message.type).toBe('chart_request');
      if (engineCall.message.type === 'chart_request') {
        const reasons = engineCall.message.request.context.updateReasons;
        const intentReason = reasons.find(
          (
            r,
          ): r is Extract<(typeof reasons)[number], { type: 'user_intent' }> =>
            r.type === 'user_intent',
        );
        expect(intentReason).toBeDefined();
        expect(intentReason?.intent).toBe('show weather');
      }

      voice.triggerSpeechStarted({
        text: 'Showing weather',
        format: 'pcm_f32le',
        sampleRate: 16000,
        queued: false,
      });
      await waitForMessage(ctx.client.received, 'engine.tts.sent');

      voice.triggerAudioOutput({
        data: new Uint8Array([10, 20, 30]),
        format: 'pcm_f32le',
        sampleRate: 16000,
        isFinal: false,
      });
      const binaryFrame = await waitForBinaryFrame(ctx.client.receivedBinary);
      expect(binaryFrame).toHaveLength(4);
      expect(binaryFrame[0]).toBe(AUDIO_FLAGS.CANCELLABLE);
      expect(Array.from(binaryFrame.slice(1))).toEqual([10, 20, 30]);

      voice.triggerVoiceStateChange('idle');
      const stateMsg = await waitForMessage(
        ctx.client.received,
        'engine.voice.state',
        (m) => m.type === 'engine.voice.state' && m.state === 'idle',
      );
      expect(stateMsg.type).toBe('engine.voice.state');
      if (stateMsg.type === 'engine.voice.state') {
        expect(stateMsg.state).toBe('idle');
      }
    });

    test('paragraph speak forwards queued metadata for chained turns over the websocket boundary', async () => {
      await waitForMessage(ctx.client.received, 'engine.stt.ready');
      const voice = mockVoice.getBound();

      send(ctx.client.ws, {
        type: 'client.voice.speak',
        text: 'First sentence. Second sentence. Third sentence.',
      });

      await waitForCondition(
        () => mockVoice.calls.enqueueSpeak.mock.calls.length === 3,
        INTEGRATION_TIMEOUT_MS,
      );

      expect(mockVoice.calls.enqueueSpeak).toHaveBeenNthCalledWith(
        1,
        'First sentence',
      );
      expect(mockVoice.calls.enqueueSpeak).toHaveBeenNthCalledWith(
        2,
        'Second sentence',
      );
      expect(mockVoice.calls.enqueueSpeak).toHaveBeenNthCalledWith(
        3,
        'Third sentence',
      );

      const firstTurnCount = ctx.client.received.length;
      voice.triggerSpeechStarted({
        text: 'First sentence',
        format: 'pcm_f32le',
        sampleRate: 16000,
        queued: false,
      });
      await waitForCondition(
        () => ctx.client.received.length > firstTurnCount,
        INTEGRATION_TIMEOUT_MS,
      );
      const firstTurn = ctx.client.received.at(-1);
      expect(firstTurn?.type).toBe('engine.tts.sent');
      if (firstTurn?.type !== 'engine.tts.sent') {
        throw new Error('Expected first queued-turn message');
      }

      const secondTurnCount = ctx.client.received.length;
      voice.triggerSpeechStarted({
        text: 'Second sentence',
        format: 'pcm_f32le',
        sampleRate: 16000,
        queued: true,
      });
      await waitForCondition(
        () => ctx.client.received.length > secondTurnCount,
        INTEGRATION_TIMEOUT_MS,
      );
      const secondTurn = ctx.client.received.at(-1);
      expect(secondTurn?.type).toBe('engine.tts.sent');
      if (secondTurn?.type !== 'engine.tts.sent') {
        throw new Error('Expected second queued-turn message');
      }

      const thirdTurnCount = ctx.client.received.length;
      voice.triggerSpeechStarted({
        text: 'Third sentence',
        format: 'pcm_f32le',
        sampleRate: 16000,
        queued: true,
      });
      await waitForCondition(
        () => ctx.client.received.length > thirdTurnCount,
        INTEGRATION_TIMEOUT_MS,
      );
      const thirdTurn = ctx.client.received.at(-1);
      expect(thirdTurn?.type).toBe('engine.tts.sent');
      if (thirdTurn?.type !== 'engine.tts.sent') {
        throw new Error('Expected third queued-turn message');
      }

      expect(firstTurn.text).toBe('First sentence');
      expect(firstTurn.queued).toBe(false);
      expect(secondTurn.text).toBe('Second sentence');
      expect(secondTurn.queued).toBe(true);
      expect(thirdTurn.text).toBe('Third sentence');
      expect(thirdTurn.queued).toBe(true);
    });
  });

  describe('scenario 3: onClose destroys voice session', () => {
    let server: TestServer;
    let mockVoice: ReturnType<typeof createControllableMockVoiceSession>;

    beforeEach(async () => {
      mockVoice = createControllableMockVoiceSession();
      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => engine,
      };

      server = createTestServer(deps);
    });

    afterEach(() => {
      server.server.stop();
    });

    test('destroy is called on voice session when WebSocket closes', async () => {
      const client = await openTestWs(server.port, 'test-session');
      await waitForMessage(client.received, 'engine.stt.ready');

      await client.close();

      await waitForCondition(
        () => mockVoice.calls.destroy.mock.calls.length === 1,
        INTEGRATION_TIMEOUT_MS,
      );

      expect(mockVoice.calls.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('scenario 4: warmup failure sends engine.error', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      const mockVoice = createControllableMockVoiceSession();
      mockVoice.failWarmupWith(
        new Error('Warmup failed: provider unavailable'),
      );

      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('receives engine.error when warmup fails, not engine.stt.ready', async () => {
      const errorMsg = await waitForMessage(
        ctx.client.received,
        'engine.error',
      );
      expect(errorMsg.type).toBe('engine.error');
      expect(errorMsg.error).toContain('Warmup failed');

      const readyMsg = ctx.client.received.find(
        (m) => m.type === 'engine.stt.ready',
      );
      expect(readyMsg).toBeUndefined();
    });
  });

  describe('scenario 5: missing provider keys sends engine.error', () => {
    let ctx: TestContext;

    beforeEach(async () => {
      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => null,
        engineFactory: () => engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('receives engine.error immediately when provider keys are missing', async () => {
      const errorMsg = await waitForMessage(
        ctx.client.received,
        'engine.error',
      );
      expect(errorMsg.type).toBe('engine.error');
      expect(errorMsg.error).toContain('Voice disabled');
      expect(errorMsg.error).toContain('DEEPGRAM_API_KEY');
    });
  });

  describe('scenario 6: barge-in calls interrupt on voice session', () => {
    let ctx: TestContext;
    let mockVoice: ReturnType<typeof createControllableMockVoiceSession>;

    beforeEach(async () => {
      mockVoice = createControllableMockVoiceSession();
      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('interrupt() called when client.vad.speech_start arrives while session is speaking', async () => {
      await waitForMessage(ctx.client.received, 'engine.stt.ready');
      const voice = mockVoice.getBound();

      voice.setVoiceState('speaking');

      send(ctx.client.ws, {
        type: 'client.vad.speech_start',
        sessionId: 'test-session',
        timestamp: 0,
      });

      await waitForCondition(
        () => mockVoice.calls.interrupt.mock.calls.length === 1,
        INTEGRATION_TIMEOUT_MS,
      );

      expect(mockVoice.calls.interrupt).toHaveBeenCalledTimes(1);
    });
  });

  describe('scenario 7: client.audio_capture.closed calls stopListening', () => {
    let ctx: TestContext;
    let mockVoice: ReturnType<typeof createControllableMockVoiceSession>;

    beforeEach(async () => {
      mockVoice = createControllableMockVoiceSession();
      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('stopListening() called when client.audio_capture.closed is received while listening', async () => {
      await waitForMessage(ctx.client.received, 'engine.stt.ready');
      const voice = mockVoice.getBound();

      voice.setVoiceState('listening');

      send(ctx.client.ws, {
        type: 'client.audio_capture.closed',
        sessionId: 'test-session',
        timestamp: 0,
      });

      await waitForCondition(
        () => mockVoice.calls.stopListening.mock.calls.length === 1,
        INTEGRATION_TIMEOUT_MS,
      );

      expect(mockVoice.calls.stopListening).toHaveBeenCalledTimes(1);
    });
  });

  describe('scenario 8: STT transport error emits engine.error with provider metadata', () => {
    let ctx: TestContext;
    let mockVoice: ReturnType<typeof createControllableMockVoiceSession>;

    beforeEach(async () => {
      mockVoice = createControllableMockVoiceSession();
      const { engine } = createControllableMockEngine();

      const deps: DemoWsAppDeps = {
        getVoiceProviderKeys: () => ({
          deepgramApiKey: 'test',
          cartesiaApiKey: 'test',
        }),
        voiceSessionFactory: mockVoice.voiceSessionFactory,
        engineFactory: () => engine,
      };

      const server = createTestServer(deps);
      const client = await openTestWs(server.port, 'test-session');
      ctx = { server, client };
    });

    afterEach(async () => {
      await ctx.client.close();
      ctx.server.server.stop();
    });

    test('engine.error frame carries kind/source/provider when STT transport error fires', async () => {
      await waitForMessage(ctx.client.received, 'engine.stt.ready');
      const voice = mockVoice.getBound();

      // Build a classified STT transport error matching VoiceProviderErrorBase shape.
      const sttError = Object.assign(new Error('STT connection lost'), {
        source: 'stt' as const,
        kind: 'transport' as const,
        provider: 'deepgram',
      });

      voice.triggerError(sttError);

      const errorMsg = await waitForMessage(
        ctx.client.received,
        'engine.error',
      );
      expect(errorMsg.type).toBe('engine.error');
      if (errorMsg.type === 'engine.error') {
        expect(errorMsg.kind).toBe('transport');
        expect(errorMsg.source).toBe('stt');
        expect(errorMsg.provider).toBe('deepgram');
      }
    });
  });
});
