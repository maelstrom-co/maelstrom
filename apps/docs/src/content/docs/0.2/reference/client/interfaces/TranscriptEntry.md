---
editUrl: false
next: false
prev: false
title: "TranscriptEntry"
---

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:38

One utterance fragment from either side of the voice conversation.

Non-final entries are streaming fragments; consumers accumulate fragments
per role while `final` is false and replace the accumulation when the
`final: true` entry for that utterance arrives.

## Properties

### final

> `readonly` **final**: `boolean`

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:41

***

### role

> `readonly` **role**: `"user"` \| `"assistant"`

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:39

***

### text

> `readonly` **text**: `string`

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:40
