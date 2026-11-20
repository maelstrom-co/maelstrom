---
editUrl: false
next: false
prev: false
title: "TtsCancelMessage"
---

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:53

Sent browser adapter → worker on the `TURN_TOPIC` when the user barges in
while the assistant is speaking: aborts the in-flight Cartesia TTS so the
queued audio stops near-instantly instead of playing to completion.

## Properties

### type

> **type**: `"tts_cancel"`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:54
