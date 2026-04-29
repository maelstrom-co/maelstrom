import { type protos, v2 } from '@google-cloud/speech';

import { parseGoogleCredentialsJSON } from '../../google/credentials.js';
import type {
  AudioChunk,
  STTEvent,
  STTProvider,
  TranscriptionResult,
} from '../../types.js';

const maxStreamingMessageBytes = 25 * 1024;

/**
 * Configuration for the Google streaming STT provider.
 *
 * WHY: Google STT has more session-shaping knobs than the simpler WebSocket providers because the
 * caller may need to pin a recognizer, location, or phrase adaptation strategy. Those inputs alter
 * recognition state before any audio is sent, so they belong in the provider factory rather than in
 * per-chunk runtime calls.
 */
export interface GoogleSTTOptions {
  /** Service account JSON used when application-default credentials are not available. */
  credentialsJSON?: string;
  /** Google Cloud project that owns the Speech-to-Text recognizer. */
  projectId: string;
  /** Recognizer location, kept configurable because adaptation resources may be region-scoped. */
  location?: string;
  /** Recognizer id to target. `_` uses the implicit recognizer. */
  recognizerId?: string;
  /** Default language code when `connect()` does not override it for the session. */
  language?: string;
  /** Optional Google recognition model name. */
  model?: string;
  /** Whether Google should emit interim transcript hypotheses. */
  interimResults?: boolean;
  /** Static phrase hints merged into every stream config. */
  phraseHints?: string[];
  /** Async phrase-hint hook resolved right before the stream is configured. */
  phraseHintsProvider?: () => Promise<string[]>;
  /** Optional Google adaptation boost applied to each phrase hint. */
  phraseHintBoost?: number;
}

type GoogleStreamingRecognizeStream = ReturnType<
  v2.SpeechClient['streamingRecognize']
>;
type GoogleStreamingRecognizeRequest =
  protos.google.cloud.speech.v2.IStreamingRecognizeRequest;
type GoogleStreamingRecognizeResponse =
  protos.google.cloud.speech.v2.IStreamingRecognizeResponse;

function chunkAudioData(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  // WHY: Google's streaming RPC rejects oversized messages. Chunking here keeps the shared runtime
  // oblivious to provider-specific framing limits while still allowing large upstream audio buffers.
  for (
    let offset = 0;
    offset < data.length;
    offset += maxStreamingMessageBytes
  ) {
    chunks.push(data.slice(offset, offset + maxStreamingMessageBytes));
  }
  return chunks;
}

function buildRecognizerPath(
  projectId: string,
  location: string,
  recognizerId: string,
): string {
  return `projects/${projectId}/locations/${location}/recognizers/${recognizerId}`;
}

function buildPhraseSet(
  phraseHints: string[],
  phraseHintBoost?: number,
): protos.google.cloud.speech.v2.ISpeechAdaptation | undefined {
  if (phraseHints.length === 0) {
    return undefined;
  }

  return {
    phraseSets: [
      {
        inlinePhraseSet: {
          phrases: phraseHints.map((value) => ({
            value,
            boost: phraseHintBoost,
          })),
        },
      },
    ],
  };
}

/**
 * Creates a Google STT provider that adapts Google's streaming recognizer to the shared provider
 * state machine used by voice-server.
 *
 * @remarks
 * Google exposes a long-lived bidirectional stream whose recognition behavior is decided up front.
 * This provider turns that model into the package's simpler `connected` / `listening` / `error`
 * semantics so the runtime can swap providers without changing its turn-taking logic.
 */
