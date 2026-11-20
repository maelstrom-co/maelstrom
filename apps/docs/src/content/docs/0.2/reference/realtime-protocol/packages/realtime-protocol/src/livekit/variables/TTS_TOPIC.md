---
editUrl: false
next: false
prev: false
title: "TTS_TOPIC"
---

> `const` **TTS\_TOPIC**: `"tts"` = `'tts'`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:31

Data topic the worker uses to report TTS status back to the client: a
`tts_started` after the first frame enters the worker's playout queue, `tts_done` when
playout of a summary finishes (so the client can collapse
`speaking`→`connected` on actual audio end, not on text hand-off), or a
`tts_error` when synthesis fails.
