/// <reference types="bun" />

/**
 * Standalone Bun WebSocket server for the Maelstrom demo.
 *
 * Runs alongside the TanStack Start dev server and handles
 * WebSocket connections for real-time engine + voice processing.
 *
 * Required env vars:
 *   GOOGLE_GENERATIVE_AI_API_KEY - Gemini LLM
 *
 * Optional env vars (enable voice):
 *   DEEPGRAM_API_KEY  - Speech-to-Text
 *   CARTESIA_API_KEY  - Text-to-Speech
 *
 * Architecture: voice-server handles STT/TTS/session, engine handles intent processing
 *
 * Usage: bun run apps/demo/src/server/ws-server.ts
 */

import {
  createEngine,
  createInMemoryStore,
  type Engine,
} from '@maelstrom-co/engine';
import {
  type MessageId,
  SessionId,
  type TranscriptMessage,
  type VoiceServerMessage,
} from '@maelstrom-co/protocol';
import {
  type AudioChunk,
  createVoiceSession,
  type SpeechChunk,
  type TranscriptionResult,
  type VoiceSession,
  type VoiceSessionCallbacks,
  type VoiceSessionConfig,
  type VoiceSessionError,
  type VoiceSessionState,
} from '@maelstrom-co/voice-server';
import { geminiText } from '@tanstack/ai-gemini';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { BunWebSocketData, BunWebSocketHandler } from 'hono/bun';
import { cors } from 'hono/cors';
import { DEMO_KEYTERMS } from './demo-keyterms.js';
import { getProviderErrorMetadata } from './provider-error-metadata.js';
import { flattenErrorChain } from './voice-error-format.js';
import { createDemoVoiceIntentAdapter } from './voice-intent-adapter.js';
import { createDemoVoiceWsSessionController } from './voice-ws-session.js';

type VoiceErrorMetadata = {
  kind?: 'auth' | 'quota' | 'transport' | 'parse' | 'server' | 'unknown';
  source?: 'stt' | 'tts';
  provider?: string;
};

/**
 * Dependency injection seams for `createDemoWsApp`.
 *
 * All fields are optional. When omitted the factory falls back to the
 * production defaults (real engine, real voice session, env-var keys).
 */
export interface DemoWsCoreDeps {
  /**
   * Override engine construction.
   *
   * When provided, called once per WebSocket connection instead of
   * the default `createEngine(...)` call. The caller is responsible for
   * supplying a fully-configured engine (including any history store).
   */
  engineFactory?: () => Engine;
}

export interface VoiceProviderKeys {
  deepgramApiKey: string;
  cartesiaApiKey: string;
}

export type DemoWsAppVoiceDeps =
  | {
      getVoiceProviderKeys?: () => null;
      voiceSessionFactory?: never;
    }
  | {
      getVoiceProviderKeys: () => VoiceProviderKeys;
      voiceSessionFactory?: (
        config: VoiceSessionConfig,
        callbacks: VoiceSessionCallbacks,
      ) => VoiceSession;
    };

export type DemoWsAppDeps = DemoWsCoreDeps & DemoWsAppVoiceDeps;

const CUSTOM_INSTRUCTIONS = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

const demoVadFinalDebounceMs = 250;

export const AUDIO_FLAGS = { CANCELLABLE: 0b00000001 } as const;

function defaultGetVoiceProviderKeys(): VoiceProviderKeys | null {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const cartesiaApiKey = process.env.CARTESIA_API_KEY;

  if (!deepgramApiKey || !cartesiaApiKey) {
    return null;
  }

  return { deepgramApiKey, cartesiaApiKey };
}

function toVoiceErrorMessage(
  sessionId: SessionId,
  error: unknown,
  metadata?: VoiceErrorMetadata,
) {
  return {
    type: 'engine.error' as const,
    sessionId,
    error: flattenErrorChain(error),
    timestamp: performance.now(),
    ...metadata,
  };
}

/**
 * Create a self-contained Hono app + Bun WebSocket handler for the demo WS server.
 *
 * Each call creates independent instances of the history store, Hono app, and
 * WebSocket handler — there is no shared module-scope state. This makes the
 * factory safe to call multiple times in tests without cross-test pollution.
 *
 * @param deps - Optional dependency overrides for testing. All fields default to
 *   production implementations when omitted.
 * @returns `{ app, websocket }` — pass `app.fetch` and `websocket` to Bun's
 *   `serve()` or use them directly in tests.
 */
