---
editUrl: false
next: false
prev: false
title: "VoiceApplicationWorkSource"
---

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:33

Optional host observation source. Subscribe before reading the current snapshot.

## Methods

### getSnapshot()

> **getSnapshot**(): [`VoiceApplicationWork`](/reference/client/interfaces/voiceapplicationwork/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:35

Reads current activity, including work submitted outside voice.

#### Returns

[`VoiceApplicationWork`](/reference/client/interfaces/voiceapplicationwork/)

***

### subscribe()

> **subscribe**(`handler`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:37

Notifies when the current snapshot changes; returns a listener release.

#### Parameters

##### handler

() => `void`

#### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)
