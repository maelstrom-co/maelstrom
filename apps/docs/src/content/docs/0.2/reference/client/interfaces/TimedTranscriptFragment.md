---
editUrl: false
next: false
prev: false
title: "TimedTranscriptFragment"
---

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:45

One continuous transcript fragment. Times are milliseconds from the provider
connection's media origin, not wall-clock or confirmed audible-playback times.
Reusing an ID revises that fragment in place. Text is retained verbatim.

## Properties

### endMs

> `readonly` **endMs**: `number`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:57

End on the same timeline, at or after startMs.

***

### final?

> `readonly` `optional` **final?**: `boolean`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:59

Provider evidence that an utterance ends here. Absence means unknown.

***

### id

> `readonly` **id**: `string`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:47

Provider-local identity, unique within a connection generation; 1–256 characters.

***

### role

> `readonly` **role**: `"user"` \| `"assistant"`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:49

Conversation role, independent of other simultaneous speakers.

***

### speakerId

> `readonly` **speakerId**: `string`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:51

Stable speaker identity within this connection; 1–256 characters.

***

### startMs

> `readonly` **startMs**: `number`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:55

Inclusive start on the connection's media timeline.

***

### text

> `readonly` **text**: `string`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:53

Raw fragment text, including whitespace and punctuation.
