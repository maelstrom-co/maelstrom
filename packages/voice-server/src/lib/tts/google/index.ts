import { protos, TextToSpeechClient } from '@google-cloud/text-to-speech';

import { parseGoogleCredentialsJSON } from '../../google/credentials.js';
import { classifyTTSError, createTTSError } from '../../provider-errors.js';
import type {
  SpeechChunk,
  SpeechOptions,
  SpeechSynthesisHandle,
  TTSEvent,
  TTSProvider,
} from '../../types.js';

const wavHeaderLengthBytes = 44;
const chunkSizeBytes = 16000 * 4;

/**
 * Configuration for the Google TTS provider.
 *
 * WHY: Google TTS is batch-oriented rather than truly streaming, so these options mostly define how
 * a synthesized turn should be shaped before the runtime converts it into chunk events that match
 * the rest of the package.
 */
export interface GoogleTTSOptions {
  /** Service account JSON used when application-default credentials are not available. */
  credentialsJSON?: string;
  /** Default Google voice name used when per-turn options do not specify one. */
  defaultVoiceName?: string;
  /** Default language code for synthesized turns. */
  language?: string;
  /** Default output sample rate requested from Google. */
  sampleRate?: number;
}

function decodeAudioContent(audioContent: unknown): Uint8Array {
  if (!audioContent) {
    return new Uint8Array(0);
  }

  if (audioContent instanceof Uint8Array) {
    return audioContent;
  }

  if (typeof audioContent === 'string') {
    return Uint8Array.from(Buffer.from(audioContent, 'base64'));
  }

  if (Array.isArray(audioContent)) {
    return Uint8Array.from(audioContent);
  }

  throw new Error('Google TTS returned unsupported audioContent format');
}

function stripWavHeader(audioContent: Uint8Array): Uint8Array {
  if (audioContent.length <= wavHeaderLengthBytes) {
    return audioContent;
  }

  // WHY: Google returns LINEAR16 inside a WAV container. The shared runtime wants raw PCM frames so
  // playback adapters do not have to special-case one provider's file wrapper.
  return audioContent.slice(wavHeaderLengthBytes);
}

function linear16ToPcmF32le(audioContent: Uint8Array): Uint8Array {
  const sampleCount = Math.floor(audioContent.byteLength / 2);
  const input = new DataView(
    audioContent.buffer,
    audioContent.byteOffset,
    audioContent.byteLength,
  );
  const outputBuffer = new ArrayBuffer(sampleCount * 4);
  const output = new DataView(outputBuffer);

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = input.getInt16(i * 2, true);
    output.setFloat32(i * 4, sample / 32768, true);
  }

  return new Uint8Array(outputBuffer);
}

/**
 * Creates a Google TTS provider that adapts batch synthesis into the package's speaking state model.
 *
 * @remarks
 * Google returns complete audio payloads, but the rest of voice-server expects turn-oriented TTS
 * events. This provider bridges that mismatch by chunking the synthesized PCM output and by tracking
 * interruption with request ids so newer speech can replace older turns safely.
 */
