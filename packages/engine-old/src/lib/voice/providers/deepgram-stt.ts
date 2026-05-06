/**
 * Deepgram Speech-to-Text provider implementation.
 *
 * This provider uses Deepgram's WebSocket API for real-time streaming
 * transcription with built-in Voice Activity Detection (VAD).
 *
 * @example
 * ```typescript
 * const stt = createDeepgramSTT({
 *   apiKey: process.env.DEEPGRAM_API_KEY,
 *   model: 'nova-3',
 * });
 *
 * await stt.connect({ language: 'en', vad: { utteranceEndMs: 2500 } });
 *
 * stt.onEvent((event) => {
 *   if (event.type === 'transcript') {
 *     console.log(event.result.text, event.result.isFinal);
 *   }
 * });
 *
 * // Send audio chunks
 * stt.sendAudio({
 *   data: audioChunk,
 *   sampleRate: 16000,
 *   encoding: 'linear16',
 *   timestamp: Date.now(),
 * });
 * ```
 */

import { Effect } from 'effect';

import { toError } from '@maelstrom-co/protocol';
import type {
  AudioChunk,
  STTEvent,
  STTProvider,
  TranscriptionResult,
} from '../types.js';

export interface DeepgramSTTOptions {
  /** Deepgram API key (defaults to DEEPGRAM_API_KEY env var) */
  apiKey?: string;
  /** Model to use (default: 'nova-3') */
  model?: string;
  /** Enable smart formatting (default: true) */
  smartFormat?: boolean;
  /** Enable interim results (default: true) */
  interimResults?: boolean;
  /** Fixed keyterms to boost (default: domain-specific terms) */
  keyterms?: string[];
  /** Optional provider function for dynamic keyterms, e.g. based on conversation context */
  keytermsProvider?: () => Promise<string[]>;
}

/**
 * Creates a Deepgram STT provider.
 */
