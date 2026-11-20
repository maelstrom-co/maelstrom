---
editUrl: false
next: false
prev: false
title: "TtsErrorMessage"
---

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:66

Sent worker → browser adapter on the `TTS_TOPIC` when TTS synthesis fails.

## Properties

### type

> **type**: `"tts_error"`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:67

***

### utteranceId?

> `optional` **utteranceId?**: `number`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:74

The utterance this status refers to, echoed from the speak request's
[SPEAK\_UTTERANCE\_ID\_ATTR](/reference/realtime-protocol/packages/realtime-protocol/src/livekit/variables/speak_utterance_id_attr/). Absent when the worker never received an id
(older/id-less speak requests); the client then falls back to type-only
handling.
