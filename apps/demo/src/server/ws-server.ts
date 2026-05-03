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
  createInMemoryHistoryStore,
  createTanStackProvider,
} from '@maelstrom-co/engine-old';
import { SessionId } from '@maelstrom-co/protocol';
import type {
  TranscriptMessage,
  VoiceServerMessage,
} from '@maelstrom-co/protocol-old';
import {
  type AudioChunk,
  createVoiceSession,
  type SpeechChunk,
  type TranscriptionResult,
  type VoiceSession,
  type VoiceSessionCallbacks,
  type VoiceSessionState,
} from '@maelstrom-co/voice-server';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { DEMO_KEYTERMS } from './demo-keyterms.js';
import { createDemoVoiceIntentAdapter } from './voice-intent-adapter.js';
import { createDemoVoiceWsSessionController } from './voice-ws-session.js';

const { upgradeWebSocket, websocket } = createBunWebSocket();

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

const historyStore = createInMemoryHistoryStore({
  sessionTtlMs: 60 * 60 * 1000,
  maxEntriesPerSession: 50,
});

const CUSTOM_INSTRUCTIONS = `

ADDITIONAL INSTRUCTIONS:
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

const demoVadFinalDebounceMs = 250;

function getDemoVoiceProviderKeys(): {
  deepgramApiKey: string;
  cartesiaApiKey: string;
} | null {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  const cartesiaApiKey = process.env.CARTESIA_API_KEY;

  if (!deepgramApiKey || !cartesiaApiKey) {
    return null;
  }

  return { deepgramApiKey, cartesiaApiKey };
}

function flattenErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current instanceof Error) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }

  if (current !== undefined && current !== null) {
    parts.push(String(current));
  }

  return parts.join(': ');
}

if (!getDemoVoiceProviderKeys()) {
  console.warn(
    '[Demo WS] Missing DEEPGRAM_API_KEY or CARTESIA_API_KEY — running in text-only mode',
  );
}

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const sessionId = SessionId(
      c.req.query('sessionId') || crypto.randomUUID(),
    );
    const language = c.req.query('language') || 'en';

    const provider = createTanStackProvider('gemini-3.1-flash-lite-preview');

    let ws: { send: (data: string | ArrayBuffer) => void } | null = null;

    const sendMessage = (message: VoiceServerMessage) => {
      if (ws) {
        console.log(`[Demo WS] Sending message: ${message.type}`);
        ws.send(JSON.stringify(message));
      } else {
        console.warn('[Demo WS] Cannot send message, WebSocket not connected');
      }
    };

    const AUDIO_FLAGS = { CANCELLABLE: 0b00000001 } as const;

    const sendBinaryAudio = (data: Uint8Array, cancellable = true) => {
      if (ws) {
        const flags = cancellable ? AUDIO_FLAGS.CANCELLABLE : 0;
        const buffer = new Uint8Array(data.length + 1);
        buffer[0] = flags;
        buffer.set(data, 1);
        ws.send(buffer.buffer);
      }
    };

    const sendEngineError = (error: string) => {
      sendMessage({
        type: 'engine.error',
        sessionId,
        error,
        timestamp: performance.now(),
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
        });
      },
      onSpeechStopped: () => {},
      onError: (error: Error) => {
        sendEngineError(error.message);
      },
      onInterrupt: (source: string) => {
        console.log(`[Demo WS] Interrupt from: ${source}`);
      },
    });

    const engine = createEngine({
      provider,
      timeout: 30000,
      retry: { maxAttempts: 2, initialDelayMs: 500 },
      history: {
        store: historyStore,
        contentLevel: 'full' as const,
        maxEntries: 20,
      },
      systemPromptExtension: CUSTOM_INSTRUCTIONS,
    });

    let voiceSession: VoiceSession | null = null;
    let voiceSessionInitializationError: string | null = null;
    let voiceWsSession: ReturnType<
      typeof createDemoVoiceWsSessionController
    > | null = null;

    const { buildChartRequest, processIntent } = createDemoVoiceIntentAdapter(
      engine,
      sessionId,
      sendMessage,
      () => voiceWsSession?.getLatestChartRequest() ?? null,
    );

    const demoVoiceProviderKeys = getDemoVoiceProviderKeys();

    if (!demoVoiceProviderKeys) {
      voiceSessionInitializationError =
        'Voice disabled: missing DEEPGRAM_API_KEY or CARTESIA_API_KEY';
    } else {
      try {
        voiceSession = createVoiceSession(
          {
            stt: {
              type: 'deepgram',
              options: {
                apiKey: demoVoiceProviderKeys.deepgramApiKey,
                keyterms: DEMO_KEYTERMS,
                vadEvents: true,
              },
            },
            tts: {
              type: 'cartesia',
              options: {
                defaultVoiceId: 'e8e5fffb-252c-436d-b842-8879b84445b6',
                apiKey: demoVoiceProviderKeys.cartesiaApiKey,
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
          },
          createVoiceCallbacks(),
        );
      } catch (error) {
        console.error('[Demo WS] Failed to construct voice session', error);
        voiceSessionInitializationError = flattenErrorChain(error);
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

const port = Number(process.env.WS_PORT) || 3001;

export default {
  fetch: app.fetch,
  websocket,
  port,
};

console.log(`[Demo WS Server] Listening on port ${port}`);
