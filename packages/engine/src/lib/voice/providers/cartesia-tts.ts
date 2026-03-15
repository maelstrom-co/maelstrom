/**
 * Cartesia Text-to-Speech provider with WebSocket support.
 *
 * This provider uses Cartesia's WebSocket API for real-time streaming
 * speech generation with the Sonic-3 model.
 *
 * Features:
 * - Persistent WebSocket connection for low latency
 * - Context-based streaming for seamless prosody
 * - Request cancellation support
 * - Flush IDs for tracking audio chunks per transcript
 *
 * @example
 * ```typescript
 * const tts = createCartesiaTTS({
 *   apiKey: process.env.CARTESIA_API_KEY,
 *   voiceId: 'default',
 * });
 *
 * await tts.connect();
 *
 * tts.onEvent((event) => {
 *   if (event.type === 'chunk') {
 *     // Play audio chunk
 *     playAudio(event.chunk.data);
 *   }
 * });
 *
 * // Speak text
 * tts.speak('Hello, how can I help you today?', {
 *   voice: 'default',
 *   speed: 1.0,
 * });
 *
 * // Stream text in parts (for real-time LLM responses)
 * tts.speak('Hello,', { voice: 'default', continue: true });
 * tts.speak(' how can', { voice: 'default', continue: true });
 * tts.speak(' I help you?', { voice: 'default', continue: false });
 * ```
 */

import type {
  SpeechChunk,
  SpeechOptions,
  TTSEvent,
  TTSProvider,
} from '../types.js';

export interface CartesiaTTSOptions {
  /** Cartesia API key (defaults to CARTESIA_API_KEY env var) */
  apiKey?: string;
  /** Default voice ID to use */
  defaultVoiceId?: string;
  /** Model ID (default: 'sonic-3') */
  modelId?: string;
  /** Default language (default: 'en') */
  language?: string;
  /** Output sample rate (default: 24000) */
  sampleRate?: number;
}

/**
 * Extended speech options for Cartesia with streaming support.
 */
export interface CartesiaSpeechOptions extends SpeechOptions {
  /**
   * Whether more text will follow on the same context.
   * Set to true when streaming LLM output in chunks.
   * @default false
   */
  continue?: boolean;
  /**
   * Force a flush to create a new flush_id boundary.
   * Useful for tracking audio chunks per transcript.
   * @default false
   */
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

/**
 * Creates a Cartesia TTS provider with WebSocket support.
 */
export function createCartesiaTTS(
  options: CartesiaTTSOptions = {},
): TTSProvider {
  const {
    apiKey = process.env.CARTESIA_API_KEY,
    defaultVoiceId,
    modelId = 'sonic-3',
    language = 'en',
    sampleRate = 44100,
  } = options;

  if (!apiKey) {
    throw new Error(
      'Cartesia API key is required. Set CARTESIA_API_KEY environment variable or pass apiKey option.',
    );
  }

  let ws: WebSocket | null = null;
  let isConnectedFlag = false;
  let isSpeakingFlag = false;
  let currentContextId: string | null = null;
  let chunkSequence = 0;
  const eventListeners = new Set<(event: TTSEvent) => void>();

  function emit(event: TTSEvent) {
    eventListeners.forEach((cb) => {
      cb(event);
    });
  }

  function generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  function handleMessage(data: unknown) {
    try {
      const message = JSON.parse(String(data)) as CartesiaWebSocketMessage;

      // Handle binary audio data (base64 encoded in the message)
      if (message.type === 'chunk' && message.data) {
        // Decode base64 audio data
        const binaryString = atob(message.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const chunk: SpeechChunk = {
          data: bytes,
          format: 'pcm_f32le',
          sampleRate,
          isFinal: false,
          sequence: chunkSequence++,
        };

        emit({ type: 'chunk', chunk });
      }

      // Handle completion
      if (message.done) {
        isSpeakingFlag = false;

        // Emit final empty chunk
        const finalChunk: SpeechChunk = {
          data: new Uint8Array(0),
          format: 'pcm_f32le',
          sampleRate,
          isFinal: true,
          sequence: chunkSequence,
        };
        emit({ type: 'chunk', chunk: finalChunk });

        emit({ type: 'completed' });

        // Context expires 1 second after completion
        setTimeout(() => {
          currentContextId = null;
        }, 1000);
      }

      // Handle errors
      if (message.error) {
        isSpeakingFlag = false;
        emit({ type: 'error', error: new Error(message.error) });
      }
    } catch (error) {
      emit({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return {
    name: 'cartesia',

    async connect(): Promise<void> {
      if (ws?.readyState === WebSocket.OPEN) {
        return;
      }

      const wsUrl = `wss://api.cartesia.ai/tts/websocket?api_key=${apiKey}&cartesia_version=2024-06-10`;

      return new Promise((resolve, reject) => {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          isConnectedFlag = true;
          emit({ type: 'connected' });
          resolve();
        };

        ws.onmessage = (event) => {
          handleMessage(event.data);
        };

        ws.onerror = (_error) => {
          const err = new Error('Cartesia WebSocket error');
          emit({ type: 'error', error: err });
          reject(err);
        };

        ws.onclose = () => {
          isConnectedFlag = false;
          isSpeakingFlag = false;
          currentContextId = null;
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
      isSpeakingFlag = false;
      currentContextId = null;
      emit({ type: 'disconnected' });
    },

    speak(text: string, options?: CartesiaSpeechOptions): void {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        emit({ type: 'error', error: new Error('Not connected to Cartesia') });
        return;
      }

      const voiceId = options?.voice || defaultVoiceId;
      if (!voiceId) {
        emit({ type: 'error', error: new Error('Voice ID is required') });
        return;
      }

      // Create new context if needed
      const isContinuing = options?.continue ?? false;
      if (!currentContextId) {
        currentContextId = generateContextId();
        isSpeakingFlag = true;
        emit({ type: 'started', text });
      }

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

      ws.send(JSON.stringify(request));

      // If not continuing, clear context after sending
      if (!isContinuing) {
        // Context will be cleared after 'done' message
      }
    },

    stop(): void {
      if (ws && ws.readyState === WebSocket.OPEN && currentContextId) {
        // Send cancel request for current context
        ws.send(
          JSON.stringify({
            context_id: currentContextId,
            cancel: true,
          }),
        );
      }
      isSpeakingFlag = false;
      currentContextId = null;
      emit({ type: 'stopped' });
    },

    onEvent(callback: (event: TTSEvent) => void): () => void {
      eventListeners.add(callback);
      return () => eventListeners.delete(callback);
    },

    isConnected(): boolean {
      return isConnectedFlag;
    },

    isSpeaking(): boolean {
      return isSpeakingFlag;
    },

    get ws() {
      return ws;
    },
  } as TTSProvider;
}