export function createGoogleTTS(options: GoogleTTSOptions = {}): TTSProvider {
  const {
    credentialsJSON,
    defaultVoiceName,
    language = 'en-US',
    sampleRate = 16000,
  } = options;

  let client: TextToSpeechClient | null = null;
  /** True once a client has been created and the provider can accept synthesize requests. */
  let isConnectedFlag = false;
  /** Monotonic turn token used to invalidate stale synthesis results after stop/replace. */
  let activeRequestId = 0;
  let activeRequest: {
    id: number;
    resolveCompletion: (reason: 'completed' | 'stopped') => void;
    completionSettled: boolean;
  } | null = null;
  const listeners = new Set<(event: TTSEvent) => void>();

  function emit(event: TTSEvent) {
    listeners.forEach((cb) => {
      cb(event);
    });
  }

  function settleActiveRequest(
    reason: 'completed' | 'stopped',
    requestId?: number,
  ) {
    if (!activeRequest || activeRequest.completionSettled) {
      return;
    }

    if (requestId !== undefined && activeRequest.id !== requestId) {
      return;
    }

    activeRequest.completionSettled = true;
    activeRequest.resolveCompletion(reason);
    activeRequest = null;
  }

  async function getClient(): Promise<TextToSpeechClient> {
    if (client) {
      return client;
    }

    const parsedCredentials = parseGoogleCredentialsJSON(credentialsJSON);
    client = new TextToSpeechClient(
      parsedCredentials
        ? {
            credentials: parsedCredentials,
          }
        : undefined,
    );
    return client;
  }

  return {
    name: 'google',
    capabilities: {
      streamingTts: false,
    },
    async connect(): Promise<void> {
      await getClient();
      isConnectedFlag = true;
    },
    async disconnect(): Promise<void> {
      activeRequestId += 1;
      settleActiveRequest('stopped');
      isConnectedFlag = false;
      if (client) {
        await client.close();
      }
      client = null;
      emit({
        type: 'disconnected',
        clean: true,
        reason: 'clean_shutdown',
        message: 'Google TTS disconnected cleanly',
      } as TTSEvent);
    },
    speak(text: string, speakOptions?: SpeechOptions): SpeechSynthesisHandle {
      if (!isConnectedFlag) {
        throw createTTSError(
          'google',
          'transport',
          'Google TTS is not connected',
        );
      }

      const resolvedSampleRate = speakOptions?.sampleRate || sampleRate;
      const requestId = activeRequestId + 1;
      activeRequestId = requestId;
      settleActiveRequest('stopped');
      let resolveCompletion!: (reason: 'completed' | 'stopped') => void;
      const completion = new Promise<'completed' | 'stopped'>((resolve) => {
        resolveCompletion = resolve;
      });
      activeRequest = {
        id: requestId,
        resolveCompletion,
        completionSettled: false,
      };

      void (async () => {
        try {
          const textToSpeechClient = await getClient();
          const [response] = await textToSpeechClient.synthesizeSpeech({
            input: { text },
            voice: {
              languageCode: speakOptions?.language || language,
              name: speakOptions?.voice || defaultVoiceName,
            },
            audioConfig: {
              audioEncoding:
                protos.google.cloud.texttospeech.v1.AudioEncoding.LINEAR16,
              sampleRateHertz: resolvedSampleRate,
              speakingRate: speakOptions?.speed,
            },
          });

          if (activeRequestId !== requestId) {
            // WHY: Google synthesis is batch work that cannot be cancelled mid-request. The request id
            // guard prevents a slow, older reply from surfacing after a newer turn has already won.
            return;
          }

          const audioContent = response.audioContent;
          const audioBytes = decodeAudioContent(audioContent);
          const pcmAudio = linear16ToPcmF32le(stripWavHeader(audioBytes));

          if (pcmAudio.length === 0) {
            settleActiveRequest('completed', requestId);
            return;
          }

          let sequence = 0;
          for (
            let offset = 0;
            offset < pcmAudio.length;
            offset += chunkSizeBytes
          ) {
            sequence += 1;
            const chunkBytes = pcmAudio.slice(offset, offset + chunkSizeBytes);
            const chunk: SpeechChunk = {
              data: chunkBytes,
              format: 'pcm_f32le',
              sampleRate: resolvedSampleRate,
              isFinal: offset + chunkSizeBytes >= pcmAudio.length,
              sequence,
            };
            emit({ type: 'chunk', chunk });
          }

          settleActiveRequest('completed', requestId);
        } catch (error) {
          if (activeRequestId !== requestId) {
            return;
          }

          settleActiveRequest('stopped', requestId);
          emit({
            type: 'error',
            error: classifyTTSError(error, 'google'),
          });
        }
      })();

      return {
        speech: {
          text,
          format: 'pcm_f32le',
          sampleRate: resolvedSampleRate,
        },
        completion,
      };
    },
    stop(): void {
      activeRequestId += 1;
      settleActiveRequest('stopped');
    },
    onEvent(callback: (event: TTSEvent) => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    isConnected(): boolean {
      return isConnectedFlag;
    },
  };
}
