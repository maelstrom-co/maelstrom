import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';

// @ts-expect-error Browser VAD configuration moved to the LiveKit adapter.
type RemovedBrowserVadConfig = import('../index.js').BrowserVadConfig;
// @ts-expect-error Provider VAD tuning moved to the LiveKit adapter.
type RemovedBrowserVadOptions = import('../index.js').BrowserVadProviderOptions;
// @ts-expect-error maelstromRealtime now returns one extension shape.
type RemovedRealtimeBuilder = import('../index.js').MaelstromRealtimeBuilder;

import type { UseVoiceResult } from '../index.js';
import { maelstromRealtime } from '../index.js';

const extension = maelstromRealtime({ createAdapter: () => ({}) as never });
// @ts-expect-error React no longer owns browser VAD configuration.
extension.withVAD({ assetBaseUrl: '/vad-web/' });

declare const voice: UseVoiceResult;
// @ts-expect-error The provider-neutral diagnostic is turnModeError.
void voice.vadError;

declare const adapter: RealtimeProviderAdapter;
// @ts-expect-error Automatic turn control is adapter-private.
void adapter.automaticTurnControl;

void ({} as RemovedBrowserVadConfig);
void ({} as RemovedBrowserVadOptions);
void ({} as RemovedRealtimeBuilder);
