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
 * Usage: bun run apps/demo/src/server/ws-server.ts
 */

import {
  createCartesiaTTS,
  createDeepgramSTT,
  createEngine,
  createInMemoryHistoryStore,
  createTanStackProvider,
  createVoiceEngine,
  getDefaultSystemPrompt,
  isVoiceEngine,
} from '@maelstrom-co/engine-old';
import type {
  TranscriptMessage,
  VoiceClientMessage,
  VoiceServerMessage,
} from '@maelstrom-co/protocol-old';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { cors } from 'hono/cors';

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

const hasVoiceKeys = Boolean(
  process.env.DEEPGRAM_API_KEY && process.env.CARTESIA_API_KEY,
);

if (!hasVoiceKeys) {
  console.warn(
    '[Demo WS] Missing DEEPGRAM_API_KEY or CARTESIA_API_KEY — running in text-only mode',
  );
}

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const sessionId =
      c.req.query('sessionId') || `session-${performance.now()}`;
    const language = c.req.query('language') || 'en';

    const provider = createTanStackProvider('gemini-3.1-flash-lite-preview');

    let ws: { send: (data: string | ArrayBuffer) => void } | null = null;

    const sendMessage = (message: VoiceServerMessage) => {
      if (ws) {
        ws.send(JSON.stringify(message));
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

    const baseConfig = {
      provider,
      timeout: 30000,
      retry: { maxAttempts: 2, initialDelayMs: 500 },
      history: {
        store: historyStore,
        contentLevel: 'full' as const,
        maxEntries: 20,
      },
      systemPrompt: getDefaultSystemPrompt('tiling') + CUSTOM_INSTRUCTIONS,
    };

    // Create voice engine when keys are available, otherwise plain engine
    const engine = hasVoiceKeys
      ? createVoiceEngine(
          {
            ...baseConfig,
            voice: {
              stt: createDeepgramSTT({
                apiKey: process.env.DEEPGRAM_API_KEY as string,
              }),
              tts: createCartesiaTTS({
                defaultVoiceId: 'e8e5fffb-252c-436d-b842-8879b84445b6',
                apiKey: process.env.CARTESIA_API_KEY as string,
              }),
              mode: 'continuous',
              language,
              interimResults: true,
            },
          },
          {
            onVoiceStateChange: (state) => {
              console.log(`[Demo WS] Voice state: ${JSON.stringify(state)}`);
              sendMessage({
                type: 'engine.voice.state',
                sessionId,
                state,
                timestamp: performance.now(),
              });
            },
            onTranscript: (result) => {
              console.log(
                `[Demo WS] Transcript: ${result.text} isFinal: ${result.isFinal}`,
              );
              const transcriptMsg: TranscriptMessage = {
                type: 'engine.stt.transcript',
                sessionId,
                text: result.text,
                isFinal: result.isFinal,
                timestamp: performance.now(),
              };
              if (result.confidence !== undefined)
                transcriptMsg.confidence = result.confidence;
              if (result.language !== undefined)
                transcriptMsg.language = result.language;
              if (result.durationInSeconds !== undefined)
                transcriptMsg.durationInSeconds = result.durationInSeconds;
              sendMessage(transcriptMsg);
            },
            onAudioOutput: (chunk) => {
              if (chunk.data.length > 0) {
                sendBinaryAudio(chunk.data);
              }
            },
            onSpeechStarted: (text) => {
              sendMessage({
                type: 'engine.tts.sent',
                sessionId,
                text,
                timestamp: performance.now(),
                data: new Uint8Array(0),
                format: 'pcm',
                sampleRate: 24000,
                sequence: 0,
                isFinal: false,
              });
            },
            onSpeechStopped: () => {},
            onError: (error) => {
              sendMessage({
                type: 'engine.error',
                sessionId,
                error: error.message,
                timestamp: performance.now(),
              });
            },
            onInterrupt: (source) => {
              console.log(`[Demo WS] Interrupt from: ${source}`);
            },
          },
        )
      : createEngine(baseConfig);

    return {
      onOpen: async (_event, wsContext) => {
        ws = wsContext;
        console.log(`[Demo WS] WebSocket opened for session: ${sessionId}`);

        if (isVoiceEngine(engine)) {
          engine.warmup().catch((err: unknown) => {
            console.error(`[Demo WS] Warmup failed: ${err}`);
          });
        }

        sendMessage({
          type: 'engine.stt.ready',
          sessionId,
          timestamp: performance.now(),
        });
      },

      onMessage: async (event: MessageEvent) => {
        try {
          const data = event.data;

          // Handle binary audio data
          if (data instanceof ArrayBuffer && isVoiceEngine(engine)) {
            engine.sendAudioChunk({
              data: new Uint8Array(data),
              sampleRate: 16000,
              encoding: 'linear16',
              timestamp: performance.now(),
            });
            return;
          }

          if (data instanceof Blob && isVoiceEngine(engine)) {
            const arrayBuffer = await data.arrayBuffer();
            engine.sendAudioChunk({
              data: new Uint8Array(arrayBuffer),
              sampleRate: 16000,
              encoding: 'linear16',
              timestamp: performance.now(),
            });
            return;
          }

          // Handle JSON messages
          const message = JSON.parse(data as string) as VoiceClientMessage;

          switch (message.type) {
            case 'client.voice.speak': {
              if (!isVoiceEngine(engine)) break;
              console.log(
                `[Demo WS] Speaking: "${message.text.substring(0, 50)}..."`,
              );
              try {
                await engine.addAssistantMessage({
                  sessionId,
                  message: message.text,
                });
                await engine.speak(message.text);
              } catch (err: unknown) {
                console.error(`[Demo WS] Speak error: ${err}`);
              }
              break;
            }

            case 'client.history.add_assistant_message': {
              console.log(
                `[Demo WS] Adding assistant message: "${message.message.substring(0, 50)}..."`,
              );
              try {
                await engine.addAssistantMessage({
                  sessionId,
                  message: message.message,
                });
              } catch (err: unknown) {
                console.error(`[Demo WS] Add assistant message error: ${err}`);
              }
              break;
            }

            case 'client.audio_capture.audio_sent':
              if (isVoiceEngine(engine)) {
                engine.sendAudioChunk({
                  data: message.data,
                  sampleRate: message.sampleRate,
                  encoding: message.encoding,
                  timestamp: message.timestamp,
                });
              }
              break;

            case 'client.maelstrom.process': {
              const response = await engine.process(message.request);
              sendMessage({
                type: 'engine.maelstrom.response',
                sessionId,
                requestId: message.request.id,
                response,
              });
              if (
                isVoiceEngine(engine) &&
                response.userMessage &&
                message.request.context.updateReasons.some(
                  (r) => r.type === 'user_intent',
                )
              ) {
                engine.speak(response.userMessage);
              }
              break;
            }

            case 'client.audio_capture.ready':
              console.log('[Demo WS] Client audio capture ready');
              break;

            case 'client.vad.speech_start': {
              if (!isVoiceEngine(engine)) break;
              console.log('[Demo WS] VAD detected speech start');
              if (engine.getVoiceState() === 'speaking') {
                engine.interrupt();
              }
              engine.handleVADEvent({
                type: 'speech_start',
                timestamp: message.timestamp,
              });
              if (engine.getVoiceState() !== 'listening') {
                engine.startListening().catch((err: unknown) => {
                  console.error(`[Demo WS] Cannot restart listening: ${err}`);
                });
              }
              break;
            }

            case 'client.vad.speech_end': {
              if (!isVoiceEngine(engine)) break;
              console.log('[Demo WS] VAD detected speech end');
              engine.handleVADEvent({
                type: 'speech_end',
                timestamp: message.timestamp,
              });
              engine.stopListening().catch((err: unknown) => {
                console.error(`[Demo WS] Cannot stop listening: ${err}`);
              });
              break;
            }

            default:
              console.warn(
                `Unknown message type: ${(message as { type: string }).type}`,
              );
          }
        } catch (error) {
          console.error(
            `WebSocket message error: ${error instanceof Error ? error.message : String(error)}`,
          );
          sendMessage({
            type: 'engine.error',
            sessionId,
            error: error instanceof Error ? error.message : 'Invalid message',
            timestamp: performance.now(),
          });
        }
      },

      onClose: () => {
        if (isVoiceEngine(engine)) engine.destroy();
        ws = null;
      },

      onError: (error: unknown) => {
        console.error(
          `WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (isVoiceEngine(engine)) engine.destroy();
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