export function createGoogleSTT(options: GoogleSTTOptions): STTProvider {
  const {
    credentialsJSON,
    projectId,
    location = 'global',
    recognizerId = '_',
    language = 'en-US',
    model,
    interimResults = true,
    phraseHints = [],
    phraseHintsProvider,
    phraseHintBoost,
  } = options;

  if (!projectId) {
    throw new Error('Google STT projectId is required');
  }

  let client: v2.SpeechClient | null = null;
  let stream: GoogleStreamingRecognizeStream | null = null;
  /** True once the bidirectional stream is configured and ready for audio writes. */
  let isConnectedFlag = false;
  let hasEmittedDisconnected = false;
  const listeners = new Set<(event: STTEvent) => void>();

  function emit(event: STTEvent) {
    listeners.forEach((cb) => {
      cb(event);
    });
  }

  function emitDisconnected() {
    if (hasEmittedDisconnected) {
      return;
    }

    hasEmittedDisconnected = true;
    emit({ type: 'disconnected' });
  }

  async function getClient(): Promise<v2.SpeechClient> {
    if (client) {
      return client;
    }

    const parsedCredentials = parseGoogleCredentialsJSON(credentialsJSON);
    client = new v2.SpeechClient(
      parsedCredentials
        ? {
            credentials: parsedCredentials,
          }
        : undefined,
    );
    return client;
  }

  /**
   * Normalizes Google stream callbacks into the shared STT event model.
   *
   * WHY: Google exposes transport lifecycle through Node stream events, but the runtime expects a
   * provider-neutral state machine. Translating those callbacks here keeps runtime logic stable even
   * if provider SDK details change.
   */
  function attachStream(streamInstance: GoogleStreamingRecognizeStream) {
    streamInstance.on('data', (response: GoogleStreamingRecognizeResponse) => {
      const results = response.results ?? [];
      for (const result of results) {
        const alternative = result.alternatives?.[0];
        const transcript = alternative?.transcript?.trim();
        if (!transcript) {
          continue;
        }

        const transcriptionResult: TranscriptionResult = {
          text: transcript,
          isFinal: Boolean(result.isFinal),
          confidence:
            typeof alternative?.confidence === 'number'
              ? alternative.confidence
              : undefined,
          language:
            typeof result.languageCode === 'string'
              ? result.languageCode
              : undefined,
        };
        emit({ type: 'transcript', result: transcriptionResult });
      }
    });

    streamInstance.on('error', (error: Error) => {
      emit({ type: 'error', error });
    });

    streamInstance.on('close', () => {
      stream = null;
      isConnectedFlag = false;
      emitDisconnected();
    });
  }

  /**
   * Builds the initial streaming config that defines recognition state for the whole session.
   *
   * WHY: Phrase hints, language, and model affect how the provider interprets every subsequent audio
   * frame, so they must be established before the stream enters its listening state.
   */
  async function buildStreamingConfig(
    connectLanguage?: string,
  ): Promise<GoogleStreamingRecognizeRequest> {
    const dynamicHints = phraseHintsProvider ? await phraseHintsProvider() : [];
    const normalizedHints = Array.from(
      new Set(
        [...phraseHints, ...dynamicHints]
          .map((hint) => hint.trim())
          .filter((hint) => hint.length > 0),
      ),
    );

    return {
      recognizer: buildRecognizerPath(projectId, location, recognizerId),
      streamingConfig: {
        config: {
          autoDecodingConfig: {},
          languageCodes: [connectLanguage || language],
          model,
          features: {
            profanityFilter: false,
            maxAlternatives: 1,
          },
          adaptation: buildPhraseSet(normalizedHints, phraseHintBoost),
        },
        streamingFeatures: {
          interimResults,
        },
      },
    };
  }

  return {
    name: 'google',
    capabilities: {
      interimTranscripts: interimResults,
    },
    async connect(config?: { language?: string }): Promise<void> {
      if (stream) {
        return;
      }

      const speechClient = await getClient();
      const nextStream = speechClient.streamingRecognize();
      attachStream(nextStream);
      stream = nextStream;

      // WHY: The first write establishes recognizer behavior for the lifetime of the stream. Audio
      // must never be sent before this config frame or Google will treat the request as malformed.
      nextStream.write(await buildStreamingConfig(config?.language));
      isConnectedFlag = true;
      hasEmittedDisconnected = false;
      emit({ type: 'connected' });
    },
    async disconnect(): Promise<void> {
      stream?.end();
      stream = null;
      isConnectedFlag = false;
      emitDisconnected();
      if (client) {
        await client.close();
      }
      client = null;
    },
    sendAudio(chunk: AudioChunk): void {
      if (!stream || !isConnectedFlag) {
        emit({
          type: 'error',
          error: new Error('Google STT stream is not connected'),
        });
        return;
      }

      const audioChunks = chunkAudioData(chunk.data);
      for (const audioChunk of audioChunks) {
        stream.write({
          audio: Buffer.from(audioChunk),
        });
      }
    },
    endStream(): void {
      if (stream) {
        stream.end();
      }
    },
    onEvent(callback: (event: STTEvent) => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    isConnected(): boolean {
      return isConnectedFlag;
    },
  };
}
