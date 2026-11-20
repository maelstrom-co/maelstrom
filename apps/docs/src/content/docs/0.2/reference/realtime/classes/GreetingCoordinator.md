---
editUrl: false
next: false
prev: false
title: "GreetingCoordinator"
---

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:73

Provider-neutral greeting state machine.

Owns persistence-before-caption/playback, same-session reconnect/recreation
idempotency (retained proofs), and new-session re-greet. Concrete speech is
delegated to [RealtimeGreetingAdapter.speakAssistantText](/reference/realtime/interfaces/realtimegreetingadapter/#speakassistanttext).

**Engine-restart edge:** if the engine's history/dedup state is lost while a
session's `SessionId` persists, a later run would see `inserted` again and
re-greet within that session — currently out of demo scope.

## Constructors

### Constructor

> **new GreetingCoordinator**(): `GreetingCoordinator`

#### Returns

`GreetingCoordinator`

## Methods

### getSnapshot()

> **getSnapshot**(`sessionId`): [`GreetingCoordinatorSnapshot`](/reference/realtime/type-aliases/greetingcoordinatorsnapshot/)

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:92

Reads replay eligibility for `sessionId` without adopting the session,
mutating coordinator state, or starting greeting work. Unknown sessions
and non-terminal attempts report `pending`; terminal proof remains
observable across provider-session recreation. The result does not expose
provider phase, failure details, or an internal run disposition.

#### Parameters

##### sessionId

`SessionId`

#### Returns

[`GreetingCoordinatorSnapshot`](/reference/realtime/type-aliases/greetingcoordinatorsnapshot/)

***

### greetingIdFor()

> **greetingIdFor**(`sessionId`): `MessageId`

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:174

Derive the stable Engine message ID used for a session's greeting.
Reusing the ID lets Engine persistence deduplicate reconnect attempts.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`MessageId`

***

### skip()

> **skip**(`sessionId`): `boolean`

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:105

Synchronously make the configured greeting terminal for this session.
Returns true only for the winning transition; presented and suppressed
proof are intentionally never rewritten by a late Skip.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`boolean`
