---
editUrl: false
next: false
prev: false
title: "LocalAudioPreRoll"
---

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:17

A browser-local audio publication bridge for one caller-owned source track.

While closed it emits silence while retaining a bounded newest local tail.
Automatic turns publish that tail before later live samples; manual turns
discard it and publish live samples only. The caller owns `sourceTrack` and
must arrange transport publication and pause ordering. This bridge owns only
its generated `track` and Web Audio resources.

## Properties

### track

> `readonly` **track**: `MediaStreamTrack`

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:22

The generated publication track, rather than the caller-owned source
track. The bridge disables and stops this track during `destroy()`.

## Methods

### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:44

Discards retained and queued samples and returns to silent closed
buffering after an ID-scoped worklet acknowledgement within 250 ms. It
rejects on timeout or after destruction.

#### Returns

`Promise`\<`void`\>

***

### destroy()

> **destroy**(): `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:60

Idempotently clears the worklet, settles pending lifecycle requests, and
releases bridge-owned Web Audio resources and the generated track. It
never disables or stops the caller-owned source track; later lifecycle
requests reject because the generation is destroyed.

#### Returns

`Promise`\<`void`\>

***

### endTurn()

> **endTurn**(): `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:52

Stops accepting live automatic samples and resolves after already accepted
pre-roll drains, returning to silent closed buffering. Its acknowledgement
limit is `min(1500, 500 + 2 * clamp(activePreRollMs, 0, 500))` ms; it
rejects if that acknowledgement never arrives or after destruction.

#### Returns

`Promise`\<`void`\>

***

### startAutomaticTurn()

> **startAutomaticTurn**(`preRollMs`): `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:30

Opens automatic publication after the worklet acknowledges selection of
the bounded newest local tail. The tail is emitted once, before live
samples. Values are clamped to 0–500 ms (non-finite values mean zero), and
a missing acknowledgement rejects after 250 ms.

#### Parameters

##### preRollMs

`number`

#### Returns

`Promise`\<`void`\>

***

### startManualTurn()

> **startManualTurn**(): `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:37

Discards retained and queued samples, then opens live-only publication
once the worklet acknowledges within 250 ms. It rejects on timeout or
after destruction.

#### Returns

`Promise`\<`void`\>
