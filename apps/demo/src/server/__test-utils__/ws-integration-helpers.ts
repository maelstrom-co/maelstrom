/**
 * WebSocket integration test helpers for the demo `/ws` server.
 *
 * Provides controllable mocks and real server/client utilities that let
 * integration tests exercise the full socket boundary without real STT/TTS
 * providers or a real LLM.
 */

import { mock } from 'bun:test';
import {
  cancellationError,
  type Engine,
  type EngineError,
} from '@maelstrom-co/engine';
import type {
  EngineMessage,
  EngineOutput,
  Result,
  SessionHistoryEntry,
  SessionId,
  VoiceServerMessage,
} from '@maelstrom-co/protocol';
import type {
  AudioChunk,
  SpeechChunk,
  SttCircuitStatus,
  TranscriptionResult,
  VADEvent,
  VoiceSession,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionCallbacks,
  VoiceSessionConfig,
  VoiceSessionError,
  VoiceSessionState,
} from '@maelstrom-co/voice-server';
import { createDemoWsApp, type DemoWsAppDeps } from '../ws-server.js';

type MockCallTracker<TArgs extends unknown[] = unknown[]> = {
  mock: { calls: TArgs[] };
};

// ---------------------------------------------------------------------------
// Mock voice session
// ---------------------------------------------------------------------------

/**
 * Returned by {@link createControllableMockVoiceSession}.
 *
 * Holds both the `VoiceSession` stub (to hand to `voiceSessionFactory`) and
 * trigger methods that let tests drive callbacks as if the voice runtime fired
 * them from inside a real provider.
 */
export interface ControllableMockVoiceSession {
  /** The `VoiceSession` stub to return from `voiceSessionFactory`. */
  session: VoiceSession;
  voiceSessionFactory(
    config: VoiceSessionConfig,
    callbacks: VoiceSessionCallbacks,
  ): VoiceSession;
  /**
   * Typed accessors for mocked session methods.
   * Use these in assertions instead of casting the session properties.
   */
  calls: {
    destroy: VoiceSession['destroy'] & MockCallTracker<[]>;
    enqueueSpeak: VoiceSession['enqueueSpeak'] &
      MockCallTracker<[string, (string | undefined)?]>;
    interrupt: VoiceSession['interrupt'] & MockCallTracker<[]>;
    sendAudioChunk: VoiceSession['sendAudioChunk'] &
      MockCallTracker<[AudioChunk]>;
    stopListening: VoiceSession['stopListening'] & MockCallTracker<[]>;
  };
  getBound(): BoundControllableMockVoiceSession;
  /**
   * Override `session.warmup` to throw the given error on the next call.
   * Use this in warmup-failure scenarios instead of a full inline stub.
   */
  failWarmupWith(error: Error): void;
}

export interface BoundControllableMockVoiceSession {
  setVoiceState(state: VoiceSessionState): void;
  triggerTranscript(result: TranscriptionResult): void;
  triggerVoiceStateChange(state: VoiceSessionState): void;
  triggerAudioOutput(chunk: SpeechChunk): void;
  triggerSpeechStarted(
    speech: Parameters<
      NonNullable<VoiceSessionCallbacks['onSpeechStarted']>
    >[0],
  ): void;
  triggerError(error: VoiceSessionError): void;
  triggerIntent(
    result: TranscriptionResult,
    signal?: AbortSignal,
  ): Promise<void>;
}

const KNOWN_VOICE_SERVER_MESSAGE_TYPES = {
  'client.audio_playback.started': true,
  'client.audio_playback.stopped': true,
  'engine.error': true,
  'engine.maelstrom.response': true,
  'engine.stt.ready': true,
  'engine.stt.transcript': true,
  'engine.tts.sent': true,
  'engine.voice.state': true,
} as const satisfies Record<VoiceServerMessage['type'], true>;

function isKnownVoiceServerMessage(
  value: unknown,
): value is VoiceServerMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  return (
    typeof value.type === 'string' &&
    value.type in KNOWN_VOICE_SERVER_MESSAGE_TYPES
  );
}

