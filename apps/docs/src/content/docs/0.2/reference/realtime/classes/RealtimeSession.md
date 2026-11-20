---
editUrl: false
next: false
prev: false
title: "RealtimeSession"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:215

Provider-agnostic realtime voice session core. Wires a
[RealtimeProviderAdapter](/reference/realtime/interfaces/realtimeprovideradapter/)'s tool calls to a Maelstrom instance:
`update_ui` submits an intent and withholds its tool result until the
resulting render settles (speak-after-render); `get_ui_state` answers
immediately from a structural snapshot; `get_capabilities` answers
immediately from the vessel capability catalog; render-settle events push
a debounced, latest-wins grounding string; and every fact the session
learns is published on [RealtimeSession.events](/reference/realtime/classes/realtimesession/#events), which also feeds the
`onEvent` sidechannel.

Instances with `createIntentScope` share the application's bounded FIFO with
typed input. Each connection owns only its pending work; disconnect retires
that work without cancelling a submitted turn. Tickets provide exact batch
outcomes, so no global idle wait or busy retry is added here. Legacy instances
are called once: busy is not-submitted, and transport uncertainty never
authorizes automatic replay.

## Example

```ts
const session = new RealtimeSession({
  adapter,
  instance: {
    createIntentScope: () => orchestrator.createIntentScope(),
    submitIntent: (intent) =>
      orchestrator
        .processIntent(intent)
        .then((r) => ({ userMessage: r.userMessage })),
    waitForIdle: async () => {
      await orchestrator.commandProcessor.waitForIdle();
    },
    waitForIdleResult: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (cb) => orchestrator.onSettled(cb),
  },
  // …other options…
});
await session.connect();
```

## Implements

- `VoiceSession`

## Constructors

### Constructor

> **new RealtimeSession**(`options`): `RealtimeSession`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:299

#### Parameters

##### options

[`RealtimeSessionOptions`](/reference/realtime/interfaces/realtimesessionoptions/)

#### Returns

`RealtimeSession`

## Properties

### memory

> `readonly` **memory**: [`RealtimeSessionMemory`](/reference/realtime/classes/realtimesessionmemory/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:239

Recovery evidence retained independently of provider delivery. It may be
shared with other sessions of the same Maelstrom session identity. Active
application outcomes remain observable even after this session is disposed.

## Accessors

### events

#### Get Signature

> **get** **events**(): [`SessionEventSource`](/reference/realtime/interfaces/sessioneventsource/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:355

Every fact this session publishes: connection lifecycle, transcript and
media evidence, tool calls and their results, `update_ui` recovery
outcomes, timings and the opening claim. Delivery is synchronous and in
publish order, with no replay, so read [RealtimeSession.observations](/reference/realtime/classes/realtimesession/#observations)
for current values. The stream lives as long as this session; a
replacement session has its own.

##### Returns

[`SessionEventSource`](/reference/realtime/interfaces/sessioneventsource/)

***

### greetingState

#### Get Signature

> **get** **greetingState**(): [`GreetingState`](/reference/realtime/type-aliases/greetingstate/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:400

Retained fixed-greeting presentation lifecycle for this shared session.
The value is initialized synchronously from coordinator proof and survives
session recreation when that proof is terminal. It does not mirror
provider activity, speech success, errors, transcripts, connection state,
or turn mode. Subscribe to `greeting_state` for later retained changes.

##### Returns

[`GreetingState`](/reference/realtime/type-aliases/greetingstate/)

***

### lastError

#### Get Signature

> **get** **lastError**(): `unknown`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:441

The failure behind the most recent `error` state, if any. Cleared at the
start of the next `connect()` attempt, but preserved by explicit
`disconnect()` even after that method returns the public state to `idle`.
Typed provider failures are `RealtimeVoiceError` — switch on `.code` for
recovery UX. If subscription cleanup also fails, an `AggregateError`
retains the provider failure first, followed by cleanup failures.

##### Returns

`unknown`

***

### observations

#### Get Signature

> **get** **observations**(): `VoiceObservationSource`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:360

Shared continuous observations. Reading or subscribing does not connect the provider.

##### Returns

`VoiceObservationSource`

***

### state

#### Get Signature

> **get** **state**(): `VoiceSessionState`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:343

##### Returns

`VoiceSessionState`

#### Implementation of

`VoiceSession.state`

***

### turnControl

#### Get Signature

> **get** **turnControl**(): [`AdapterTurnControl`](/reference/realtime/interfaces/adapterturncontrol/) \| `undefined`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:429

Current adapter-owned manual turn control. It is exposed only after the
adapter establishes manual mode and is read dynamically so adapter
degradation or teardown can replace or remove the control safely.

##### Returns

[`AdapterTurnControl`](/reference/realtime/interfaces/adapterturncontrol/) \| `undefined`

***

### turnMode

#### Get Signature

> **get** **turnMode**(): [`TurnMode`](/reference/realtime/type-aliases/turnmode/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:410

Retained turn-boundary mode, initially `automatic`. Speech-native adapters
establish a clean `automatic` mode after connect succeeds; adapters emit
`turn_mode` when they establish manual control or change mode. A failed
reconnect does not synthesize a clean transition or clear this value.

##### Returns

[`TurnMode`](/reference/realtime/type-aliases/turnmode/)

***

### turnModeError

#### Get Signature

> **get** **turnModeError**(): `unknown`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:420

Diagnostic from an attempted automatic mode that degraded to manual.
Clean mode events and a successful speech-native reconnect clear it; a
failed reconnect preserves it. This value is for generic recovery guidance
only; consumers must not render it verbatim or serialize it into telemetry.

##### Returns

`unknown`

## Methods

### connect()

> **connect**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:458

Opens one provider connection. Re-entry from a live state is a no-op. A
successful connection that emitted no `turn_mode` establishes clean
automatic mode; a failed or stale attempt never synthesizes that fallback
and rejects with the adapter failure. An eligible configured greeting moves
to `preparing` synchronously before the provider handshake; retained
terminal proof leaves it `settled` or `skipped` and skips greeting work. The connection
generation owns both the greeting and `connecting` notifications: a
synchronous disconnect from either notification stops before audio
activation, adapter subscription, or provider connect. Audio activation
still occurs synchronously inside this call, before the first await.
Rejects once the session is disposed.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`VoiceSession.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:656

Invalidates connection ownership and removes local subscriptions and
greeting work before awaiting provider cleanup. Whether provider cleanup
resolves or rejects, coordinator proof restores the greeting to retryable
`pending` or terminal `settled`, and the public state becomes `idle`.
`lastError` is preserved. A single cleanup or provider failure is rethrown
unchanged; multiple failures are reported together in an `AggregateError`.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`VoiceSession.disconnect`

***

### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:684

Retires this session for good. It starts [RealtimeSession.disconnect](/reference/realtime/classes/realtimesession/#disconnect),
then detaches shared memory after outstanding application outcomes settle.
Submitted work retains truthful recovery evidence without provider delivery.
Later `connect()` calls reject. Repeated calls retain the first disconnect's result, including a
rejection, without repeating provider teardown or lifecycle notifications.

#### Returns

`Promise`\<`void`\>

***

### getAudioStreams()

> **getAudioStreams**(): [`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:714

Live audio streams for UI metering (voice orbs, level meters). Delegates
to the provider adapter; see `AdapterAudioStreams` for absence semantics.

#### Returns

[`AdapterAudioStreams`](/reference/realtime/interfaces/adapteraudiostreams/)

***

### on()

#### Call Signature

> **on**(`event`, `handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:834

##### Parameters

###### event

`"state"`

###### handler

(`s`) => `void`

##### Returns

`Unsubscribe`

##### Implementation of

`VoiceSession.on`

#### Call Signature

> **on**(`event`, `handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:835

##### Parameters

###### event

`"transcript"`

###### handler

(`t`) => `void`

##### Returns

`Unsubscribe`

##### Implementation of

`VoiceSession.on`

#### Call Signature

> **on**(`event`, `handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:836

##### Parameters

###### event

`"turn_mode"`

###### handler

(`event`) => `void`

##### Returns

`Unsubscribe`

##### Implementation of

`VoiceSession.on`

#### Call Signature

> **on**(`event`, `handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:844

Subscribes to retained fixed-greeting lifecycle changes. The handler runs
after each change, not immediately on subscription; read
[RealtimeSession.greetingState](/reference/realtime/classes/realtimesession/#greetingstate) first for the current retained value.
Disconnects and stale connection generations cannot publish late changes
into a replacement generation.

##### Parameters

###### event

`"greeting_state"`

###### handler

(`state`) => `void`

##### Returns

`Unsubscribe`

##### Implementation of

`VoiceSession.on`

***

### requestGeneratedOpening()

> **requestGeneratedOpening**(`instructions`): `Promise`\<`boolean`\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:376

Requests generated wording once per session memory, including provider recreation.
Returns true only after adapter acceptance, never as proof of audible delivery.
Returns false when no opening was requested: unsupported, disconnected,
already attempted, or a fixed greeting is configured. A rejection still
consumes the attempt because the provider may already have received it.
No intended text becomes a transcript
or Engine history entry. Configured generatedOpening uses this same claim.
The claim is the one direct write into memory: it is a compare-and-set whose
answer gates the request, so it cannot be an event. `opening.claimed` is
published only after the claim is won.

#### Parameters

##### instructions

`string`

#### Returns

`Promise`\<`boolean`\>

***

### skipGreeting()

> **skipGreeting**(): `void`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.ts:640

Synchronously and idempotently skip the configured fixed greeting without
disconnecting voice or changing turn mode. The coordinator proof wins
before local work is aborted, so stale async continuations cannot replay
or replace the retained `skipped` state.

#### Returns

`void`
