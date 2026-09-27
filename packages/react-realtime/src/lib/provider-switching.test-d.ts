import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';

import type { UseVoiceResult } from '../index.js';
import { maelstromRealtime } from '../index.js';

declare const adapter: RealtimeProviderAdapter;

maelstromRealtime({
  providers: ['live', 'realtime'],
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
    return undefined;
  },
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
