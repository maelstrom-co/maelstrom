---
editUrl: false
next: false
prev: false
title: "TtsErrorMessage"
---

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:51

Sent worker → browser adapter on the `TTS_TOPIC` when TTS synthesis fails.

## Properties

### type

> **type**: `"tts_error"`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:52

***

### utteranceId?

> `optional` **utteranceId?**: `number`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:59

The utterance this status refers to, echoed from the speak request's
[SPEAK\_UTTERANCE\_ID\_ATTR](/reference/realtime-livekit/variables/speak_utterance_id_attr/). Absent when the worker never received an id
(older/id-less speak requests); the client then falls back to type-only
handling.
