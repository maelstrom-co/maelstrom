---
editUrl: false
next: false
prev: false
title: "PlaybackBargeInOptions"
---

Defined in: packages/realtime-vad/src/playback-barge-in.ts:15

Configuration for an optional, connection-owned local playback gate.

## Properties

### config

> `readonly` **config**: `object`

Defined in: packages/realtime-vad/src/playback-barge-in.ts:19

Validated browser detector settings; transport pre-roll is unused.

#### assetBaseUrl

> `readonly` **assetBaseUrl**: `string`

#### enabled

> `readonly` **enabled**: `true`

#### preRollMs

> `readonly` **preRollMs**: `number`

#### providerOptions

> `readonly` **providerOptions**: [`BrowserVadProviderOptions`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/browservadprovideroptions/)

***

### microphone

> `readonly` **microphone**: `MediaStream`

Defined in: packages/realtime-vad/src/playback-barge-in.ts:17

Already-owned microphone capture; this helper neither acquires nor stops it.

***

### onUnavailable

> `readonly` **onUnavailable**: () => `void`

Defined in: packages/realtime-vad/src/playback-barge-in.ts:21

Reports fallback to provider-only interruption, without media or exception payloads.

#### Returns

`void`
