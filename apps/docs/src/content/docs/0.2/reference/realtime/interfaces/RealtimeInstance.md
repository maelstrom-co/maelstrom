---
editUrl: false
next: false
prev: false
title: "RealtimeInstance"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:53

The minimal bridge `RealtimeSession` needs from a Maelstrom instance.
`Orchestrator` maps onto this via a small wrapper (`submitIntent` ->
`processIntent`, `createIntentScope` -> the shared scheduler scope, and idle
waits -> `commandProcessor.waitForIdle`) — this interface exists so the realtime
package depends on a narrow seam rather than the whole `Orchestrator`
surface. `getStructuralSnapshot` backs the
`get_ui_state` pull (what's on screen); `getCapabilitySnapshot` backs the
`get_capabilities` pull (what CAN be shown).

`submitIntent` resolves with a [SubmitIntentResult](/reference/realtime/interfaces/submitintentresult/) carrying the
engine's conversational `userMessage`, so the session can speak the engine's
own reply instead of a structural summary once the change settles. It still
rejects with `RequestInFlightError` while a prior intent is applying. Legacy
instances are attempted once and report busy as not-submitted, without retry.
Supply `createIntentScope` for bounded cross-source FIFO and exact outcomes.

## Properties

### applicationWork?

> `readonly` `optional` **applicationWork?**: `VoiceApplicationWorkSource`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:55

Optional application-wide current work observations, including non-voice input.

## Methods

### addAssistantMessageAcknowledged()

> **addAssistantMessageAcknowledged**(`args`): `Promise`\<`AssistantMessageOutcome`\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:96

Persist an assistant message with the engine's existing MessageId dedup.
`'inserted'` is positive evidence this runtime owns first insertion;
`'deduped'` means an earlier attempt already landed.

#### Parameters

##### args

###### id

`MessageId`

###### message

`string`

#### Returns

`Promise`\<`AssistantMessageOutcome`\>

***

### createIntentScope()?

> `optional` **createIntentScope**(): `IntentScope`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:63

Creates one connection-owned lifetime backed by the application's shared
scheduler. Preferred over submitIntent when present. Retirement settles only
pending work; active results remain observable after voice ends. Ticket
results include response application settlement and must never reject.
Queue capacity, wait and connection-loss bounds belong to the client policy.

#### Returns

`IntentScope`

***

### getCapabilitySnapshot()

> **getCapabilitySnapshot**(): `CapabilitySnapshot`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:89

#### Returns

`CapabilitySnapshot`

***

### getStructuralSnapshot()

> **getStructuralSnapshot**(): `UIStructuralSnapshot`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:88

#### Returns

`UIStructuralSnapshot`

***

### observeEngineConnection()

> **observeEngineConnection**(`cb`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:106

Observe engine connection readiness. Subscribe first, then the current
status is delivered synchronously (subscribe-then-snapshot), so an
already-connected engine resolves immediately and a not-connected engine
delivers `false` now and `true` on the next transition.

#### Parameters

##### cb

(`connected`) => `void`

#### Returns

`Unsubscribe`

***

### onSettled()

> **onSettled**(`cb`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:90

#### Parameters

##### cb

() => `void`

#### Returns

`Unsubscribe`

***

### submitIntent()

> **submitIntent**(`intent`): `Promise`\<[`SubmitIntentResult`](/reference/realtime/interfaces/submitintentresult/)\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:65

Legacy immediate admission; called once, with no busy retry or FIFO guarantee.

#### Parameters

##### intent

`string`

#### Returns

`Promise`\<[`SubmitIntentResult`](/reference/realtime/interfaces/submitintentresult/)\>

***

### waitForIdle()

> **waitForIdle**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:67

Legacy global settle wait, unused for scoped ticket results.

#### Returns

`Promise`\<`void`\>

***

### waitForIdleResult()?

> `optional` **waitForIdleResult**(): `Promise`\<`Result`\<`void`, `Error`\>\>

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:87

Result-bearing settle wait, preferred over [RealtimeInstance.waitForIdle](/reference/realtime/interfaces/realtimeinstance/#waitforidle)
wherever the session needs to know whether the settled work succeeded.

It is optional so that an instance written against the void-only
[RealtimeInstance.waitForIdle](/reference/realtime/interfaces/realtimeinstance/#waitforidle) still satisfies this interface; a
session that finds it absent falls back to that wait and can only treat
every settle as successful. An `Orchestrator`-backed instance supplies it
directly, because `commandProcessor.waitForIdle()` already resolves with
this Result.

A `!ok` result means the settled work failed — a refused `set_layout`
(duplicate tiling leaf, malformed weight token) being the ordinary case.
Such a refusal neither throws nor rejects and leaves the previous screen
in place, so this is the only signal that the intent changed nothing, and
`RealtimeSession` answers the `update_ui` tool call as a failure rather
than describing a snapshot the intent never produced. A rejection leaves
the application outcome unconfirmed and must not trigger automatic replay.

#### Returns

`Promise`\<`Result`\<`void`, `Error`\>\>
