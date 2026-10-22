# @maelstrom-co/react-realtime

[![npm](https://img.shields.io/npm/v/@maelstrom-co/react-realtime.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/react-realtime)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Provider-neutral React binding for Maelstrom voice sessions.

**Full documentation:** <https://docs.maelstrom-ai.co>

## Install

```bash
bun add @maelstrom-co/react-realtime @maelstrom-co/react @maelstrom-co/realtime @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/react-realtime @maelstrom-co/react @maelstrom-co/realtime @maelstrom-co/protocol`

## What it does

Add `maelstromRealtime()` with `.with()` when you create your Maelstrom instance.
The extension shares one provider session across `m.useVoice()`,
`m.useVoiceObservations()`, and `m.VoiceOrb` under the same Orchestrator.

## Configure two providers

Supply your configured adapter factories. The Realtime factory below must support
fixed greetings (including its greeting synthesizer); the Live factory uses a
host-owned session exchange. Replace the empty Vessel registry with your app's.

```ts
import type { SessionId } from '@maelstrom-co/protocol';
import { createMaelstrom } from '@maelstrom-co/react';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';

export function createVoiceUi(
  createLiveAdapter: () => RealtimeProviderAdapter,
  createRealtimeAdapter: (sessionId: SessionId) => RealtimeProviderAdapter,
) {
  return createMaelstrom({ vessels: [] }).with(
    maelstromRealtime({
      providers: ['live', 'realtime'] as const,
      initialProvider: 'live',
      createAdapter: ({ provider, sessionId }) =>
        provider === 'live'
          ? createLiveAdapter()
          : createRealtimeAdapter(sessionId),
      opening: ({ provider }) =>
        provider === 'live'
          ? { generatedOpening: { instructions: 'In English, introduce yourself.' } }
          : { greeting: { text: 'Hello! How can I help?' } },
    }),
  );
}
```

`initialProvider` defaults to the first provider; a function is evaluated lazily
for the first session. Later remounts remember the last choice per Orchestrator.
Omit `providers` for a single-provider extension. Empty lists and selections
outside the declared list reject with `RangeError`.

### Switch and retain one introduction

`useVoice()` exposes `provider`, `switching`, and `switchProvider(provider)`.
A switch disconnects the old session before building the replacement; it does not
connect the new provider automatically. Call `connect()` from a user action after
the switch. While switching, `connect()` does nothing.

Repeated requests for the pending target share a promise. A different target
supersedes the pending switch; the superseded promise resolves without building
its adapter. Read `provider` for the committed outcome, not just promise
resolution. A disconnect/build failure rejects and leaves the old session in
place, disconnected. Switching resets legacy transcripts, but shares recovery
memory and the greeting coordinator.

`opening({ provider, sessionId })` selects a fixed `greeting` or
`generatedOpening`, or returns `undefined`. It cannot accompany the top-level
opening options. A fixed greeting claims the shared introduction memory before
speech; a generated opening claims one attempt before provider send, including
ambiguous failures. Reconnect, remount, and provider switches do not introduce
again after that claim. Pre-send fixed-greeting failures can remain retriable.
A new application session starts independent memory. Only observed speech enters
recovery evidence, never intended opening wording.

### Attach session wiring and observe evidence

`onSession(session, { provider, sessionId, instanceId, orchestrator, adapter })`
runs **synchronously while the session is built**, potentially during React
render. Do not update React state directly there. Return cleanup for subscriptions;
it runs after disconnect when a switch or last-consumer unmount retires the
session. Throwing aborts the build.

`useVoiceObservations()` returns `{ snapshot, session }` for the same shared
lifetime without connecting it. Timestamped fragments are evidence, not completed
turns or proof of audible delivery. `session.events` delivers synchronously,
without replay; ignore unknown additive variants. Legacy `onEvent` projects only
selected events. See [Live setup and recovery](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/).

The binding does not impose one provider's state progression or recovery policy
on another.

## Session contract

The hook reports lifecycle `state`, `error`, user/assistant transcripts,
`greetingState`, `skipGreeting()`, and runtime `turnMode`/`turnModeError`, plus the
session and provider-switch controls. It does not promise a fixed event sequence.

- A successful `connect()` means the provider session is ready.
- A rejected `connect()`, or an `error` state, means the attempt failed.
- `disconnect()` ends the shared session.
- Repeated `connect()` or `disconnect()` calls while a connection is already starting or live may be no-ops.

Render the current `state` rather than inferring success from a fixed order. There is no universal state sequence across providers and no universal retry policy. Use the typed error code and your own deployment policy to decide whether to request microphone permission, repair token minting, inspect the connection, or offer a reconnect.

`turnControl` is a capability, not a constant. Speech-native adapters leave it undefined because the provider owns turn detection. Adapters that require explicit turn boundaries expose it, and application code should render hold-to-talk only while it is present.

The React binding does not create a VAD controller. `LiveKitAdapter` drives the
provider-neutral engine from `@maelstrom-co/realtime-vad`; applications deploy
that package's matching browser assets during their build. Add
`@maelstrom-co/realtime-vad` as a direct dependency so package managers link its
`maelstrom-vad-assets` CLI onto the application's `PATH`.

## Docs

- [Voice guide](https://docs.maelstrom-ai.co/guides/voice/overview/)
- [Live setup and recovery](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/)
- [React voice API reference](https://docs.maelstrom-ai.co/reference/react-realtime/readme/)
- [Voice architecture](https://docs.maelstrom-ai.co/understanding/voice-architecture/)

## License

MIT
