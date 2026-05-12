import { classifySTTError, createSTTError } from '../../provider-errors.js';
import type {
  AudioChunk,
  STTError,
  STTEvent,
  STTProvider,
  TranscriptionResult,
} from '../../types.js';
import { createWebSocket } from '../../websocket.js';

/**
 * Configuration options for Deepgram STT provider.
 *
 * WHY: Keyterms stay on the base provider options because callers often need to inject domain
 * vocabulary at connect time, and splitting that into a separate factory would create a parallel
 * setup path for the same transport.
 */
export interface DeepgramSTTOptions {
  /** Deepgram API key from https://deepgram.com */
  apiKey?: string;
  /** Deepgram WebSocket base URL (default: wss://api.deepgram.com) */
  baseUrl?: string;
  /** Model to use (default: nova-3, faster and more accurate) */
  model?: string;
  /** Enable smart formatting (default: true) */
  smartFormat?: boolean;
  /** Enable interim results for real-time feedback (default: true) */
  interimResults?: boolean;
  /** Input audio sample rate (default: 16000) */
  sampleRate?: number;
  /** Static keyterms for Nova-3 / Flux query-time prompting */
  keyterms?: string[];
  /** Dynamic keyterms resolved on each connect before the websocket opens */
  keytermsProvider?: () => Promise<string[]>;
  /** Enable Deepgram speech-start VAD events */
  vadEvents?: boolean;
  /** Configure Deepgram endpointing behavior */
  endpointing?: number | false;
  /** Configure Deepgram utterance end gap detection in milliseconds */
  utteranceEndMs?: number;
  /** WebSocket connection timeout in seconds */
  connectionTimeoutInSeconds?: number;
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
    throw new Error(`Deepgram message field \`${field}\` must be a string`);
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
    throw new Error(`Deepgram message field \`${field}\` must be a number`);
  }

  return candidate;
}

function readRequiredBoolean(
  value: Record<string, unknown>,
  field: string,
): boolean {
  const candidate = value[field];
  if (typeof candidate !== 'boolean') {
    throw new Error(`Deepgram message field \`${field}\` must be a boolean`);
  }

  return candidate;
}

function isKnownRecoverableIdleClose(event: CloseEvent): boolean {
  if (event.code !== 1011 && event.code !== 1000) {
    return false;
  }

  const normalizedReason = event.reason.trim().toLowerCase();

  return (
    normalizedReason === 'net-0000' ||
    normalizedReason.includes('idle') ||
    normalizedReason.includes('inactivity') ||
    normalizedReason.includes('no audio') ||
    normalizedReason.includes('timeout')
  );
}

/**
 * Creates a Deepgram STT provider instance.
 *
 * Why Deepgram:
 * - Real-time streaming with low latency
 * - Excellent accuracy with smart formatting
 * - interimResults support for live UI feedback
 *
 * Keyterms can be supplied directly through DeepgramSTTOptions.
 */