export function createControllableMockVoiceSession(): ControllableMockVoiceSession {
  let bound: BoundControllableMockVoiceSession | null = null;
  let currentState: VoiceSessionState = 'idle';
  let warmupImpl: () => Promise<void> = async () => {};
  const destroyFn = mock(() => {});
  const interruptFn = mock(() => {});
  const enqueueSpeakFn = mock((_text: string, _voice?: string) => {});
  const sendAudioChunkFn = mock((_: AudioChunk) => {});
  const stopListeningFn = mock(async () => {});

  const session: VoiceSession = {
    getVoiceState: mock(() => currentState),
    getSttCircuitStatus: mock((): SttCircuitStatus => 'closed'),
    warmup: mock(async () => warmupImpl()),
    startListening: mock(async () => {}),
    stopListening: stopListeningFn,
    interrupt: interruptFn,
    processRequest: mock(async () => undefined),
    onVoiceStateChange: mock(() => () => {}),
    onSttCircuitStatusChange: mock(() => () => {}),
    onTranscript: mock(() => () => {}),
    onVADEvent: mock(() => () => {}),
    onAudioOutput: mock(() => () => {}),
    onAudioDropped: mock<
      (callback: (event: VoiceSessionAudioDroppedEvent) => void) => () => void
    >(() => () => {}),
    shouldAutoRestart: mock(() => false),
    sendAudioChunk: sendAudioChunkFn,
    speak: mock(async () => {}),
    enqueueSpeak: enqueueSpeakFn,
    handleVADEvent: mock((_: VADEvent) => {}),
    destroy: destroyFn,
  };

  return {
    session,
    voiceSessionFactory(config, callbacks) {
      bound = {
        setVoiceState(state) {
          currentState = state;
        },
        triggerTranscript(result) {
          callbacks.onTranscript?.(result);
        },
        triggerVoiceStateChange(state) {
          callbacks.onVoiceStateChange?.(state);
        },
        triggerAudioOutput(chunk) {
          callbacks.onAudioOutput?.(chunk);
        },
        triggerSpeechStarted(speech) {
          callbacks.onSpeechStarted?.(speech);
        },
        triggerError(error) {
          callbacks.onError?.(error);
        },
        async triggerIntent(result, signal) {
          if (!config.buildChartRequest || !config.processIntent) {
            throw new Error('Intent boundary not configured on stored config');
          }
          const chartRequest = await config.buildChartRequest({
            transcript: result.text,
            sessionId: config.sessionId,
          });
          await config.processIntent.process(chartRequest, signal);
        },
      };

      return session;
    },
    calls: {
      destroy: destroyFn,
      enqueueSpeak: enqueueSpeakFn,
      interrupt: interruptFn,
      sendAudioChunk: sendAudioChunkFn,
      stopListening: stopListeningFn,
    },
    getBound() {
      if (!bound) {
        throw new Error(
          'Voice session not bound yet — create the websocket connection first',
        );
      }

      return bound;
    },
    failWarmupWith(error) {
      warmupImpl = async () => {
        throw error;
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------

/**
 * Returned by {@link createControllableMockEngine}.
 */
export interface ControllableMockEngine {
  /** The `Engine` stub to pass to `engineFactory`. */
  engine: Engine;
  /** All `handle()` invocations recorded in order with their optional abort signal. */
  calls: Array<{ message: EngineMessage; signal?: AbortSignal }>;
  /**
   * Set the result that the next `handle()` call will return.
   *
   * Defaults to a failed result with a `cancellation` error.
   * Replace with a success result before triggering any flow that
   * exercises the engine pipeline.
   */
  setNextResult(result: Result<EngineOutput, EngineError>): void;
}

/**
 * Build a controllable `Engine` stub.
 *
 * Records every `handle()` call in `calls` (including the optional abort
 * signal) and resolves with the value last set via `setNextResult`.
 * The `getHistory` method always returns an empty success result.
 *
 * @example
 * ```ts
 * const { engine, calls, setNextResult } = createControllableMockEngine();
 * setNextResult({ ok: true, value: { type: 'chart_response', ... } });
 * ```
 */
export function createControllableMockEngine(): ControllableMockEngine {
  const calls: Array<{ message: EngineMessage; signal?: AbortSignal }> = [];
  let nextResult: Result<EngineOutput, EngineError> = {
    ok: false,
    error: cancellationError('mock engine — no result configured', undefined),
  };

  const engine: Engine = {
    handle: async (message: EngineMessage, signal?: AbortSignal) => {
      calls.push({ message, signal });
      return nextResult;
    },
    getHistory: async (
      _sessionId: SessionId,
    ): Promise<Result<readonly SessionHistoryEntry[], EngineError>> => ({
      ok: true,
      value: [],
    }),
  };

  return {
    engine,
    calls,
    setNextResult(result) {
      nextResult = result;
    },
  };
}

// ---------------------------------------------------------------------------
// Test server
// ---------------------------------------------------------------------------

/** Minimal shape of a Bun server instance used by integration tests. */
interface BunServerLike {
  port: number;
  stop(): void;
}

/**
 * Represents a started test server.
 */
export interface TestServer {
  /** The underlying Bun server instance. */
  server: BunServerLike;
  /** The OS-assigned port the server is listening on. */
  port: number;
}

/**
 * Start a real Bun WebSocket server on an OS-assigned port.
 *
 * Calls `createDemoWsApp(deps)` then `Bun.serve` with `port: 0` so the OS
 * chooses a free port.  Always call `server.stop()` in `afterEach` to avoid
 * port leaks.
 *
 * @param deps - Optional dependency overrides forwarded to `createDemoWsApp`.
 * @returns `{ server, port }` where `port` is the actual bound port.
 *
 * @example
 * ```ts
 * const { server, port } = createTestServer(deps);
 * afterEach(() => server.stop());
 * ```
 */
export function createTestServer(deps?: DemoWsAppDeps): TestServer {
  const { app, websocket } = createDemoWsApp(deps);
  const server = Bun.serve({ fetch: app.fetch, websocket, port: 0 });
  const port = server.port;

  if (port === undefined) {
    throw new Error('Bun.serve did not expose a bound port');
  }

  return {
    server: { port, stop: () => server.stop() },
    port,
  };
}

// ---------------------------------------------------------------------------
// Test WebSocket client
// ---------------------------------------------------------------------------

/**
 * Represents an open WebSocket test client.
 */
export interface TestWsClient {
  /** The underlying WebSocket instance. */
  ws: WebSocket;
  /** Ordered list of JSON messages received from the server. */
  received: VoiceServerMessage[];
  /** Ordered list of binary frames received from the server. */
  receivedBinary: Uint8Array[];
  /** Close the connection and resolve once it is fully closed. */
  close(): Promise<void>;
}

function isVoiceServerMessageOfType<TType extends VoiceServerMessage['type']>(
  message: VoiceServerMessage,
  type: TType,
): message is Extract<VoiceServerMessage, { type: TType }> {
  return message.type === type;
}

/**
 * Open a real WebSocket client connected to `ws://localhost:<port>/ws`.
 *
 * Resolves only after the `open` event fires.  All incoming JSON messages are
 * pushed to `received`; binary frames to `receivedBinary`.
 *
 * @param port - Port returned by {@link createTestServer}.
 * @param sessionId - Optional session-id query parameter (defaults to `'test-session'`).
 *
 * @example
 * ```ts
 * const client = await openTestWs(port, 'my-session');
 * await waitForMessage(client.received, 'engine.voice.state');
 * ```
 */
export async function openTestWs(
  port: number,
  sessionId = 'test-session',
): Promise<TestWsClient> {
  const ws = new WebSocket(`ws://localhost:${port}/ws?sessionId=${sessionId}`);
  const received: VoiceServerMessage[] = [];
  const receivedBinary: Uint8Array[] = [];

  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      receivedBinary.push(new Uint8Array(event.data));
    } else {
      if (typeof event.data !== 'string') {
        throw new Error(`[test ws] non-text frame: ${String(event.data)}`);
      }
      const parsed = JSON.parse(event.data) as unknown;
      if (!isKnownVoiceServerMessage(parsed)) {
        throw new Error(`[test ws] non-protocol frame: ${event.data}`);
      }
      received.push(parsed);
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (event) =>
      reject(
        event instanceof ErrorEvent
          ? new Error(`WebSocket open failed: ${event.message}`)
          : new Error('WebSocket open failed'),
      );
  });

  ws.onerror = (event) => {
    const message =
      event instanceof ErrorEvent ? event.message : 'unknown error';
    console.error(`[test ws] transport error after open: ${message}`);
  };

  return {
    ws,
    received,
    receivedBinary,
    close() {
      return new Promise<void>((resolve) => {
        ws.onclose = () => resolve();
        ws.close();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Async waiting utilities
// ---------------------------------------------------------------------------

/**
 * Resolve once a message of `type` appears in `received`, or reject after
 * `timeoutMs` milliseconds.
 *
 * Polls every 20 ms.
 *
 * @param received - The `received` array from {@link openTestWs}.
 * @param type - The `type` field to match on.
 * @param predicate - Optional extra matcher applied after the `type` check.
 * @param timeoutMs - Maximum wait time in milliseconds (default `3000`).
 *
 * @example
 * ```ts
 * const msg = await waitForMessage(
 *   client.received,
 *   'engine.voice.state',
 *   (message) => message.type === 'engine.voice.state' && message.state === 'idle',
 * );
 * ```
 */
export function waitForMessage<TType extends VoiceServerMessage['type']>(
  received: VoiceServerMessage[],
  type: TType,
  predicate?: (m: Extract<VoiceServerMessage, { type: TType }>) => boolean,
  timeoutMs = 3000,
): Promise<Extract<VoiceServerMessage, { type: TType }>> {
  return new Promise<Extract<VoiceServerMessage, { type: TType }>>(
    (resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        for (const message of received) {
          if (!isVoiceServerMessageOfType(message, type)) {
            continue;
          }

          if (!predicate || predicate(message)) {
            resolve(message);
            return;
          }
        }
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `waitForMessage: timed out after ${timeoutMs}ms waiting for message type "${type}". ` +
                `Received types: [${received.map((m) => m.type).join(', ')}]`,
            ),
          );
          return;
        }
        setTimeout(poll, 20);
      };
      poll();
    },
  );
}

/**
 * Resolve with the first binary frame in `receivedBinary`, or reject after
 * `timeoutMs` milliseconds.
 *
 * Polls every 20 ms.
 *
 * @param receivedBinary - The `receivedBinary` array from {@link openTestWs}.
 * @param timeoutMs - Maximum wait time in milliseconds (default `3000`).
 *
 * @example
 * ```ts
 * const frame = await waitForBinaryFrame(client.receivedBinary);
 * expect(frame.length).toBeGreaterThan(1);
 * ```
 */
export function waitForBinaryFrame(
  receivedBinary: Uint8Array[],
  timeoutMs = 3000,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const frame = receivedBinary[0];
      if (frame !== undefined) {
        resolve(frame);
        return;
      }
      if (Date.now() >= deadline) {
        reject(
          new Error(
            `waitForBinaryFrame: timed out after ${timeoutMs}ms — no binary frames received`,
          ),
        );
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

/**
 * Resolve once `fn()` returns `true`, or reject after `timeoutMs` milliseconds.
 *
 * Polls every 20 ms.
 *
 * @param fn - Predicate evaluated on each poll tick.
 * @param timeoutMs - Maximum wait time in milliseconds (default `3000`).
 *
 * @example
 * ```ts
 * await waitForCondition(
 *   () => (mockVoice.session.startListening as TrackedFn).mock.calls.length > 0,
 * );
 * ```
 */
export function waitForCondition(
  fn: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (fn()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`waitForCondition: timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

// ---------------------------------------------------------------------------
// Message sender
// ---------------------------------------------------------------------------

/**
 * Serialise `message` as JSON and send it over `ws`.
 *
 * @param ws - An open WebSocket (e.g. from {@link openTestWs}).
 * @param message - Any JSON-serialisable value (typically a `VoiceClientMessage`).
 *
 * @example
 * ```ts
 * send(client.ws, { type: 'client.vad.speech_start', sessionId: 'test-session', timestamp: 0 });
 * ```
 */
export function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}
