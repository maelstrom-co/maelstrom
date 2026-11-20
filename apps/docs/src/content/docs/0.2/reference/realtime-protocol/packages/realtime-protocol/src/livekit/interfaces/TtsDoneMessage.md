---
editUrl: false
next: false
prev: false
title: "TtsDoneMessage"
---

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:90

Sent worker → browser adapter on the `TTS_TOPIC` when TTS playout finishes.

## Properties

### type

> **type**: `"tts_done"`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:91

***

### utteranceId?

> `optional` **utteranceId?**: `number`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:93

The utterance this status refers to — see [TtsErrorMessage.utteranceId](/reference/realtime-protocol/packages/realtime-protocol/src/livekit/interfaces/ttserrormessage/#utteranceid).
