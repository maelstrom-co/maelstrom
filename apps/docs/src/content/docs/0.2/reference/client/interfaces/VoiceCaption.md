---
editUrl: false
next: false
prev: false
title: "VoiceCaption"
---

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:63

A revisable display group, separate from an authoritative conversation turn.

## Properties

### endMs

> `readonly` **endMs**: `number`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:77

Latest retained fragment end.

***

### final

> `readonly` **final**: `boolean`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:79

True only when the last fragment explicitly reports an utterance end. Display fading never sets this.

***

### fragmentIds

> `readonly` **fragmentIds**: readonly `string`[]

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:71

Fragment identities in timestamp order.

***

### id

> `readonly` **id**: `string`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:65

Stable display identity. Merges retain the oldest identity; splits retain it on the first surviving group.

***

### role

> `readonly` **role**: `"user"` \| `"assistant"`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:67

Role shared by this group's fragments.

***

### speakerId

> `readonly` **speakerId**: `string`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:69

Speaker shared by this group's fragments.

***

### startMs

> `readonly` **startMs**: `number`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:75

Earliest retained fragment start.

***

### text

> `readonly` **text**: `string`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:73

Exact concatenation of fragment text, without inserted separators.
