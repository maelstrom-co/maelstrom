---
editUrl: false
next: false
prev: false
title: "PlaybackBargeIn"
---

Defined in: packages/realtime-vad/src/playback-barge-in.ts:5

Local speaker gating only; provider turn detection and cancellation remain unchanged.

## Properties

### ready

> `readonly` **ready**: `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/playback-barge-in.ts:7

Settles when detection is ready, unavailable, or retired. Never rejects.

## Methods

### attach()

> **attach**(`stream`): `void`

Defined in: packages/realtime-vad/src/playback-barge-in.ts:9

Attaches received audio, never microphone/publication tracks. Repeated calls admit newly received tracks.

#### Parameters

##### stream

`MediaStream`

#### Returns

`void`

***

### destroy()

> **destroy**(): `void`

Defined in: packages/realtime-vad/src/playback-barge-in.ts:11

Fences callbacks, restores prior track values, and releases only local detection resources.

#### Returns

`void`
