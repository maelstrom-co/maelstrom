import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';

import type { MaelstromRealtimeOptions, UseVoiceResult } from '../index.js';
import { maelstromRealtime } from '../index.js';

declare const adapter: RealtimeProviderAdapter;

declare const configuredOptions: MaelstromRealtimeOptions<'live' | 'realtime'>;
const configuredExtension = maelstromRealtime(configuredOptions);
declare const configuredVoice: ReturnType<
  ReturnType<typeof configuredExtension>['useVoice']
>;
void configuredVoice.switchProvider('realtime');
// @ts-expect-error An options variable still preserves its provider union.
void configuredVoice.switchProvider('livekit');

maelstromRealtime({
  initialProvider: 'live',
  createAdapter: ({ provider }) => {
    const known: 'live' = provider;
    void known;
    return adapter;
  },
});

maelstromRealtime({
  initialProvider: () => 'live',
  createAdapter: ({ provider }) => {
    const known: 'live' = provider;
    void known;
    return adapter;
  },
});

maelstromRealtime({
  providers: ['live', 'realtime'],
  initialProvider: () => 'live',
  createAdapter: ({ provider }) => {
    const known: 'live' | 'realtime' = provider;
    void known;
    return adapter;
  },
  opening: ({ provider }) =>
    provider === 'live'
      ? { generatedOpening: { instructions: 'Introduce yourself.' } }
      : { greeting: { text: 'Hello.' } },
  onSession: (_session, { instanceId, adapter: built }) => {
    void instanceId;
    void built;
  },
});

// @ts-expect-error The initial selection cannot widen the provider list.
maelstromRealtime({
  providers: ['live', 'realtime'],
  initialProvider: 'typo',
  createAdapter: () => adapter,
});

// @ts-expect-error Lazy initial selection must also stay within the list.
maelstromRealtime({
  providers: ['live', 'realtime'],
  initialProvider: () => 'typo',
  createAdapter: () => adapter,
});

// @ts-expect-error opening decides the greeting; the fixed options are excluded.
maelstromRealtime({
  createAdapter: () => adapter,
  opening: () => undefined,
  greeting: { text: 'Hello.' },
});

maelstromRealtime({
  createAdapter: () => adapter,
  // @ts-expect-error An opening chooses one mode.
  opening: () => ({
    greeting: { text: 'Hello.' },
    generatedOpening: { instructions: 'Introduce yourself.' },
  }),
});

declare const voice: UseVoiceResult<'live' | 'realtime'>;
void voice.switchProvider('realtime');
// @ts-expect-error Only listed providers can be selected.
void voice.switchProvider('livekit');
