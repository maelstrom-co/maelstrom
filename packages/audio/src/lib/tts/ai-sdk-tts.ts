import type {
  SpeechGenerationOptions,
  SpeechGenerationProvider,
  SpeechGenerationResult,
} from '../types.js';

/**
 * Options for creating an AI SDK speech generation provider.
 */
export interface AISDKSpeechOptions {
  /**
   * The speech model to use.
   * Example: openai.speech('tts-1')
   */
  // biome-ignore lint/suspicious/noExplicitAny: Model type varies by provider
  model: any;

  /**
   * Default voice to use
   */
  defaultVoice?: string;

  /**
   * Default output format
   */
  defaultFormat?: 'mp3' | 'wav' | 'ogg' | 'opus';

  /**
   * Additional provider-specific options
   */
  providerOptions?: Record<string, unknown>;
}

/**
 * Creates a speech generation provider using the Vercel AI SDK.
 *
 * Supports multiple providers through the AI SDK:
 * - OpenAI TTS: openai.speech('tts-1') or openai.speech('tts-1-hd')
 * - ElevenLabs: elevenlabs.speech('eleven_multilingual_v2')
 * - Fal AI: fal.speech('fal-ai/minimax/speech-02-hd')
 *
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 *
 * const speechProvider = createAISDKSpeech({
 *   model: openai.speech('tts-1'),
 *   defaultVoice: 'alloy',
 * });
 *
 * const result = await speechProvider.generateSpeech('Hello, world!');
 * // result.audioData contains the audio bytes
 * ```
 */
export function createAISDKSpeech(
  options: AISDKSpeechOptions,
): SpeechGenerationProvider {
  const {
    model,
    defaultVoice,
    defaultFormat = 'mp3',
    providerOptions = {},
  } = options;

  return {
    async generateSpeech(
      text: string,
      genOptions?: SpeechGenerationOptions,
    ): Promise<SpeechGenerationResult> {
      // Dynamic import to avoid bundling ai in client builds
      const { experimental_generateSpeech } = await import('ai');

      const voice = genOptions?.voice ?? defaultVoice;
      const format = genOptions?.outputFormat ?? defaultFormat;

      // biome-ignore lint/suspicious/noExplicitAny: AI SDK providerOptions typing is strict
      const opts: any = {
        model,
        text,
        voice,
        outputFormat: format,
        speed: genOptions?.speed,
      };

      // Add providerOptions if present
      if (
        Object.keys(providerOptions).length > 0 ||
        genOptions?.providerOptions
      ) {
        opts.providerOptions = {
          ...providerOptions,
          ...(genOptions?.providerOptions ?? {}),
        };
      }

      const result = await experimental_generateSpeech(opts);

      // Convert the audio to Uint8Array
      // The result.audio is typically a base64 string or ArrayBuffer depending on provider
      let audioData: Uint8Array;

      if (result.audio instanceof Uint8Array) {
        audioData = result.audio;
      } else if (result.audio instanceof ArrayBuffer) {
        audioData = new Uint8Array(result.audio);
      } else if (typeof result.audio === 'string') {
        // Assume base64 encoded
        const binaryString = atob(result.audio);
        audioData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          audioData[i] = binaryString.charCodeAt(i);
        }
      } else {
        throw new Error('Unexpected audio format from AI SDK');
      }

      return {
        audioData,
        format,
        durationInSeconds: undefined, // AI SDK doesn't provide duration
      };
    },
  };
}
