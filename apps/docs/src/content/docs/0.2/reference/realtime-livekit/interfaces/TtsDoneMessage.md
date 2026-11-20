---
editUrl: false
next: false
prev: false
title: "TtsDoneMessage"
---

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:73

Sent worker → browser adapter on the `TTS_TOPIC` when TTS playout finishes.

## Properties

### type

> **type**: `"tts_done"`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:74

***

### utteranceId?

> `optional` **utteranceId?**: `number`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:76

The utterance this status refers to — see [TtsErrorMessage.utteranceId](/reference/realtime-livekit/interfaces/ttserrormessage/#utteranceid).
