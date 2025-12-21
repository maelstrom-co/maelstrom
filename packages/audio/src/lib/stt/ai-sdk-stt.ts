import type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from '../types.js';

/**
 * Options for creating an AI SDK transcription provider.
 */
export interface AISDKTranscriptionOptions {
  /**
   * The transcription model to use.
   * Example: openai.transcription('whisper-1')
   */
  // biome-ignore lint/suspicious/noExplicitAny: Model type varies by provider
  model: any;

  /**
   * Default language for transcription (ISO-639-1 format, e.g., 'en')
   */
  defaultLanguage?: string;

  /**
   * Additional provider-specific options
   */
  providerOptions?: Record<string, unknown>;
}

/**
 * Creates a transcription provider using the Vercel AI SDK.
 *
 * Supports multiple providers through the AI SDK:
 * - OpenAI Whisper: openai.transcription('whisper-1')
 * - AssemblyAI: assemblyai.transcription('best')
 * - Rev.ai: revai.transcription('machine')
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 *
 * const transcriber = createAISDKTranscription({
 *   model: openai.transcription('whisper-1'),
 *   defaultLanguage: 'en',
 * });
 *
 * const result = await transcriber.transcribe(audioData);
 * console.log(result.text);
 * ```
 */
export function createAISDKTranscription(
  options: AISDKTranscriptionOptions,
): TranscriptionProvider {
  const { model, providerOptions = {} } = options;

  return {
    async transcribe(
      audio: Uint8Array | ArrayBuffer | URL | string,
      transcribeOptions?: TranscribeOptions,
    ): Promise<TranscriptionResult> {
      // Dynamic import to avoid bundling ai in client builds
      const { experimental_transcribe } = await import('ai');

      // Convert ArrayBuffer to Uint8Array if needed
      let audioData: Uint8Array | URL | string;
      if (audio instanceof ArrayBuffer) {
        audioData = new Uint8Array(audio);
      } else {
        audioData = audio;
      }

      // biome-ignore lint/suspicious/noExplicitAny: AI SDK providerOptions typing is strict
      const opts: any = {
        model,
        audio: audioData,
      };

      // Add providerOptions if present
      if (
        Object.keys(providerOptions).length > 0 ||
        transcribeOptions?.providerOptions
      ) {
        opts.providerOptions = {
          ...providerOptions,
          ...(transcribeOptions?.providerOptions ?? {}),
        };
      }

      const result = await experimental_transcribe(opts);

      return {
        text: result.text,
        isFinal: true,
        confidence: undefined, // AI SDK doesn't provide overall confidence
        language: result.language,
        durationInSeconds: result.durationInSeconds,
        segments: result.segments?.map((segment) => ({
          text: segment.text,
          startSecond: segment.startSecond,
          endSecond: segment.endSecond,
        })),
      };
    },
  };
}
