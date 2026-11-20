---
editUrl: false
next: false
prev: false
title: "TranscriptEntryEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:85

A whole transcript entry: a legacy adapter transcript, or the fixed greeting
line when its playback started. Live fragments are
[TranscriptFragmentEvent](/reference/realtime/interfaces/transcriptfragmentevent/)s instead.

## Properties

### final

> `readonly` **final**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:93

Whether the provider marked the entry as final.

***

### role

> `readonly` **role**: `"user"` \| `"assistant"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:89

Who spoke.

***

### text

> `readonly` **text**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:91

Transcript text as the adapter reported it.

***

### type

> `readonly` **type**: `"transcript.entry"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:87

Discriminant.
