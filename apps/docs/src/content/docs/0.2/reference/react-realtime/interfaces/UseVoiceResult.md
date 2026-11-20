---
editUrl: false
next: false
prev: false
title: "UseVoiceResult"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:225

Return value of the `useVoice()` hook added by [maelstromRealtime](/reference/react-realtime/functions/maelstromrealtime/).

The hook reports what the session is doing; it does not promise a fixed
sequence of events. There is no universal state progression across providers
and no universal retry policy, because each adapter owns its own connection
and turn behavior. Render the current `state` rather than inferring success
from an expected order, and use the typed error together with your own
deployment policy to decide whether to request microphone permission, repair
token minting, inspect the connection, or offer a reconnect.

## Type Parameters

### Provider

`Provider` = `undefined`

## Properties

### assistantTranscript

> `readonly` **assistantTranscript**: `TranscriptEntry` \| `undefined`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:247

Latest accumulated or final assistant transcript; reset when the session is replaced.

***

### connect

> `readonly` **connect**: () => `Promise`\<`void`\>

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:296

Connects the shared session; concurrent lifecycle safety is session-owned.

Resolving means the provider session is ready. Rejecting means the attempt
failed; the session usually moves to `error` with the cause in `lastError`,
but an attempt invalidated by a concurrent `disconnect()` rejects while the
session stays `idle`, so read `state` rather than inferring it from the
rejection. Calling this while a connection is already starting or live may
be a no-op, and it resolves without connecting while a provider switch runs.

#### Returns

`Promise`\<`void`\>

***

### disconnect

> `readonly` **disconnect**: () => `Promise`\<`void`\>

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:303

Disconnects the shared session regardless of other mounted consumers.

Calling this while no session is live may be a no-op. A rejection is not
swallowed, so cleanup failures stay visible and can be retried.

#### Returns

`Promise`\<`void`\>

***

### error

> `readonly` **error**: `unknown`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:243

Failure behind the current `error` state, if any.

***

### greetingState

> `readonly` **greetingState**: `GreetingState`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:241

Retained fixed-greeting presentation lifecycle from the shared
RealtimeSession, initialized synchronously from coordinator proof
and updated for every `useVoice()` consumer. It is not a hook-local timer,
caption, error, `VoiceSessionState`, or turn-mode derivation.

`pending` is retryable; `preparing` starts before the provider handshake and
can wait indefinitely for Engine readiness; `settled` ends presentation
without implying provider activity or speech success; `skipped` is the
terminal explicit user choice; and `not_configured` means that no greeting
exists. Retained terminal proof survives shared session recreation, and
stale connection generations cannot update it.

***

### provider

> `readonly` **provider**: `Provider`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:254

Provider of the current session.

***

### session

> `readonly` **session**: `RealtimeSession`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:252

Advanced access to the shared realtime session and its audio streams. A
provider switch replaces it, and every consumer re-renders with the new one.

***

### skipGreeting

> `readonly` **skipGreeting**: () => `void`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:308

Synchronously skip the shared configured greeting. This is idempotent,
shared by every hook consumer, and never disconnects voice.

#### Returns

`void`

***

### state

> `readonly` **state**: `VoiceSessionState`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:227

Lifecycle state of the shared session, updated for every consumer.

***

### switching

> `readonly` **switching**: `boolean`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:256

True from the start of a provider switch until it commits, fails, or is superseded.

***

### switchProvider

> `readonly` **switchProvider**: (`provider`) => `Promise`\<`void`\>

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:272

Switches every consumer to a new session for `provider`. The current
session disconnects first, then the extension builds the new adapter and
session with the same recovery memory and greeting coordinator, so the
one-introduction rule holds across providers. Transcripts reset.

Resolves once the request settles; read `provider` for the outcome. The
current provider resolves at once, a second call for the pending target
shares its promise, and a call for another target supersedes it, so the
earlier request resolves without building. Rejects when the old session
fails to disconnect or the new one fails to build, leaving the current
session in place, disconnected. Rejects with a `RangeError` for a
provider missing from [MaelstromRealtimeBaseOptions.providers](/reference/react-realtime/interfaces/maelstromrealtimebaseoptions/#providers).
With no mounted consumer, the choice is remembered for the next session.

#### Parameters

##### provider

`Provider`

#### Returns

`Promise`\<`void`\>

***

### turnControl?

> `readonly` `optional` **turnControl?**: `AdapterTurnControl`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:278

Adapter-owned manual controls, available only after the session establishes
manual mode. Automatic mode and lifecycle teardown never expose controls,
even while the last manual mode and its diagnostic remain retained.

***

### turnMode

> `readonly` **turnMode**: `"automatic"` \| `"manual"`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:280

Current provider-neutral turn-boundary mode retained by the session.

***

### turnModeError

> `readonly` **turnModeError**: `unknown`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:285

Diagnostic from automatic-mode degradation. Clean automatic or intentional
manual transitions clear it. It must not be rendered verbatim or serialized.

***

### userTranscript

> `readonly` **userTranscript**: `TranscriptEntry` \| `undefined`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:245

Latest accumulated or final user transcript; reset when the session is replaced.