export function createDeepgramSTT(
  options: DeepgramSTTOptions = {},
): STTProvider {
  const {
    apiKey = process.env.DEEPGRAM_API_KEY,
    baseUrl = 'wss://api.deepgram.com',
    model = 'nova-3',
    smartFormat = true,
    interimResults = true,
    sampleRate = 16000,
    keyterms = [],
    keytermsProvider,
    vadEvents = false,
    endpointing,
    utteranceEndMs,
    connectionTimeoutInSeconds = 10,
  } = options;

  if (!apiKey) {
    throw new Error(
      'Deepgram API key is required. Set DEEPGRAM_API_KEY environment variable or pass apiKey option.',
    );
  }

  let ws: WebSocket | null = null;
  /** True once the provider WebSocket is open and ready to receive audio. */
  let isConnectedFlag = false;
  const eventListeners = new Set<(event: STTEvent) => void>();

  function emit(event: STTEvent) {
    eventListeners.forEach((cb) => {
      cb(event);
    });
  }

  async function resolveKeyterms(): Promise<string[]> {
    const dynamicKeyterms = keytermsProvider ? await keytermsProvider() : [];

    return [...keyterms, ...dynamicKeyterms]
      .map((keyterm) => keyterm.trim())
      .filter((keyterm) => keyterm.length > 0);
  }

  function appendQueryValues(
    params: URLSearchParams,
    name: string,
    values: string[],
  ) {
    for (const value of values) {
      params.append(name, value);
    }
  }

  function getMessageError(data: unknown): STTError | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const record = data as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : undefined;
    const candidates = [
      record.err_msg,
      record.error,
      record.message,
      record.description,
      record.details,
    ];

    const message = candidates.find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    if (type === 'Error' || type === 'error') {
      return classifySTTError(
        new Error(message ?? 'Deepgram reported a streaming error'),
        'deepgram',
      );
    }

    return null;
  }

  function parseResultsMessage(
    message: Record<string, unknown>,
  ): TranscriptionResult | null {
    const type = readOptionalString(message, 'type');
    if (type !== 'Results') {
      return null;
    }

    const isFinal = readRequiredBoolean(message, 'is_final');
    const channel = message.channel;
    if (!isRecord(channel)) {
      throw new Error('Deepgram Results message must include a channel object');
    }

    const alternatives = channel.alternatives;
    if (!Array.isArray(alternatives)) {
      throw new Error(
        'Deepgram Results message must include a channel.alternatives array',
      );
    }

    const firstAlternative = alternatives[0];
    if (!isRecord(firstAlternative)) {
      throw new Error(
        'Deepgram Results message must include an alternatives[0] object',
      );
    }

    const transcript = readOptionalString(firstAlternative, 'transcript');
    if (transcript === undefined) {
      return null;
    }

    return {
      text: transcript,
      isFinal,
      confidence: readOptionalNumber(firstAlternative, 'confidence'),
      language: readOptionalString(channel, 'detected_language'),
      durationInSeconds: readOptionalNumber(message, 'duration'),
    };
  }

  async function buildConnectionUrl(language: string): Promise<string> {
    const params = new URLSearchParams({
      model,
      language,
      smart_format: String(smartFormat),
      interim_results: String(interimResults),
      encoding: 'linear16',
      sample_rate: String(sampleRate),
      channels: '1',
    });

    appendQueryValues(params, 'keyterm', await resolveKeyterms());

    if (vadEvents) {
      params.set('vad_events', 'true');
    }
    if (endpointing !== undefined) {
      params.set('endpointing', String(endpointing));
    }
    if (interimResults && utteranceEndMs !== undefined) {
      params.set('utterance_end_ms', String(utteranceEndMs));
    }

    return `${baseUrl}/v1/listen?${params.toString()}`;
  }

  /**
   * Translates provider payloads into the shared transcription state model.
   *
   * WHY: Deepgram can emit a mix of partial and final results with provider-specific payload shapes.
   * Converting them here keeps the runtime focused on state transitions instead of vendor payloads.
   */
  function handleMessage(data: unknown) {
    try {
      const parsed = JSON.parse(String(data)) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('Deepgram message must be a JSON object');
      }

      const result = parseResultsMessage(parsed);
      if (result) {
        emit({ type: 'transcript', result });
        return;
      }

      const providerError = getMessageError(parsed);
      if (providerError) {
        emit({ type: 'error', error: providerError });
      }
    } catch (error) {
      emit({
        type: 'error',
        error: classifySTTError(error, 'deepgram'),
      });
    }
  }

  return {
    name: 'deepgram',
    capabilities: {
      interimTranscripts: interimResults,
    },
    async connect(config?: { language?: string }): Promise<void> {
      if (ws?.readyState === WebSocket.OPEN) {
        return;
      }

      const language = config?.language || 'en';
      const wsUrl = await buildConnectionUrl(language);

      await new Promise<void>((resolve, reject) => {
        ws = createWebSocket(wsUrl, {
          headers: {
            Authorization: `Token ${apiKey}`,
          },
        });

        let settled = false;
        let hasOpened = false;
        const timeout = setTimeout(() => {
          if (settled) {
            return;
          }

          if (ws && ws.readyState !== WebSocket.OPEN) {
            settled = true;
            const error = createSTTError(
              'deepgram',
              'transport',
              'Deepgram WebSocket connection timeout',
            );
            ws.close();
            reject(error);
          }
        }, connectionTimeoutInSeconds * 1000);

        ws.onopen = () => {
          if (settled) {
            return;
          }

          settled = true;
          hasOpened = true;
          clearTimeout(timeout);
          isConnectedFlag = true;
          resolve();
        };

        ws.onmessage = (event) => {
          handleMessage(event.data);
        };

        ws.onerror = () => {
          if (hasOpened) {
            emit({
              type: 'error',
              error: createSTTError(
                'deepgram',
                'transport',
                'Deepgram WebSocket error',
              ),
            });
            return;
          }

          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          const error = createSTTError(
            'deepgram',
            'transport',
            'Deepgram WebSocket error',
          );
          emit({ type: 'error', error });
          reject(error);
        };

        ws.onclose = (event) => {
          clearTimeout(timeout);

          if (!settled) {
            settled = true;
            isConnectedFlag = false;
            const reasonSuffix = event.reason ? `: ${event.reason}` : '';
            const error = createSTTError(
              'deepgram',
              'transport',
              `Deepgram WebSocket closed before ready (${event.code})${reasonSuffix}`,
            );
            emit({ type: 'error', error });
            reject(error);
            return;
          }

          if (!hasOpened) {
            isConnectedFlag = false;
            return;
          }

          isConnectedFlag = false;
          const reasonSuffix = event.reason ? `: ${event.reason}` : '';

          if (event.code !== 1000 && !isKnownRecoverableIdleClose(event)) {
            // WHY: Deepgram can proactively close idle streams with provider-specific 1011 reasons even
            // though the runtime may legitimately pause between turns. Those closes should drive normal
            // reconnect behavior, not surface as hard provider errors.
            emit({
              type: 'error',
              error: createSTTError(
                'deepgram',
                'transport',
                `Deepgram WebSocket closed unexpectedly (${event.code})${reasonSuffix}`,
              ),
            });
          }

          const recoverableIdleClose = isKnownRecoverableIdleClose(event);

          const disconnectedEvent = {
            type: 'disconnected',
            clean: event.code === 1000 || recoverableIdleClose,
            reason: recoverableIdleClose
              ? 'idle_timeout'
              : event.code === 1000
                ? 'clean_shutdown'
                : 'transport_lost',
            message: recoverableIdleClose
              ? `Deepgram WebSocket closed after idle timeout (${event.code})${reasonSuffix}`
              : event.code === 1000
                ? 'Deepgram WebSocket closed cleanly'
                : `Deepgram WebSocket closed unexpectedly (${event.code})${reasonSuffix}`,
          } as STTEvent;

          emit(disconnectedEvent);
        };
      });
    },
    async disconnect(): Promise<void> {
      if (ws) {
        ws.close();
        ws = null;
      }
      isConnectedFlag = false;
    },
    sendAudio(chunk: AudioChunk): void {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        emit({
          type: 'error',
          error: createSTTError(
            'deepgram',
            'transport',
            'Not connected to Deepgram',
          ),
        });
        return;
      }

      if (chunk.encoding !== 'linear16') {
        emit({
          type: 'error',
          error: createSTTError(
            'deepgram',
            'parse',
            `Deepgram STT only supports linear16 input, received ${chunk.encoding}`,
          ),
        });
        return;
      }

      if (chunk.sampleRate !== sampleRate) {
        emit({
          type: 'error',
          error: createSTTError(
            'deepgram',
            'parse',
            `Deepgram STT expected sampleRate ${sampleRate}, received ${chunk.sampleRate}`,
          ),
        });
        return;
      }

      ws.send(chunk.data);
    },
    endStream(): void {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // WHY: Deepgram treats an empty binary frame as end-of-stream, which flushes the current turn
        // without forcing the runtime to tear down and rebuild the websocket.
        ws.send(new Uint8Array(0));
      }
    },
    onEvent(callback: (event: STTEvent) => void): () => void {
      eventListeners.add(callback);
      return () => eventListeners.delete(callback);
    },
    isConnected(): boolean {
      return isConnectedFlag;
    },
  };
}
