import { classifyTTSError, createTTSError } from '../../provider-errors.js';
import type {
  SpeechChunk,
  SpeechOptions,
  SpeechSynthesisHandle,
  TTSEvent,
  TTSProvider,
} from '../../types.js';
import { createWebSocket } from '../../websocket.js';

/**
 * Configuration options for Cartesia TTS provider.
 *
 * WHY: The provider keeps transport defaults here so callers can swap voices or models without
 * rebuilding the provider whenever a session-level speech request omits those fields.
 */
export interface CartesiaTTSOptions {
  /** Cartesia API key from https://cartesia.ai */
  apiKey?: string;
  /** Cartesia WebSocket base URL or full WebSocket URL */
  baseUrl?: string;
  /** Cartesia API version string for WebSocket requests */
  cartesiaVersion?: string;
  /** Default voice ID to use when none specified */
  defaultVoiceId?: string;
  /** Model to use (default: latest) */
  modelId?: string;
  /** Language code (default: en) */
  language?: string;
  /** Output sample rate (default: 24000) */
  sampleRate?: number;
  /** WebSocket connection timeout in milliseconds */
  connectionTimeoutMs?: number;
}

/**
 * Speech options for specific utterances.
 *
 * WHY: Cartesia exposes turn-continuation controls per utterance, not per provider, so these stay
 * on the speak-time options instead of the shared base interface.
 */
export interface CartesiaSpeechOptions extends SpeechOptions {
  /** Don't end the stream - allows subsequent speak() to continue */
  continue?: boolean;
  /** Flush audio immediately - reduces latency */
  flush?: boolean;
}

interface CartesiaWebSocketMessage {
  type?: string;
  data?: string;
  chunk?: string;
  done?: boolean;
  flush_id?: number;
  error?: string;
}

interface CartesiaRequest {
  model_id: string;
  transcript: string;
  voice: { mode: 'id'; id: string };
  language: string;
  output_format: {
    container: 'raw';
    encoding: 'pcm_f32le';
    sample_rate: number;
  };
  context_id?: string;
  continue?: boolean;
  flush?: boolean;
  speed?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOptionalString(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const candidate = value[field];
  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== 'string') {
    throw new Error(`Cartesia message field \`${field}\` must be a string`);
  }

  return candidate;
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const candidate = value[field];
  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== 'boolean') {
    throw new Error(`Cartesia message field \`${field}\` must be a boolean`);
  }

  return candidate;
}

function readOptionalNumber(
  value: Record<string, unknown>,
  field: string,
): number | undefined {
  const candidate = value[field];
  if (candidate === undefined) {
    return undefined;
  }

  if (typeof candidate !== 'number') {
    throw new Error(`Cartesia message field \`${field}\` must be a number`);
  }

  return candidate;
}

function parseCartesiaMessage(data: unknown): CartesiaWebSocketMessage {
  const parsed = JSON.parse(String(data)) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('Cartesia message must be a JSON object');
  }

  return {
    type: readOptionalString(parsed, 'type'),
    data: readOptionalString(parsed, 'data'),
    chunk: readOptionalString(parsed, 'chunk'),
    done: readOptionalBoolean(parsed, 'done'),
    flush_id: readOptionalNumber(parsed, 'flush_id'),
    error: readOptionalString(parsed, 'error'),
  };
}

function generateContextId(): string {
  return `ctx-${crypto.randomUUID()}`;
}

/**
 * Creates a Cartesia TTS provider for streaming spoken turns over WebSocket.
 *
 * @remarks
 * Cartesia is the streaming-oriented TTS implementation in this package. The provider tracks both
 * connection state and turn state so one spoken response can be continued, flushed, or cancelled
 * without confusing the runtime about whether the assistant is still speaking.
 */
