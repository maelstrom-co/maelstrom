---
editUrl: false
next: false
prev: false
title: "BrowserVadOptions"
---

Defined in: packages/realtime-vad/src/browser-vad.types.ts:43

Adapter-owned browser VAD configuration.

A malformed value is rejected rather than clamped or ignored. The adapter
decides whether that failure can degrade safely to manual mode.

## Properties

### assetBaseUrl?

> `readonly` `optional` **assetBaseUrl?**: `string`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:52

Trusted directory holding the complete VAD and ONNX Runtime asset set.
Defaults to `/vad-web/`. Deploy matching files with the package's asset
helper or `maelstrom-vad-assets` binary.

Relative URLs stay same-origin. Absolute URLs must be credential-free
HTTPS. Protocol-relative URLs, query strings, and fragments are rejected.

***

### preRollMs?

> `readonly` `optional` **preRollMs?**: `number`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:54

Browser-local transport pre-roll from 0 through 500ms. Defaults to 250ms.

***

### providerOptions?

> `readonly` `optional` **providerOptions?**: [`BrowserVadProviderOptions`](/reference/realtime-vad/packages/realtime-vad/src/interfaces/browservadprovideroptions/)

Defined in: packages/realtime-vad/src/browser-vad.types.ts:56

Supported provider tuning; lifecycle, streams, callbacks, and assets remain adapter-owned.