export function createDeepgramSTT(
  options: DeepgramSTTOptions = {},
): STTProvider {
  const {
    apiKey = process.env.DEEPGRAM_API_KEY,
    model = 'nova-3',
    smartFormat = true,
    interimResults = true,
    keyterms = [
      // these are related to the domain of data science and analytics, which is relevant to the context of this conversation
      // add more if needed
      // TODO: this should be configurable by the library user
      'mar',
      'vessel',
      'vessels',
      'value',
      'values',
      'mean',
      'median',
      'mode',
      'average',
      'total',
      'sum',
      'maximum',
      'minimum',
      'plot',
      'graph',
      'chart',
      'visualize',
      'visualization',
      'correlation',
      'regression',
      'distribution',
      'outlier',
      'trend',
      'seasonality',
    ],
    keytermsProvider,
  } = options;

  if (!apiKey) {
    throw new Error(
      'Deepgram API key is required. Set DEEPGRAM_API_KEY environment variable or pass apiKey option.',
    );
  }

  let ws: WebSocket | null = null;
  let isConnectedFlag = false;
  let isListeningFlag = false;
  let totalBytesSent = 0;
  let chunkCount = 0;
  const eventListeners = new Set<(event: STTEvent) => void>();

  function emit(event: STTEvent) {
    eventListeners.forEach((cb) => {
      cb(event);
    });
  }

  function handleMessage(data: unknown) {
    try {
      const message = JSON.parse(String(data));

      Effect.runSync(
        Effect.logDebug(
          `[Deepgram STT] Received message type: ${message.type}`,
        ),
      );

      // Handle transcript results
      if (message.type === 'Results') {
        const transcript = message.channel?.alternatives?.[0]?.transcript;
        const isFinal = message.is_final;
        const confidence = message.channel?.alternatives?.[0]?.confidence;

        if (transcript !== undefined) {
          Effect.runSync(
            Effect.logInfo(
              `[Deepgram STT] Received transcript: ${transcript}, isFinal: ${isFinal}`,
            ),
          );
          const result: TranscriptionResult = {
            text: transcript,
            isFinal,
            confidence,
            language: message.channel?.detected_language,
            durationInSeconds: message.duration,
          };

          emit({ type: 'transcript', result });
        }
      }
    } catch (error) {
      emit({
        type: 'error',
        error: toError(error),
      });
    }
  }

  return {
    name: 'deepgram',

    async connect(config?: { language?: string }): Promise<void> {
      if (ws?.readyState === WebSocket.OPEN) {
        return;
      }

      const language = config?.language || 'en';
      let dynamicKeyterms: string[] = [];

      if (keytermsProvider) {
        try {
          dynamicKeyterms = await keytermsProvider();
        } catch (error) {
          Effect.runSync(
            Effect.logWarning(
              `[Deepgram STT] Failed to resolve dynamic keyterms: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }

      const allKeyterms = Array.from(
        new Set(
          [...keyterms, ...dynamicKeyterms]
            .map((term) => term.trim())
            .filter((term) => term.length > 0),
        ),
      );

      // Build WebSocket URL with parameters
      const params = new URLSearchParams({
        model,
        language,
        smart_format: String(smartFormat),
        interim_results: String(interimResults),
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
      });

      for (const keyterm of allKeyterms) {
        params.append('keyterm', keyterm);
      }

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      console.log(
        '[Deepgram STT] Connecting to:',
        wsUrl.replace(apiKey, '***'),
      );

      return new Promise((resolve, reject) => {
        ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Token ${apiKey}`,
          },
        } as any);
        console.log('[Deepgram STT] WebSocket created, waiting for open...');

        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
          if (ws && ws.readyState !== WebSocket.OPEN) {
            console.error(
              '[Deepgram STT] Connection timeout after 10s, readyState:',
              ws.readyState,
            );
            ws.close();
            reject(new Error('Deepgram WebSocket connection timeout'));
          }
        }, 10000);

        ws.onopen = () => {
          clearTimeout(timeout);
          isConnectedFlag = true;
          totalBytesSent = 0;
          chunkCount = 0;
          console.log('[Deepgram STT] Connected to Deepgram (counters reset)');
          emit({ type: 'connected' });
          resolve();
        };

        ws.onmessage = (event) => {
          handleMessage(event.data);
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error('[Deepgram STT] WebSocket error:', error);
          const err = new Error('Deepgram WebSocket error');
          emit({ type: 'error', error: err });
          reject(err);
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          console.log(
            '[Deepgram STT] WebSocket closed, readyState:',
            ws?.readyState,
          );
          isConnectedFlag = false;
          isListeningFlag = false;
          emit({ type: 'disconnected' });
        };
      });
    },

    async disconnect(): Promise<void> {
      if (ws) {
        ws.close();
        ws = null;
      }
      isConnectedFlag = false;
      isListeningFlag = false;
    },

    sendAudio(chunk: AudioChunk): void {
      chunkCount++;
      totalBytesSent += chunk.data.length;

      console.log(
        `[Deepgram STT] Sending chunk #${chunkCount}: ${chunk.data.length}B, total=${totalBytesSent}B`,
      );

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(
          `[Deepgram STT] Cannot send audio - WS state: ${ws?.readyState ?? 'null'}`,
        );
        emit({ type: 'error', error: new Error('Not connected to Deepgram') });
        return;
      }

      isListeningFlag = true;
      ws.send(chunk.data);
    },

    endStream(): void {
      Effect.runSync(
        Effect.logInfo(
          `[Deepgram STT] Ending stream. Total sent: ${totalBytesSent}B in ${chunkCount} chunks`,
        ),
      );
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new Uint8Array(0));
      }
      isListeningFlag = false;
      totalBytesSent = 0;
      chunkCount = 0;
    },

    onEvent(callback: (event: STTEvent) => void): () => void {
      eventListeners.add(callback);
      return () => eventListeners.delete(callback);
    },

    isConnected(): boolean {
      return isConnectedFlag;
    },

    isListening(): boolean {
      return isListeningFlag;
    },

    get ws() {
      return ws;
    },
  } as STTProvider;
}