export function createDemoWsApp(deps?: DemoWsAppDeps): {
  app: Hono;
  websocket: BunWebSocketHandler<BunWebSocketData>;
} {
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const historyStore = createInMemoryStore();

  const app = new Hono();

  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      allowHeaders: ['Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
    }),
  );

  app.get('/health', (c) =>
    c.json({ status: 'healthy', timestamp: new Date().toISOString() }),
  );

  app.get(
    '/ws',
    upgradeWebSocket((c) => {
      const sessionId = SessionId(
        c.req.query('sessionId') || crypto.randomUUID(),
      );
      const language = c.req.query('language') || 'en';
      const getVoiceProviderKeys =
        deps?.getVoiceProviderKeys ?? defaultGetVoiceProviderKeys;
      const voiceProviderKeys = getVoiceProviderKeys();

      let ws: { send: (data: string | ArrayBuffer) => void } | null = null;

      if (!voiceProviderKeys) {
        console.warn(
          '[Demo WS] Missing DEEPGRAM_API_KEY or CARTESIA_API_KEY — running in text-only mode',
        );
      }

      const sendMessage = (message: VoiceServerMessage) => {
        if (ws) {
          console.log(`[Demo WS] Sending message: ${message.type}`);
          ws.send(JSON.stringify(message));
        } else {
          console.warn(
            '[Demo WS] Cannot send message, WebSocket not connected',
          );
        }
      };

      const sendBinaryAudio = (data: Uint8Array, cancellable = true) => {
        if (ws) {
          const flags = cancellable ? AUDIO_FLAGS.CANCELLABLE : 0;
          const buffer = new Uint8Array(data.length + 1);
          buffer[0] = flags;
          buffer.set(data, 1);
          ws.send(buffer.buffer);
        }
      };

      const sendEngineError = (
        error: unknown,
        requestIdOrMetadata?: MessageId | VoiceErrorMetadata,
        metadata?: VoiceErrorMetadata,
      ) => {
        const requestId =
          typeof requestIdOrMetadata === 'string'
            ? requestIdOrMetadata
            : undefined;
        const resolvedMetadata =
          typeof requestIdOrMetadata === 'string'
            ? metadata
            : requestIdOrMetadata;

        sendMessage({
          ...toVoiceErrorMessage(sessionId, error, resolvedMetadata),
          ...(requestId !== undefined && { requestId }),
        });
      };

      const sendTranscriptMessage = (result: {
        text: string;
        isFinal: boolean;
        confidence?: number;
        language?: string;
        durationInSeconds?: number;
      }) => {
        const transcriptMsg: TranscriptMessage = {
          type: 'engine.stt.transcript',
          sessionId,
          text: result.text,
          isFinal: result.isFinal,
          timestamp: performance.now(),
        };

        if (result.confidence !== undefined) {
          transcriptMsg.confidence = result.confidence;
        }
        if (result.language !== undefined) {
          transcriptMsg.language = result.language;
        }
        if (result.durationInSeconds !== undefined) {
          transcriptMsg.durationInSeconds = result.durationInSeconds;
        }
        console.log(
          `[Demo WS] Sending transcript: ${result.text}. IsFinal: ${result.isFinal}`,
        );
        sendMessage(transcriptMsg);
      };

      const forwardAudioInput = (audio: AudioChunk) => {
        voiceSession?.sendAudioChunk(audio);
      };

      const forwardRawAudioInput = async (data: ArrayBuffer | Blob) => {
        const bytes =
          data instanceof Blob
            ? new Uint8Array(await data.arrayBuffer())
            : new Uint8Array(data);

        forwardAudioInput({
          data: bytes,
          sampleRate: 16000,
          encoding: 'linear16',
          timestamp: performance.now(),
        });
      };

      const createVoiceCallbacks = (): VoiceSessionCallbacks => ({
        onVoiceStateChange: (state: VoiceSessionState) => {
          console.log(`[Demo WS] Voice state: ${JSON.stringify(state)}`);
          sendMessage({
            type: 'engine.voice.state',
            sessionId,
            state,
            timestamp: performance.now(),
          });
        },
        onTranscript: (result: TranscriptionResult) => {
          console.log(
            `[Demo WS] Transcript: ${result.text}. IsFinal: ${result.isFinal}`,
          );
          sendTranscriptMessage(result);
        },
        onAudioOutput: (chunk: SpeechChunk) => {
          if (chunk.data.length > 0) {
            sendBinaryAudio(chunk.data);
          }
        },
        // Fires once per actual turn start — including queued successors.
        // The internal speak queue is never exposed on the wire; `queued` only
        // tells the client that this turn continues the existing playback chain
        // and should not interrupt audio already in flight.
        onSpeechStarted: (speech) => {
          sendMessage({
            type: 'engine.tts.sent',
            sessionId,
            text: speech.text,
            timestamp: performance.now(),
            data: new Uint8Array(0),
            format: speech.format,
            sampleRate: speech.sampleRate,
            sequence: 0,
            isFinal: false,
            queued: speech.queued,
          });
        },
        onSpeechStopped: () => {},
        onError: (error: VoiceSessionError) => {
          sendEngineError(error, getProviderErrorMetadata(error));
        },
        onInterrupt: (source: string) => {
          console.log(`[Demo WS] Interrupt from: ${source}`);
        },
      });

      const engine = deps?.engineFactory
        ? deps.engineFactory()
        : createEngine({
            adapter: geminiText('gemini-3.1-flash-lite-preview'),
            maxRetries: 2,
            history: {
              store: historyStore,
              maxEntries: 20,
            },
            prompt: {
              system: { rules: { append: CUSTOM_INSTRUCTIONS } },
            },
          });

      let voiceSession: VoiceSession | null = null;
      let voiceSessionInitializationError: unknown = null;
      let voiceWsSession: ReturnType<
        typeof createDemoVoiceWsSessionController
      > | null = null;

      const { buildChartRequest, processIntent } = createDemoVoiceIntentAdapter(
        engine,
        sessionId,
        sendMessage,
        () => voiceWsSession?.getLatestChartRequest() ?? null,
        (request) => voiceWsSession?.getExplicitRequestId(request) ?? null,
      );

      if (!voiceProviderKeys) {
        voiceSessionInitializationError =
          'Voice disabled: missing DEEPGRAM_API_KEY or CARTESIA_API_KEY';
      } else {
        try {
          const voiceConfig: VoiceSessionConfig = {
            stt: {
              type: 'deepgram',
              options: {
                apiKey: voiceProviderKeys.deepgramApiKey,
                keyterms: DEMO_KEYTERMS,
                vadEvents: true,
              },
            },
            tts: {
              type: 'cartesia',
              options: {
                defaultVoiceId: 'e8e5fffb-252c-436d-b842-8879b84445b6',
                apiKey: voiceProviderKeys.cartesiaApiKey,
              },
            },
            sessionId,
            language,
            interimResults: true,
            // WHY: The browser demo needs a tighter turn boundary than the shared package default.
            // Keeping that tuning here avoids biasing other voice-server consumers toward demo-only timing.
            vadFinalDebounceMs: demoVadFinalDebounceMs,
            buildChartRequest,
            processIntent,
          };
          const callbacks = createVoiceCallbacks();
          voiceSession = deps?.voiceSessionFactory
            ? deps.voiceSessionFactory(voiceConfig, callbacks)
            : createVoiceSession(voiceConfig, callbacks);
        } catch (error) {
          console.error('[Demo WS] Failed to construct voice session', error);
          voiceSessionInitializationError = error;
          voiceSession = null;
        }
      }

      voiceWsSession = createDemoVoiceWsSessionController({
        sessionId,
        voiceSession,
        engine,
        transport: { sendMessage, sendEngineError },
        forwardBinaryAudioInput: forwardRawAudioInput,
      });

      return {
        onOpen: async (_event, wsContext) => {
          ws = wsContext;
          if (voiceSessionInitializationError) {
            sendEngineError(voiceSessionInitializationError);
          }
          await voiceWsSession.onOpen();
        },

        onMessage: async (event: MessageEvent) => {
          await voiceWsSession.onMessage(event.data);
        },

        onClose: () => {
          voiceWsSession.onClose();
          ws = null;
        },

        onError: (error: unknown) => {
          voiceWsSession.onError(error);
          ws = null;
        },
      };
    }),
  );

  return { app, websocket };
}

export function startDemoWsServer(): void {
  const port = Number(process.env.WS_PORT) || 3001;
  const { app, websocket } = createDemoWsApp();
  Bun.serve({ fetch: app.fetch, websocket, port });
  console.log(`[Demo WS Server] Listening on port ${port}`);
}

if (import.meta.main) {
  startDemoWsServer();
}
