---
editUrl: false
next: false
prev: false
title: "AdapterConnectOptions"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:30

Options a `RealtimeSession` hands an adapter on `connect`.

## Properties

### backendInstructions?

> `readonly` `optional` **backendInstructions?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:34

Tool-routing instructions for a separate managed backend. Adapters without one ignore this field; managed adapters fall back to `instructions` when omitted.

***

### conversationInstructions?

> `readonly` `optional` **conversationInstructions?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:41

Conversation-only instructions for providers with a separate conversational
frontend. `backendInstructions` (or `instructions` when absent) and `tools`
configure their managed tool backend.
Legacy adapters may ignore this field and keep their existing instruction path.

***

### getInitialGrounding?

> `readonly` `optional` **getInitialGrounding?**: () => `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:43

Concise observed UI data for adapters that seed grounding when ready; never behavioral instructions.

#### Returns

`string`

***

### getRecoveryContext?

> `readonly` `optional` **getRecoveryContext?**: () => [`VoiceRecoverySnapshot`](/reference/realtime/interfaces/voicerecoverysnapshot/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:45

Lazy bounded application evidence for startup recovery; never provider commands or authoritative final turns.

#### Returns

[`VoiceRecoverySnapshot`](/reference/realtime/interfaces/voicerecoverysnapshot/)

***

### instructions

> `readonly` **instructions**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:32

***

### prepareGreeting?

> `readonly` `optional` **prepareGreeting?**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:52

Whether this connection may present the configured fixed greeting.
Defaults to `true` for direct adapter callers. RealtimeSession always sets
this explicitly so reconnects with terminal greeting proof can skip
greeting-only microphone preparation.

***

### tools

> `readonly` **tools**: readonly [`RealtimeToolSpec`](/reference/realtime/interfaces/realtimetoolspec/)\<`string`\>[]

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:31
