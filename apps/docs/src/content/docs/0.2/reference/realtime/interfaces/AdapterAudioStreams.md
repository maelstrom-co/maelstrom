---
editUrl: false
next: false
prev: false
title: "AdapterAudioStreams"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:114

Live audio streams a provider session is currently using, for UI metering
(voice orbs, level indicators). Fields are undefined before connect, after
disconnect, and — for `playback` — until the provider attaches its remote
audio track.

## Properties

### mic?

> `readonly` `optional` **mic?**: `MediaStream`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:115

***

### playback?

> `readonly` `optional` **playback?**: `MediaStream`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:116
