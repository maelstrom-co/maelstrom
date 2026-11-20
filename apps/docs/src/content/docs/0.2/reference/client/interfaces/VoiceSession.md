---
editUrl: false
next: false
prev: false
title: "VoiceSession"
---

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:57

The seam both voice tracks satisfy toward a Maelstrom instance: the realtime
track and the cascaded voice pipeline. It emits intents into the instance,
consumes speakable results, and receives grounding updates. Concrete
implementations live in `@maelstrom-co/realtime` (`RealtimeSession`) and the
cascade package — never in `client`.

The v1 seam is deliberately minimal (lifecycle + state, plus a transcript
channel for live captions); `SpeakableResult` and `GroundingUpdate` are
exported but unreferenced by this interface for now. The full seam shape
(intent-emission surface, speakable-result and grounding-update flow) is to
be settled through follow-up coordination, before the contract ossifies.

## Properties

### state

> `readonly` **state**: [`VoiceSessionState`](/reference/client/type-aliases/voicesessionstate/)

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:58

## Methods

### connect()

> **connect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:59

#### Returns

`Promise`\<`void`\>

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:60

#### Returns

`Promise`\<`void`\>

***

### on()

#### Call Signature

> **on**(`event`, `handler`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:61

##### Parameters

###### event

`"state"`

###### handler

(`s`) => `void`

##### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

#### Call Signature

> **on**(`event`, `handler`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:62

##### Parameters

###### event

`"transcript"`

###### handler

(`t`) => `void`

##### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)