export function createCartesiaTTS(
  options: CartesiaTTSOptions = {},
): TTSProvider {
  const {
    apiKey = process.env.CARTESIA_API_KEY,
    baseUrl = 'wss://api.cartesia.ai',
    cartesiaVersion = '2024-06-10',
    defaultVoiceId,
    modelId = 'sonic-3',
    language = 'en',
    sampleRate = 44100,
    connectionTimeoutMs = 10000,
  } = options;

  if (!apiKey) {
    throw new Error(
      'Cartesia API key is required. Set CARTESIA_API_KEY environment variable or pass apiKey option.',
    );
  }

  let ws: WebSocket | null = null;
  /** True once the transport is open and ready to accept synthesis requests. */
  let isConnectedFlag = false;
  /** True while the current Cartesia context still represents an active spoken turn. */
  let isSpeakingFlag = false;
  /** Current provider-side turn identifier used to group chunks from the same spoken response. */
  let currentContextId: string | null = null;
  /** Chunk ordering within the current spoken turn. */
  let sequence = 0;
  let hasEmittedDisconnected = false;
  let activeSynthesis: {
    resolveCompletion: (reason: 'completed' | 'stopped') => void;
    completionSettled: boolean;
  } | null = null;
  const eventListeners = new Set<(event: TTSEvent) => void>();

  function emit(event: TTSEvent) {
    eventListeners.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('Cartesia TTS event listener failed', error);
      }
    });
  }

  function settleActiveSynthesis(reason: 'completed' | 'stopped') {
    if (!activeSynthesis || activeSynthesis.completionSettled) {
      return;
    }

    activeSynthesis.completionSettled = true;
    activeSynthesis.resolveCompletion(reason);
    activeSynthesis = null;
  }

  function resetActiveSynthesis(reason: 'completed' | 'stopped') {
    isSpeakingFlag = false;
    currentContextId = null;
    settleActiveSynthesis(reason);
  }

  function emitTransportFailure(message: string, cause?: unknown) {
    emit({
      type: 'error',
      error: createTTSError('cartesia', 'transport', message, cause),
    });
  }

  function emitDisconnected(clean: boolean, message: string) {
    if (hasEmittedDisconnected) {
      return;
    }

    hasEmittedDisconnected = true;
    emit({
      type: 'disconnected',
      clean,
      reason: clean ? 'clean_shutdown' : 'transport_lost',
      message,
    } as TTSEvent);
  }

  function buildWebSocketUrl(): string {
    const parsedUrl = new URL(baseUrl);

    if (!parsedUrl.pathname.endsWith('/tts/websocket')) {
      parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/$/, '')}/tts/websocket`;
    }

    parsedUrl.searchParams.set('cartesia_version', cartesiaVersion);

    return parsedUrl.toString();
  }

  /**
   * Maps Cartesia messages onto the shared TTS event model.
   *
   * WHY: Cartesia exposes chunk, done, and error messages directly over WebSocket. Translating them
   * here preserves a consistent speaking state contract for the runtime and callers.
   */
  function handleMessage(data: unknown) {
    try {
      const message = parseCartesiaMessage(data);
      const chunkPayload = message.data ?? message.chunk;

      if (message.type === 'chunk' && chunkPayload) {
        sequence += 1;
        const chunk: SpeechChunk = {
          data: Buffer.from(chunkPayload, 'base64'),
          format: 'pcm_f32le',
          sampleRate,
          isFinal: false,
          sequence,
        };
        emit({ type: 'chunk', chunk });
        return;
      }

      if (message.done) {
        sequence += 1;
        emit({
          type: 'chunk',
          chunk: {
            data: new Uint8Array(0),
            format: 'pcm_f32le',
            sampleRate,
            isFinal: true,
            sequence,
          },
        });
        resetActiveSynthesis('completed');
        return;
      }

      if (message.error) {
        resetActiveSynthesis('stopped');
        emit({
          type: 'error',
          error: classifyTTSError(new Error(message.error), 'cartesia'),
        });
      }
    } catch (error) {
      resetActiveSynthesis('stopped');
      emit({
        type: 'error',
        error: classifyTTSError(error, 'cartesia'),
      });
    }
  }

  return {
    name: 'cartesia',
    capabilities: {
      streamingTts: true,
    },
    async connect(): Promise<void> {
      if (ws?.readyState === WebSocket.OPEN) {
        return;
      }

      const wsUrl = buildWebSocketUrl();

      await new Promise<void>((resolve, reject) => {
        ws = createWebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Cartesia-Version': cartesiaVersion,
            'X-API-Key': apiKey,
          },
        });

        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          const error = createTTSError(
            'cartesia',
            'transport',
            'Cartesia WebSocket connection timeout',
          );
          emit({ type: 'error', error });
          try {
            ws?.close();
          } catch (closeError) {
            emitTransportFailure(
              'Cartesia WebSocket close failed after connection timeout',
              closeError,
            );
          }
          reject(error);
        }, connectionTimeoutMs);

        ws.onopen = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          hasEmittedDisconnected = false;
          isConnectedFlag = true;
          resolve();
        };

        ws.onmessage = (event) => {
          handleMessage(event.data);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          const error = createTTSError(
            'cartesia',
            'transport',
            'Cartesia WebSocket error',
          );

          if (!settled) {
            settled = true;
            emit({ type: 'error', error });
            reject(error);
            return;
          }

          if (isSpeakingFlag) {
            resetActiveSynthesis('stopped');
          }

          emit({ type: 'error', error });
        };

        ws.onclose = (event) => {
          clearTimeout(timeout);
          const wasSpeaking = isSpeakingFlag;
          const reasonSuffix = event.reason ? `: ${event.reason}` : '';
          isConnectedFlag = false;
          if (!settled) {
            settled = true;
            const error = createTTSError(
              'cartesia',
              'transport',
              `Cartesia WebSocket closed before ready (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`,
            );
            emit({ type: 'error', error });
            reject(error);
            return;
          }

          if (wasSpeaking) {
            resetActiveSynthesis('stopped');
          } else {
            isSpeakingFlag = false;
            currentContextId = null;
          }

          if (event.code !== 1000 && wasSpeaking) {
            emit({
              type: 'error',
              error: createTTSError(
                'cartesia',
                'transport',
                `Cartesia WebSocket closed unexpectedly (${event.code}${reasonSuffix})`,
              ),
            });
          }

          emitDisconnected(
            event.code === 1000,
            event.code === 1000
              ? 'Cartesia WebSocket disconnected cleanly'
              : `Cartesia WebSocket closed unexpectedly (${event.code}${reasonSuffix})`,
          );
        };
      });
    },
    async disconnect(): Promise<void> {
      if (ws) {
        ws.close();
        ws = null;
      }
      isConnectedFlag = false;
      settleActiveSynthesis('stopped');
      isSpeakingFlag = false;
      currentContextId = null;
    },
    speak(
      text: string,
      options?: CartesiaSpeechOptions,
    ): SpeechSynthesisHandle {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw createTTSError(
          'cartesia',
          'transport',
          'Not connected to Cartesia',
        );
      }

      const voiceId = options?.voice || defaultVoiceId;
      if (!voiceId) {
        throw createTTSError('cartesia', 'parse', 'Voice ID is required');
      }

      const isContinuing = options?.continue ?? false;
      let resolveCompletion!: (reason: 'completed' | 'stopped') => void;
      const completion = new Promise<'completed' | 'stopped'>((resolve) => {
        resolveCompletion = resolve;
      });

      if (activeSynthesis && !activeSynthesis.completionSettled) {
        settleActiveSynthesis('stopped');
      }

      if (!currentContextId) {
        // WHY: Cartesia groups streamed chunks by `context_id`. Reusing the same context within one
        // spoken turn allows continuation and cancel to target the correct provider-side stream.
        currentContextId = generateContextId();
        isSpeakingFlag = true;
      }

      activeSynthesis = {
        resolveCompletion,
        completionSettled: false,
      };

      const request: CartesiaRequest = {
        model_id: modelId,
        transcript: text,
        voice: {
          mode: 'id',
          id: voiceId,
        },
        language: options?.language || language,
        output_format: {
          container: 'raw',
          encoding: 'pcm_f32le',
          sample_rate: options?.sampleRate || sampleRate,
        },
        context_id: currentContextId,
        continue: isContinuing,
        ...(options?.flush && { flush: true }),
        ...(options?.speed && { speed: options.speed }),
      };

      try {
        ws.send(JSON.stringify(request));
      } catch (error) {
        resetActiveSynthesis('stopped');
        emitTransportFailure('Cartesia WebSocket send failed', error);
        throw createTTSError(
          'cartesia',
          'transport',
          'Cartesia WebSocket send failed',
          error,
        );
      }

      return {
        speech: {
          text,
          format: 'pcm_f32le',
          sampleRate,
        },
        completion,
      };
    },
    stop(): void {
      if (!isSpeakingFlag) {
        return;
      }

      if (ws && ws.readyState === WebSocket.OPEN && currentContextId) {
        // WHY: Stopping sends a provider cancel before local state resets so the remote stream stops
        // generating more chunks for a turn the runtime has already decided to abandon.
        try {
          ws.send(
            JSON.stringify({
              context_id: currentContextId,
              cancel: true,
            }),
          );
        } catch (error) {
          emitTransportFailure('Cartesia WebSocket cancel failed', error);
        }
      }
      resetActiveSynthesis('stopped');
    },
    onEvent(callback: (event: TTSEvent) => void): () => void {
      eventListeners.add(callback);
      return () => eventListeners.delete(callback);
    },
    isConnected(): boolean {
      return isConnectedFlag;
    },
  };
}
