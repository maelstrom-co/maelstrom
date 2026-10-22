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
`@maelstrom-co/realtime-openai-live`, `@maelstrom-co/realtime-openai`, and
`@maelstrom-co/realtime-livekit`.

- **`@maelstrom-co/realtime`** — provider-neutral `RealtimeSession`, adapter contract, and typed fatal errors
- **`@maelstrom-co/realtime-openai-live`** — OpenAI Live browser adapter with a managed Responses backend
- **`@maelstrom-co/realtime-openai-live-server`** — server-only SDP exchange; never import into a browser
- **`@maelstrom-co/realtime-openai`** — OpenAI Realtime browser adapter
- **`@maelstrom-co/realtime-livekit`** — LiveKit browser adapter

Application code supplies a `RealtimeProviderAdapter` to `RealtimeSession`, or passes an adapter factory to [`@maelstrom-co/react-realtime`](https://docs.maelstrom-ai.co/reference/react-realtime/readme/). Provider adapters may expose different turn controls and state progressions; the core does not define a universal retry sequence.

The core has a single entry point and carries no provider-specific code. Add a
provider through its own packages, never through a subpath here. See
[provider package contracts](../../docs/realtime-voice-architecture.md#provider-package-contracts).

## Migrate custom adapters to observations

`RealtimeProviderAdapter.observations` is required. The lower-level
`RealtimeTransportAdapter.observations` remains optional; a transport alone does
not satisfy the Maelstrom provider contract. An adapter without evidence can
start with this feed, keeping unreported media state `unknown`:

```ts
import type { AdapterVoiceObservations } from '@maelstrom-co/realtime';

export const observations: AdapterVoiceObservations = {
  subscribe: () => () => {},
};
```

Expose it as your adapter's `readonly observations` property. For a transcript-only
provider, expose a `TranscriptObservationFeed` instead and feed it from your native
transcript callbacks:

```ts
import { TranscriptObservationFeed } from '@maelstrom-co/realtime';

export const observations = new TranscriptObservationFeed();
observations.restart(); // Once per new connection, before accepting callbacks.
observations.append('utterance-1', 'user', 'Show ');
observations.complete('utterance-1', 'user', 'Show my calendar');
```

Use stable utterance IDs so deltas and completion revise one fragment. Drop stale
connection callbacks before writing the feed. Its timestamps are local receipt
times, not measured media timestamps. Fragments, including final fragments, are
**timestamped evidence, not completed turns or proof of audibility**. Do not
manufacture legacy transcript turns from them.

[`RealtimeSession.events`](https://docs.maelstrom-ai.co/reference/realtime/classes/realtimesession/)
is synchronous, additive, and has no replay. Ignore unknown variants and subscribe
before connecting; use `session.observations` for retained snapshots. React exposes
that same evidence through
[`useVoiceObservations()`](https://docs.maelstrom-ai.co/reference/react-realtime/readme/).
Legacy `onEvent` is only a compatibility projection of selected session events.

Accepted voice requests share the client's bounded FIFO with typed input when
`createIntentScope` is available. Snapshots are built at dispatch. Disconnect
retires the connection's pending work, not submitted Engine requests or Actions.
Generic integrations without scoped admission call the immediate API once and
report busy as not submitted; they do not poll, supersede, or automatically retry.

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

Diagnostic collection sources activate only while the client channel has a full
diagnostic observer. A local metadata observer does not grant that capability.
Transcript content stays lazy, and attachment does not replay earlier fragments.
Provider diagnostics use a separate `providerGeneration` counter; it can differ
from the session's `generation`. Uncorrelated outcomes leave generation unknown.

## Operational telemetry

`attachRealtimeTelemetry({ session, telemetry, providerCategory })` observes
content-free tool handling through the shared tool observation core. Import it
from `@maelstrom-co/realtime`. `providerCategory` is an optional fixed category
from the telemetry contract. Custom provider names never become metric labels.

Attach before connecting. The attachment observes tool events only. Diagnostic
collection has a separate implementation that owns provider feeds and transcript
snapshots. Local tool success does not prove provider delivery, audible speech,
paint, or task acceptance. An uncertain result remains `unknown`; cancelled and
skipped work remain separate from failure.

The returned handle has `release()` and `drained`. Release retires this reference
without disconnecting the session or disposing telemetry. Repeated attachments
share a subscription and drain promise. Only the last release starts retirement.
Accepted results retain their original provider category across reconnects and
replacement. Private invocation identities distinguish repeated call IDs and
never enter exported records.

For an existing session and telemetry instance, use this lifecycle fragment:

```ts
import { attachRealtimeTelemetry } from '@maelstrom-co/realtime';

const attachment = attachRealtimeTelemetry({
  session,
  telemetry,
  providerCategory: 'custom',
});

// At shutdown, after releasing every reference to this attachment:
attachment.release();
await attachment.drained;
await telemetry.flush();
telemetry.dispose();
```

`maxPendingTools` defaults to 1,000 and accepts integers from 1 to 65,536. Excess
calls report source loss without evicting accepted observations or blocking work.
`drainTimeoutMs` defaults to 30,000 milliseconds and accepts integers from 1 to
60,000. A successful drain clears its timer and releases its listener. Expiry
publishes loss for abandoned observations before resolving `drained`.
Attachments sharing a source must use the same category and limits.
Omitted or initially disabled telemetry creates an already-drained handle,
subscribes to nothing, and ignores both limits. Enabled limits are validated
before subscription.

Source loss produces a counter with operation `telemetry.source` and outcome
`discarded`. Export queue loss remains in `telemetry.getSnapshot().dropped`.
See the [telemetry package](../telemetry/README.md) for delivery policy.

## Docs

- Voice guide: https://docs.maelstrom-ai.co/guides/voice/overview/
- OpenAI Live setup and recovery: https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/
- API reference: https://docs.maelstrom-ai.co/reference/realtime/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/

## License

MIT
