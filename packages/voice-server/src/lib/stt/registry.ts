import {
  createDeepgramSTT,
  type DeepgramSTTOptions,
} from './deepgram/index.js';
import { createGoogleSTT, type GoogleSTTOptions } from './google/index.js';
import type { STTProvider } from '../types.js';

/** Shared STT options accepted by every built-in provider. */
export interface BaseSTTOptions {
  interimResults?: boolean;
}

type STTProviderOptionsMap = {
  deepgram: BaseSTTOptions & DeepgramSTTOptions;
  google: BaseSTTOptions & GoogleSTTOptions;
};

type STTProviderFactoryMap = {
  [ProviderType in keyof STTProviderOptionsMap]: (
    options: STTProviderOptionsMap[ProviderType],
  ) => STTProvider;
};

export const sttProviderFactories = {
  deepgram: createDeepgramSTT,
  google: createGoogleSTT,
} satisfies STTProviderFactoryMap;

/** Supported built-in STT provider discriminants. */
export type STTProviderType = keyof typeof sttProviderFactories;

/**
 * Discriminated configuration for constructing an STT provider.
 *
 * @example
 * const stt = createSTT({
 *   type: 'deepgram',
 *   options: { apiKey: 'deepgram-key', vadEvents: true },
 * });
 */
export type STTProviderConfig = {
  [TType in STTProviderType]: {
    type: TType;
    options: STTProviderOptionsMap[TType];
  };
}[STTProviderType];

function assertNeverProviderType(value: never): never {
  const badType = (value as { type?: unknown } | null | undefined)?.type;
  const supported = Object.keys(sttProviderFactories).join(', ');
  throw new Error(
    `Unsupported STT provider type: ${String(badType)}. Supported: ${supported}`,
  );
}

/**
 * Constructs an STT provider from a discriminated config.
 *
 * Use this instead of reaching into the provider factory map directly so the
 * public API stays centered on the validated `{ type, options }` contract.
 *
 * @example
 * const stt = createSTT({
 *   type: 'google',
 *   options: { projectId: 'project-123', interimResults: true },
 * });
 */
export function createSTT(config: STTProviderConfig): STTProvider {
  switch (config.type) {
    case 'deepgram':
      return sttProviderFactories.deepgram(config.options);
    case 'google':
      return sttProviderFactories.google(config.options);
    default:
      return assertNeverProviderType(config);
  }
}
