import type {
  SpeechGenerationOptions,
  SpeechGenerationProvider,
  SpeechGenerationResult,
} from '../types.js';

/**
 * Options for creating a Cartesia TTS provider.
 */
export interface CartesiaTTSOptions {
  /**
   * Cartesia API key.
   * If not provided, will use CARTESIA_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Default voice ID to use.
   * See https://docs.cartesia.ai/build-with-cartesia/voices for available voices.
   */
  defaultVoiceId?: string;

  /**
   * Model ID to use. Defaults to 'sonic-2'.
   * Options: 'sonic', 'sonic-2', 'sonic-english', 'sonic-multilingual'
   */
  modelId?: string;

  /**
   * Default language code. Defaults to 'en'.
   */
  defaultLanguage?: string;

  /**
   * API version. Defaults to '2025-04-16'.
   */
  apiVersion?: string;

  /**
   * Output format configuration.
   * Defaults to mp3 at 44100 Hz.
   */
  outputFormat?: {
    container: 'raw' | 'mp3' | 'wav';
    encoding?: string;
    sample_rate: number;
  };
}

/**
 * Creates a speech generation provider using the Cartesia API.
 *
 * Cartesia provides ultra-low-latency, high-quality TTS with the Sonic model family.
 *
 * @example
 * ```typescript
 * const speechProvider = createCartesiaTTS({
 *   apiKey: process.env.CARTESIA_API_KEY,
 *   defaultVoiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091', // Example voice
 *   modelId: 'sonic-2',
 * });
 *
 * const result = await speechProvider.generateSpeech('Hello, world!');
 * // result.audioData contains the audio bytes
 * ```
 */
export function createCartesiaTTS(
  options: CartesiaTTSOptions = {},
): SpeechGenerationProvider {
  const {
    apiKey = process.env.CARTESIA_API_KEY,
    defaultVoiceId,
    modelId = 'sonic-2',
    defaultLanguage = 'en',
    apiVersion = '2025-04-16',
    outputFormat = { container: 'mp3', sample_rate: 44100 },
  } = options;

  if (!apiKey) {
    throw new Error(
      'Cartesia API key is required. Set CARTESIA_API_KEY environment variable or pass apiKey option.',
    );
  }

  return {
    async generateSpeech(
      text: string,
      genOptions?: SpeechGenerationOptions,
    ): Promise<SpeechGenerationResult> {
      const voiceId = genOptions?.voice ?? defaultVoiceId;
      const language = genOptions?.language ?? defaultLanguage;

      if (!voiceId) {
        throw new Error(
          'Voice ID is required. Set defaultVoiceId option or pass voice in options.',
        );
      }

      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Cartesia-Version': apiVersion,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: modelId,
          transcript: text,
          voice: {
            mode: 'id',
            id: voiceId,
          },
          language,
          output_format: outputFormat,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cartesia API error: ${response.status} - ${errorText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioData = new Uint8Array(audioBuffer);

      return {
        audioData,
        format: outputFormat.container,
        durationInSeconds: undefined, // Cartesia doesn't provide duration in response
      };
    },
  };
}
