---
editUrl: false
next: false
prev: false
title: "createLocalAudioPreRoll"
---

> **createLocalAudioPreRoll**(`sourceTrack`): `Promise`\<[`LocalAudioPreRoll`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/localaudiopreroll/)\>

Defined in: packages/realtime-vad/src/local-audio-pre-roll.ts:73

Creates a provider-neutral browser bridge that buffers a bounded local tail
from `sourceTrack` while its generated publication track is closed and
silent. Publish `track` only after the transport is ready to receive an
automatic tail, because the caller owns transport ordering and the source
track throughout its lifetime. Lifecycle operations settle only after their
matching worklet acknowledgement (or their documented timeout); creation
rejects when Web Audio is unsupported or a generated audio track cannot be
established. `destroy()` releases only bridge-owned resources.

## Parameters

### sourceTrack

`MediaStreamTrack`

## Returns

`Promise`\<[`LocalAudioPreRoll`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/localaudiopreroll/)\>
