# Extend a React instance with optional voice

Create the extension once outside component rendering. Supply the selected
adapter through the factory. The empty registry below is a construction fragment;
use your existing Vessel entries in an application.

```ts
import { createMaelstrom } from '@maelstrom-co/react';
import { type CreateAdapterContext, maelstromRealtime } from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';

export function createVoiceUi(
  createAdapter: (context: CreateAdapterContext) => RealtimeProviderAdapter,
) {
  return createMaelstrom({ vessels: [] }).with(maelstromRealtime({ createAdapter }));
}
```

Keep credentials in the adapter's server minter, not in React props or bundles.
Inside the scoped Provider, read `m.useVoice()` state and bounded error copy.
Connect only from the authorized interaction; an orb is not a connection proof.

## Verify

Test hook consumers sharing one session, cleanup, reconnect races, and independent
microphone/provider failures. Manual controls depend on runtime `turnControl`, not
a fixed provider label. Test greeting presentation separately from voice state.

## Troubleshoot

A resolved connect attempt does not verify the Engine path. Raw error diagnostics
can contain provider details; render bounded copy. Keep the factory stable so
rendering does not construct competing provider lifetimes.
