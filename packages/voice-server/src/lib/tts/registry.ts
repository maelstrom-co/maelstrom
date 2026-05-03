import type { TTSProvider } from '../types.js';
import {
  createCartesiaTTS,
  type CartesiaTTSOptions,
} from './cartesia/index.js';
import { createGoogleTTS, type GoogleTTSOptions } from './google/index.js';

/** Shared TTS options accepted by every built-in provider. */
export interface BaseTTSOptions {
  language?: string;
  sampleRate?: number;
}

type TTSProviderOptionsMap = {
  cartesia: CartesiaTTSOptions;
  google: GoogleTTSOptions;
};

type TTSProviderFactoryMap = {
  [ProviderType in keyof TTSProviderOptionsMap]: (
    options: TTSProviderOptionsMap[ProviderType],
  ) => TTSProvider;
};

export const ttsProviderFactories = {
  cartesia: createCartesiaTTS,
  google: createGoogleTTS,
} satisfies TTSProviderFactoryMap;

/** Supported built-in TTS provider discriminants. */
export type TTSProviderType = keyof typeof ttsProviderFactories;

/**
 * Discriminated configuration for constructing a TTS provider.
 *
 * @example
 * const tts = createTTS({
 *   type: 'cartesia',
 *   options: { apiKey: 'cartesia-key', defaultVoiceId: 'voice-123' },
 * });
 */
export type TTSProviderConfig = {
  [ProviderType in TTSProviderType]: {
    type: ProviderType;
    options: TTSProviderOptionsMap[ProviderType];
  };
}[TTSProviderType];

function assertNeverProviderType(value: never): never {
  const badType = (value as { type?: unknown } | null | undefined)?.type;
  const supported = Object.keys(ttsProviderFactories).join(', ');
  throw new Error(
    `Unsupported TTS provider type: ${String(badType)}. Supported: ${supported}`,
  );
}

/**
 * Constructs a TTS provider from a discriminated config.
 *
 * Use this instead of reaching into the provider factory map directly so the
 * public API stays centered on the validated `{ type, options }` contract.
 *
 * @example
 * const tts = createTTS({
 *   type: 'google',
 *   options: { defaultVoiceName: 'en-US-Chirp3-HD-Achernar' },
 * });
 */
export function createTTS(config: TTSProviderConfig): TTSProvider {
  switch (config.type) {
    case 'cartesia':
      return ttsProviderFactories.cartesia(config.options);
    case 'google':
      return ttsProviderFactories.google(config.options);
    default:
      return assertNeverProviderType(config);
  }
}
