---
editUrl: false
next: false
prev: false
title: "VoiceObservationSource"
---

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:99

Additive observation capability; neither VoiceSession nor its event unions change.

## Methods

### getSnapshot()

> **getSnapshot**(): [`VoiceObservationSnapshot`](/reference/client/interfaces/voiceobservationsnapshot/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:101

Reads a referentially stable snapshot until observations change.

#### Returns

[`VoiceObservationSnapshot`](/reference/client/interfaces/voiceobservationsnapshot/)

***

### subscribe()

> **subscribe**(`handler`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:103

Subscribes to changes. Subscribe before reading to avoid missed updates.

#### Parameters

##### handler

() => `void`

#### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)
