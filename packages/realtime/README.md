# @maelstrom-co/realtime

Framework-agnostic realtime voice foundation for Maelstrom.

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol`

## What it does

This package hosts the provider-neutral session logic that turns adapter events
into Maelstrom intents, waits for successful UI updates to render before
returning their result, and keeps structural grounding separate from Engine
planning. Provider transports ship as sibling packages such as
`@maelstrom-co/realtime-openai` and `@maelstrom-co/realtime-livekit`.

- **`@maelstrom-co/realtime`** — provider-neutral `RealtimeSession`, adapter contract, and typed fatal errors
- **`@maelstrom-co/realtime-openai`** — OpenAI Realtime browser adapter
- **`@maelstrom-co/realtime-livekit`** — LiveKit browser adapter

Application code supplies a `RealtimeProviderAdapter` to `RealtimeSession`, or passes an adapter factory to [`@maelstrom-co/react-realtime`](https://docs.maelstrom-ai.co/reference/react-realtime/readme/). Provider adapters may expose different turn controls and state progressions; the core does not define a universal retry sequence.

The core has a single entry point and carries no provider-specific code. Add a
provider through its own packages, never through a subpath here. See
[`docs/adr/0001-realtime-providers-come-in-two-kinds.md`](../../docs/adr/0001-realtime-providers-come-in-two-kinds.md).

## Attach voice diagnostics without React

Attach `attachRealtimeDiagnostics` to an existing session and its owning client
before connecting. Supply a unique `providerInstanceId` for that session lifetime
and keep it separate from the application session ID. React realtime performs
this attachment automatically.

```ts
import type { Orchestrator } from '@maelstrom-co/client';
import {
  attachRealtimeDiagnostics,
  type RealtimeProviderAdapter,
  type RealtimeSession,
} from '@maelstrom-co/realtime';

export function observeVoice(
  orchestrator: Orchestrator,
  session: RealtimeSession,
  adapter: RealtimeProviderAdapter,
  provider: string,
  providerInstanceId: string,
) {
  return attachRealtimeDiagnostics({
    session,
    adapter,
    sink: orchestrator.diagnostics,
    identity: { provider, providerInstanceId },
  });
}
```

Call the returned retirement function when replacing the session or removing its
owner. It stops lifecycle, transcript, and provider observation immediately.
Accepted tool results can still arrive under their original provider identity and
session generation. Retirement does not wait for application work or disconnect
the session.

Collection sources activate only while the client channel has an observer.
Transcript content stays lazy, and attachment does not replay earlier fragments.
Provider diagnostics use a separate `providerGeneration` counter; it can differ
from the session's `generation`. Uncorrelated outcomes leave generation unknown.

## Docs

- Voice guide: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/

## License

MIT
