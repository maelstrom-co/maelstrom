---
editUrl: false
next: false
prev: false
title: "RealtimeSessionMemory"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:64

Retains opening proof and recovery evidence for one Maelstrom session identity.
Reuse this object when recreating RealtimeSession outside React. The React
extension owns it per Orchestrator. It stores no audio, credentials, commands,
or durable Engine history. Discard it when the application session ends.

## Constructors

### Constructor

> **new RealtimeSessionMemory**(`sessionId`): `RealtimeSessionMemory`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:75

Binds this memory to one application session; sharing across identities is rejected.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`RealtimeSessionMemory`

## Properties

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:66

Application session identity owning all retained evidence.

## Methods

### getSnapshot()

> **getSnapshot**(): [`VoiceRecoverySnapshot`](/reference/realtime/interfaces/voicerecoverysnapshot/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:80

Reads detached recovery evidence, including late application outcomes after disconnect.

#### Returns

[`VoiceRecoverySnapshot`](/reference/realtime/interfaces/voicerecoverysnapshot/)

***

### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:83

Observes evidence changes without connecting a provider.

#### Parameters

##### listener

() => `void`

#### Returns

() => `void`
