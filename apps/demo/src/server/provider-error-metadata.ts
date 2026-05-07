import type { VoiceProviderErrorKind } from '@maelstrom-co/voice-server';

export type ProviderErrorMetadata = {
  kind?: VoiceProviderErrorKind;
  source?: 'stt' | 'tts';
  provider?: string;
};

type ProviderErrorCandidate = Error & ProviderErrorMetadata;

function isProviderErrorCandidate(
  error: unknown,
): error is ProviderErrorCandidate {
  return (
    error instanceof Error &&
    'source' in error &&
    'kind' in error &&
    'provider' in error
  );
}

export function getProviderErrorMetadata(
  error: unknown,
): ProviderErrorMetadata | undefined {
  if (!isProviderErrorCandidate(error)) {
    return undefined;
  }

  return {
    kind: error.kind,
    source: error.source,
    provider: error.provider,
  };
}

export function isProviderError(
  error: unknown,
): error is ProviderErrorCandidate {
  return isProviderErrorCandidate(error);
}
