import { DiagnosticCapture as CoreCapture } from '@maelstrom-co/devtools/production';

import { engineMetadata } from './engine-metadata';
import { playgroundKeyStore } from './playground-key-store';
import { DEFAULT_REALTIME_MODEL } from './realtime-model';
import {
  type DemoVoiceProvider,
  LIVE_BACKEND_MODEL,
  LIVE_MODEL,
  voiceProviderStore,
} from './voice-provider';
export class DiagnosticCapture extends CoreCapture {
  constructor(
    getKey: () => string | null = () => null,
    getProvider: () => DemoVoiceProvider = () =>
      voiceProviderStore.state.provider,
  ) {
    super(getKey, {
      metadata: (requestedMode) => {
        const mode =
          requestedMode === 'maelstrom' ? getProvider() : requestedMode;
        return {
          mode,
          voiceModel: mode === 'live' ? LIVE_MODEL : null,
          voiceModelSource: mode === 'live' ? 'configured' : 'unobserved',
          defaultVoiceModel:
            mode === 'realtime' ? DEFAULT_REALTIME_MODEL : undefined,
          managedModel: mode === 'live' ? LIVE_BACKEND_MODEL : null,
          engineModel:
            engineMetadata.getSnapshot()?.engineModel ??
            'unobserved: server-owned configuration',
          engineModelSource:
            engineMetadata.getSnapshot()?.source ?? 'unobserved',
        };
      },
    });
  }
}
export const diagnosticCapture = new DiagnosticCapture(
  () => playgroundKeyStore.state.apiKey,
);
