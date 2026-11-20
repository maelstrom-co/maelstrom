---
editUrl: false
next: false
prev: false
title: "TtsStartedMessage"
---

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:66

Sent worker → browser adapter after the first synthesized frame enters the
LiveKit AudioSource queue. This is the nearest provider boundary available;
it does not prove that the browser has rendered the frame audibly.

## Properties

### type

> `readonly` **type**: `"tts_started"`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:68

Identifies this status as the first-frame start boundary.

***

### utteranceId

> `readonly` **utteranceId**: `number`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:70

The utterance this status refers to. Required so stale starts are rejected.
