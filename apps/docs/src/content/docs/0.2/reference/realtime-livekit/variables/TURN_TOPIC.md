---
editUrl: false
next: false
prev: false
title: "TURN_TOPIC"
---

> `const` **TURN\_TOPIC**: `"turn"` = `"turn"`

Defined in: packages/realtime-protocol/dist/lib/livekit-wire.d.ts:14

Data topic for client→worker turn control: `turn_end` (flush the STT buffer)
and `tts_cancel` (barge-in — abort the in-flight TTS so old audio stops).
